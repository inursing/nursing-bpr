const EVALUATION_QUESTIONS=[
'我能依會談目的與病人互動。','我能傾聽並回應病人的感受與需求。','我能適當運用治療性溝通技巧。','我能察覺自己需要改善的地方。','這次練習有助於我準備臨床會談。',
'操作流程清楚、容易使用。','語音辨識能正確呈現我的發言。','病人的回應自然且符合個案。','病人的聲音與 Live 畫面適合會談情境。','AI 分析有助於我理解會談中的優點與改善方向。'];
function evaluationDraft(){
 const form=document.getElementById('evaluation-form');if(!form||!form.dataset.ready)return;
 const old=state.evaluation||{};state.evaluation={...old,id:old.id||crypto.randomUUID(),ratings:EVALUATION_QUESTIONS.map((_,i)=>{const v=form.querySelector('input[name="ev'+i+'"]:checked')?.value;return v===undefined?null:Number(v);}),issues:document.getElementById('evaluation-issues').value,suggestions:document.getElementById('evaluation-suggestions').value};saveState();
}
function renderEvaluation(){
 const form=document.getElementById('evaluation-form'),d=state.evaluation||{};
 document.getElementById('evaluation-identity').textContent=[state.studentId,state.studentName,getCase()?.name].filter(Boolean).join('　');
 document.getElementById('evaluation-questions').innerHTML=EVALUATION_QUESTIONS.map((q,i)=>(i===0?'<h3>自我評值</h3>':i===5?'<h3 style="margin-top:28px">系統評值</h3>':'')+'<fieldset style="border:0;border-bottom:1px solid var(--border);padding:16px 0;margin:0"><legend style="font-weight:600;line-height:1.7">'+escHtml(q)+'</legend><div style="display:flex;gap:10px;flex-wrap:wrap">'+[1,2,3,4,5,...(i>=5?[0]:[])].map(v=>'<label style="display:flex;align-items:center;gap:5px;margin:0;padding:8px;border-radius:8px;background:var(--surface2)"><input type="radio" name="ev'+i+'" value="'+v+'" required '+(d.ratings?.[i]===v?'checked':'')+'>'+ (v===0?'無法評估':v+' 分')+'</label>').join('')+'</div></fieldset>').join('');
 const intro=document.createElement('p');intro.style.cssText='font-size:.85rem;color:var(--text2)';intro.textContent='1 分：非常不同意　2 分：不同意　3 分：普通　4 分：同意　5 分：非常同意';document.getElementById('evaluation-questions').prepend(intro);
 document.getElementById('evaluation-issues').value=d.issues||'';document.getElementById('evaluation-suggestions').value=d.suggestions||'';
 document.getElementById('evaluation-status').textContent=d.sentAt?'評值已送出，謝謝你的填答。':'';form.dataset.ready='1';form.onchange=evaluationDraft;form.oninput=evaluationDraft;
 document.getElementById('evaluation-submit').textContent=d.sentAt?'更新評值':'送出評值';
}
async function submitEvaluation(event){
 event.preventDefault();const btn=document.getElementById('evaluation-submit'),box=document.getElementById('evaluation-status');
 evaluationDraft();if(!state.studentName||!state.studentId){box.textContent='請先完成姓名與學號。';return;}if(!driveUrl()){box.textContent='目前無法連線至評值收件服務，填答已保存在此裝置。';return;}
 const snapshot=JSON.parse(JSON.stringify(state.evaluation));btn.disabled=true;box.textContent='正在送出評值…';
 try{const r=await drivePost({action:'evaluation',classCode:getSettings().classCode||'',evaluation:{...snapshot,studentName:state.studentName,studentId:state.studentId,caseName:getCase()?.name||'',caseId:state.caseId}});if(r.service!=='evaluation-v1')throw new Error('評值服務尚未就緒');if(state.evaluation?.id===snapshot.id){state.evaluation.sentAt=new Date().toISOString();saveState();}box.textContent='評值已送出，謝謝你的填答。';btn.textContent='更新評值';}catch(e){box.textContent='評值尚未送出，填答已保留，請稍後重試。';}finally{btn.disabled=false;}
}
