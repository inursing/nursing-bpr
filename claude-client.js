// Shared homework AI. Credentials are supplied by the Worker only.
function homeworkMode(){return getSettings().practiceMode==='homework';}
async function claudeSample(input,opts={},stream=false){
  if(!proxyConfigured())throw new Error('請先設定課程連線');
  await ensureSession();
  const messages=(typeof input==='string'?[{role:'user',content:input}]:input).map(m=>m.parts?{role:m.role,content:m.parts.map(p=>{
    if(!p.image)return {type:'text',text:p.text||''};
    const match=p.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s);
    if(!match)throw new Error('影像格式不正確');
    return {type:'image',source:{type:'base64',media_type:match[1],data:match[2]}};
  })}:{role:m.role,content:m.content});
  const body={messages,system:opts.system||undefined,max_tokens:opts.maxTokens||1024,stream,kind:opts.kind||'chat'};
  if(opts.kind==='report')body.output_config={format:{type:'json_schema',schema:aiReportSchema()}};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),opts.kind==='report'?150000:30000);
  let reader;
  try{
    const res=await fetch(getSettings().proxyUrl+'/claude/messages',{method:'POST',headers:proxyHeaders({'Content-Type':'application/json'}),body:JSON.stringify(body),signal:controller.signal});
    if(!res.ok){const error=await res.json().catch(()=>({}));throw new Error(error.error||'Claude 連線失敗（'+res.status+'）');}
    if(!stream){const j=await res.json();return {text:(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''),finishReason:j.stop_reason==='max_tokens'?'length':j.stop_reason};}
    reader=res.body.getReader();const dec=new TextDecoder();let buf='',full='',finishReason=null,completed=false;
    const consume=line=>{
      if(!line.startsWith('data:'))return;
      const raw=line.slice(5).trim();if(!raw)return;
      const j=JSON.parse(raw);
      if(j.type==='error')throw new Error('Claude 分析中斷，請稍後重新分析');
      if(j.type==='content_block_delta'&&j.delta?.type==='text_delta'){full+=j.delta.text;opts.onDelta?.(full,j.delta.text);}
      if(j.type==='message_delta'&&j.delta?.stop_reason)finishReason=j.delta.stop_reason==='max_tokens'?'length':j.delta.stop_reason;
      if(j.type==='message_stop')completed=true;
    };
    while(true){const {value,done}=await reader.read();buf+=done?dec.decode():dec.decode(value,{stream:true});const lines=buf.split(/\r?\n/);buf=lines.pop();for(const line of lines)consume(line);if(done)break;}
    if(buf.trim())consume(buf);
    if(!completed||!full.trim())throw new Error('Claude 回應未完成，請稍後重試');
    return {text:full,finishReason};
  }finally{clearTimeout(timer);if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}}
}
