/* Optional local desktop recording. Never uploads footage or sends frames to AI. */
(() => {
 let mode=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)?'mobile':'desktop';
 let enabled=false,stream=null,recorder=null,capture=null,epoch=0,pending=false,clips=[],practice=0;
 const el=id=>document.getElementById(id);
 function refresh(){
  document.body.classList.toggle('desktop-practice',mode==='desktop');
  el('practice-device').value=mode;el('desktop-record-choice').hidden=mode!=='desktop';el('desktop-record-enabled').checked=enabled;
 }
 function stop(){
  epoch++;pending=false;
  const r=recorder;recorder=null;
  try{if(r&&r.state!=='inactive')r.stop();}catch{}
  const c=capture;capture=null;try{c?.stop();}catch{}
  stream?.getTracks().forEach(t=>t.stop());stream=null;
  const v=el('cam-video');if(v){v.pause();v.srcObject=null;}
  el('desktop-record-panel').hidden=true;
 }
 function setMode(value){mode=value==='desktop'?'desktop':'mobile';if(mode==='mobile'){enabled=false;stop();}refresh();}
 function setEnabled(value){enabled=mode==='desktop'&&!!value;if(!enabled)stop();refresh();}
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
   r.onstop=()=>{const blob=new Blob(chunks,{type:r.mimeType||'video/webm'});if(blob.size&&caseId===state.caseId&&practiceId===practice){clips.push({blob,identity});renderDownloads();}};
   r.onerror=()=>{stop();toast('錄影中斷，仍可繼續會談。');};
   recorder=r;r.start(1000);el('desktop-record-status').textContent='● 錄影中';
  }catch(e){if(generation===epoch){stop();enabled=false;refresh();toast('無法錄影，仍可繼續會談。');}}
  finally{if(generation===epoch)pending=false;}
 }
 function renderDownloads(){
  const box=el('desktop-record-downloads');if(!box)return;box.replaceChildren();box.hidden=!clips.length;
  if(!clips.length)return;const title=document.createElement('h3');title.textContent='會談影片';box.append(title);
  clips.forEach((clip,i)=>{const b=document.createElement('button');b.type='button';b.className='btn btn-outline btn-sm';b.style.margin='8px 8px 0 0';b.textContent='下載影片'+(clips.length>1?' '+(i+1):'');b.onclick=()=>saveBlob(clip.identity+'_會談_'+(i+1)+((clip.blob.type||'').includes('mp4')?'.mp4':'.webm'),clip.blob);box.append(b);});
 }
 function reset(){practice++;stop();clips=[];renderDownloads();}
 el('avatar-wrap').append(el('desktop-record-panel'));
 window.DesktopRecording={start,stop,setMode,setEnabled,disable,refresh,renderDownloads,reset};refresh();
})();
