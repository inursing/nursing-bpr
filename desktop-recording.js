/* Optional local desktop recording. Never uploads footage or sends frames to AI. */
(() => {
 let mode=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)?'mobile':'desktop';
 let enabled=false,stream=null,recorder=null,capture=null,epoch=0,pending=false,clips=[],practice=0,playbackIndex=0,playbackUrls=[],uploading=false;
 let previewStream=null,previewEpoch=0,previewPending=false;
 const el=id=>document.getElementById(id);
 function refresh(){
  document.body.classList.toggle('desktop-practice',mode==='desktop');
  for(const id of ['step-replay','evaluation-replay-next']){const node=el(id);if(node)node.hidden=mode!=='desktop';}
  el('practice-device').value=mode;el('desktop-record-choice').hidden=mode!=='desktop';el('desktop-record-enabled').checked=enabled;
 }
 function stop(){
  pausePlayback();stopPreview();
  epoch++;pending=false;
  const r=recorder;recorder=null;
  try{if(r&&r.state!=='inactive')r.stop();}catch{}
  const c=capture;capture=null;try{c?.stop();}catch{}
  stream?.getTracks().forEach(t=>t.stop());stream=null;
  const v=el('cam-video');if(v){v.pause();v.srcObject=null;}
  el('desktop-record-panel').hidden=true;
 }
 function setMode(value){mode=value==='desktop'?'desktop':'mobile';if(mode==='mobile'){enabled=false;stop();}refresh();}
 function setEnabled(value){enabled=mode==='desktop'&&!!value;if(!enabled)stop();refresh();if(enabled)void preview();}
 function stopPreview(){
  previewEpoch++;previewPending=false;previewStream?.getTracks().forEach(t=>t.stop());previewStream=null;
  const v=el('desktop-check-video');if(v){v.pause();v.srcObject=null;}const box=el('desktop-check-preview');if(box)box.hidden=true;
 }
 async function preview(){
  if(mode!=='desktop'||!enabled||el('check-modal').classList.contains('hidden')||previewStream||previewPending)return;
  previewPending=true;const id=++previewEpoch;el('desktop-check-preview').hidden=false;el('desktop-check-status').textContent='正在開啟鏡頭…';
  if(!navigator.mediaDevices?.getUserMedia){el('desktop-check-status').textContent='此瀏覽器無法開啟鏡頭。';previewPending=false;return;}
  try{
   const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:false});
   if(id!==previewEpoch||!enabled||mode!=='desktop'||el('check-modal').classList.contains('hidden')){acquired.getTracks().forEach(t=>t.stop());return;}
   previewStream=acquired;const v=el('desktop-check-video');v.srcObject=acquired;await v.play();
   if(id===previewEpoch)el('desktop-check-status').textContent='鏡頭預覽';
  }catch(e){if(id===previewEpoch){previewStream?.getTracks().forEach(t=>t.stop());previewStream=null;el('desktop-check-status').textContent=e.name==='NotAllowedError'?'請允許使用攝影機，或取消錄影。':'鏡頭無法開啟，請確認未被其他程式占用。';}}
  finally{if(id===previewEpoch)previewPending=false;}
 }
 function disable(){setEnabled(false);toast('錄影已停止，可繼續會談。');}
 async function start(){
  if(mode!=='desktop'||!enabled||pending||recorder||state.phase!=='conv'||!listenWanted)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('此瀏覽器無法錄影，仍可繼續會談。');return;}
  const generation=++epoch,caseId=state.caseId,practiceId=practice;pending=true;
  el('desktop-record-panel').hidden=false;el('desktop-record-status').textContent='正在開啟鏡頭…';
  try{
   const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},facingMode:'user'},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(generation!==epoch||state.phase!=='conv'||!listenWanted||!enabled){acquired.getTracks().forEach(t=>t.stop());return;}
   stream=acquired;const v=el('cam-video');v.srcObject=stream;await v.play();
   if(generation!==epoch||state.phase!=='conv'||!listenWanted||!enabled)return;
   ensureAudioCtx();capture=InteractionRecorder.create({camera:stream,context:audioCtx,patientAudio:analyser,info:()=>[state.studentId,state.studentName,getCase()?.name].filter(Boolean).join(' · '),conversation:()=>state.conversation});
   const mime=['video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
   const r=new MediaRecorder(capture.stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:600000,audioBitsPerSecond:48000});
   const chunks=[],identity=[state.studentId,state.studentName,getCase()?.name].filter(Boolean).join('_');
   r.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
   r.onstop=()=>{const blob=new Blob(chunks,{type:r.mimeType||'video/webm'});if(blob.size&&caseId===state.caseId&&practiceId===practice){clips.push({blob,identity,start:startedAt,end:Date.now()});renderPlayback();}};
   r.onerror=()=>{stop();toast('錄影中斷，仍可繼續會談。');};
   const startedAt=Date.now();
   recorder=r;r.start(1000);el('desktop-record-status').textContent='● 錄影中';
  }catch(e){if(generation===epoch){stop();enabled=false;refresh();toast('無法錄影，仍可繼續會談。');}}
  finally{if(generation===epoch)pending=false;}
 }
 function pausePlayback(){el('desktop-replay-video')?.pause();}
 function selectPlayback(index,autoplay=false){
  if(!clips[index])return;playbackIndex=index;const v=el('desktop-replay-video');
  if(!playbackUrls[index])playbackUrls[index]=URL.createObjectURL(clips[index].blob);
  v.src=playbackUrls[index];el('desktop-replay-select').value=String(index);
  el('desktop-replay-status').textContent=clips.length>1?'第 '+(index+1)+'／'+clips.length+' 段':'';
  if(autoplay)void v.play().catch(()=>{});
 }
 function renderPlayback(){
  const box=el('desktop-replay-panel');if(!box)return;box.hidden=mode!=='desktop'||!clips.length;
  const empty=el('desktop-replay-empty');if(empty)empty.hidden=clips.length>0;
  if(box.hidden){pausePlayback();return;}
  const select=el('desktop-replay-select');select.replaceChildren();
  clips.forEach((_,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent='第 '+(i+1)+' 段';select.append(option);});
  select.hidden=el('desktop-replay-select-label').hidden=clips.length<2;
  select.onchange=()=>selectPlayback(Number(select.value));
  const v=el('desktop-replay-video');v.onended=()=>{if(playbackIndex+1<clips.length&&state.phase==='replay')selectPlayback(playbackIndex+1,true);};
  const transcript=el('desktop-replay-transcript');if(transcript){transcript.replaceChildren();
   state.conversation.forEach(m=>{const row=document.createElement('button');row.type='button';row.style.cssText='text-align:left;border:1px solid var(--border);border-radius:10px;padding:10px;background:'+(m.role==='nurse'?'var(--nurse-bubble)':'var(--patient-bubble)')+';color:var(--text);line-height:1.7;cursor:pointer';row.textContent=(m.role==='nurse'?'護生：':'病人：')+m.text;
    row.onclick=()=>{const index=clips.findIndex(c=>m.ts>=c.start&&m.ts<=c.end);if(index<0)return;selectPlayback(index);v.currentTime=Math.max(0,(m.ts-clips[index].start)/1000-1);void v.play().catch(()=>{});};transcript.append(row);});
  }
  if(!v.src)selectPlayback(Math.min(playbackIndex,clips.length-1));else select.value=String(playbackIndex);
 }
 async function submitVideo(){
  if(uploading||!clips.length)return;
  const box=el('desktop-video-submit-status'),button=el('desktop-video-submit');
  if(!driveUrl()){box.textContent='尚未設定影片收件服務。';return;}
  if(!state.studentName||!state.studentId){box.textContent='請先完成姓名與學號。';return;}
  if(clips.some(c=>c.blob.size>50*1024*1024)){box.textContent='有影片超過50MB，尚未繳交。';return;}
  const queue=clips.slice();uploading=true;button.disabled=true;
  try{
   const now=new Date(),date=now.toLocaleDateString('sv-SE'),hm=String(now.getHours()).padStart(2,'0')+String(now.getMinutes()).padStart(2,'0');
   const clean=v=>String(v||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,20);
   const prefix=[clean(state.studentId),clean(state.studentName),clean(getCase()?.name),date.slice(5).replace(/-/g,'')+'_'+hm].join('_');
   const folder=state.submitted?.folder||prefix;
   for(let n=0;n<queue.length;n++){
    const clip=queue[n];if(clip.uploaded)continue;
    if(!clip.upload)clip.upload={classCode:getSettings().classCode||'',date,folder,uploadId:crypto.randomUUID(),total:Math.ceil(clip.blob.size/(256*1024)),file:{name:prefix+'_會談影片_'+(n+1)+(clip.blob.type.includes('mp4')?'.mp4':'.webm'),type:clip.blob.type,size:clip.blob.size}};
    const meta=clip.upload;
    for(let i=0;i<meta.total;i++){
     box.textContent='影片 '+(n+1)+'／'+queue.length+'：'+Math.round(i/meta.total*100)+'%';
     const data=await blobToBase64(clip.blob.slice(i*256*1024,(i+1)*256*1024));
     await drivePost({...meta,action:'video-chunk',index:i,file:{...meta.file,data}});
    }
    box.textContent='正在確認影片完整性…';const r=await drivePost({...meta,action:'video-finish'});
    if(r.size!==clip.blob.size)throw new Error('影片大小不符');clip.uploaded=true;
   }
   box.textContent='會談影片已繳交。';
  }catch(e){box.textContent='影片尚未全部繳交，請稍後重試。';}
  finally{uploading=false;button.disabled=false;}
 }
 function reset(){practice++;stop();pausePlayback();clips=[];playbackUrls.forEach(url=>URL.revokeObjectURL(url));playbackUrls=[];playbackIndex=0;const v=el('desktop-replay-video');if(v){v.removeAttribute('src');v.load();}renderPlayback();}
 el('avatar-wrap').append(el('desktop-record-panel'));
 window.DesktopRecording={isDesktop:()=>mode==='desktop',start,stop,preview,stopPreview,setMode,setEnabled,disable,refresh,renderPlayback,pausePlayback,submitVideo,reset};refresh();
})();
