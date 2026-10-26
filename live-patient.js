/* Teacher preview: case 6 uses Simli preset Daniel with the existing patient audio. */
(() => {
  let client=null, generation=0, connected=false, busy=false, ending=false, connectJob=null;
  let idleTimer=null, limitTimer=null, finishSpeech=null, lastActivity=0, utteranceStarted=false;
  const host=document.getElementById('avatar-engine');
  const panel=document.createElement('div');
  panel.style.cssText='position:absolute;inset:0;z-index:3;background:#171b30;display:none';
  panel.innerHTML='<video id="live-patient-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:contain"></video><audio id="live-patient-audio" autoplay></audio><span style="position:absolute;top:12px;right:12px;background:#233a31;color:white;padding:4px 10px;border-radius:14px;font-size:12px">LIVE · 吳先生（內建人物）</span>';
  host.append(panel);
  const controls=document.createElement('div');
  controls.className='info-box';
  controls.style.cssText='margin:8px 0;display:none';
  controls.innerHTML='<button type="button" id="live-patient-start" hidden>開始真人影像</button> <button type="button" class="btn btn-outline btn-sm" id="live-patient-stop" hidden>結束 Live</button><div id="live-patient-status" style="font-size:.8rem;margin-top:6px" role="status">按麥克風開始會談時啟動吳先生真人影像（教師預覽，最多3分鐘）。</div>';
  document.getElementById('stage').before(controls);
  const start=controls.querySelector('#live-patient-start'), stop=controls.querySelector('#live-patient-stop'), status=controls.querySelector('#live-patient-status');
  const video=panel.querySelector('video'), audio=panel.querySelector('audio');
  const message=t=>{status.textContent=t;};
  function refresh(){
    const c=getCase(); controls.style.display=state.phase==='conv'&&c?.id===6&&getSettings().teacherToken?'block':'none';
    start.disabled=!!client; stop.hidden=!client;
    const unmute=controls.querySelector('#live-patient-unmute');if(unmute)unmute.disabled=!connected;
  }
  function touch(){lastActivity=Date.now();}
  async function disconnect(reason=null){
    const hadSession=!!client||start.disabled;
    generation++; connected=false; busy=false; ending=true;
    clearInterval(idleTimer); clearTimeout(limitTimer); idleTimer=null; limitTimer=null;
    if(finishSpeech){finishSpeech();finishSpeech=null;}
    const old=client; client=null;
    panel.style.display='none'; audio.pause(); video.pause();
    audio.srcObject=null;video.srcObject=null;
    if(old){try{await old.stop();}catch{}try{await old.audioContext?.close();}catch{}}
    ending=false;message(reason||(hadSession?'Live 已結束，恢復靜態人物。':'按麥克風開始會談時啟動吳先生真人影像（教師預覽，最多3分鐘）。'));refresh();
  }
  function connect(){
    if(connectJob)return connectJob;
    const job=openConnection().finally(()=>{if(connectJob===job)connectJob=null;});connectJob=job;return job;
  }
  async function openConnection(){
    if(client||state.phase!=='conv'||getCase()?.id!==6) return;
    if(isSpeaking||(SentenceSpeaker.current&&SentenceSpeaker.current.playing)){message('請等病人說完，再啟動 Live。');return;}
    const st=getSettings();
    if(!proxyConfigured()||!st.teacherToken){message('此為教師測試：請先在設定填入既有教師密語。');return;}
    if(!window.SimliSDK){message('Live 元件載入失敗，請重新整理。');return;}
    const id=++generation;start.disabled=true;message('正在建立 Live 連線，最多等待20秒…');
    try{
      const r=await fetch(st.proxyUrl+'/simli/session',{method:'POST',headers:proxyHeaders({'Content-Type':'application/json'}),body:JSON.stringify({caseId:6}),signal:AbortSignal.timeout(15000)});
      const config=await r.json();
      if(!r.ok) throw new Error(config.error||'Live 連線失敗');
      if(id!==generation||state.phase!=='conv') return;
      const c=new SimliSDK.SimliClient(config.session_token,video,audio,null,SimliSDK.LogLevel.ERROR,'livekit');
      c.MAX_RETRY_ATTEMPTS=0; client=c;
      // The SDK's start event confirms a rendered video frame, not just an open socket.
      c.on('start',()=>{if(id!==generation) return;connected=true;panel.style.display='block';video.play().catch(()=>{});audio.play().catch(()=>message('Live 已連線，請點「播放聲音」允許聲音。'));touch();message('Live 已連線。嘴型隨病人語音；30秒無音訊或離開頁面即斷線。');refresh();});
      c.on('speaking',()=>{if(id!==generation)return;utteranceStarted=true;busy=true;touch();pauseListening();});
      c.on('silent',()=>{if(id!==generation||!utteranceStarted)return;utteranceStarted=false;busy=false;touch();if(finishSpeech){const done=finishSpeech;finishSpeech=null;setTimeout(done,600);}});
      for(const event of ['stop','error','startup_error']) c.on(event,()=>{if(id===generation&&!ending) void disconnect('Live 連線已結束；未自動重連。可查看逐字稿或按麥克風重新開始。');});
      // Keep the element renderable while waiting for the first frame callback.
      panel.style.display='block';panel.style.opacity='0';
      let timer;
      try{await Promise.race([c.start(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Live 連線逾時，未自動重試')),20000)})]);}finally{clearTimeout(timer);panel.style.opacity='1';}
      if(id!==generation){try{await c.stop();}catch{}return;}
      if(!connected) throw new Error('尚未收到 Live 影像');
      limitTimer=setTimeout(()=>void disconnect('三分鐘教師預覽已結束；未自動續接。'),180000);
      idleTimer=setInterval(()=>{if(!busy&&Date.now()-lastActivity>30000) void disconnect('已閒置30秒，Live 已自動斷線以節省分鐘。');},1000);
    }catch(e){if(id===generation) await disconnect(String(e.message||'Live 啟動失敗')+'；未自動重試。');}
    finally{refresh();}
  }
  async function pcm(blob){
    const ac=new AudioContext();let decoded;
    try{decoded=await ac.decodeAudioData(await blob.arrayBuffer());}finally{await ac.close();}
    const offline=new OfflineAudioContext(1,Math.max(1,Math.ceil(decoded.duration*16000)),16000);
    const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
    const buffer=await offline.startRendering(), samples=buffer.getChannelData(0);
    const bytes=new Uint8Array(samples.length*2), view=new DataView(bytes.buffer);
    for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));view.setInt16(i*2,Math.round(x<0?x*32768:x*32767),true);}
    return bytes;
  }
  async function speak(blobOrObj){
    const id=generation,c=client;if(!connected||!c)throw new Error('Live 未連線');
    busy=true;utteranceStarted=false;touch();pauseListening();
    const data=await pcm(blobOrObj?.blob||blobOrObj);
    if(id!==generation)return;
    await new Promise(resolve=>{
      let done=false,timer;
      const complete=()=>{if(done)return;done=true;clearTimeout(timer);if(finishSpeech===complete)finishSpeech=null;busy=false;lastSpeakEnd=Date.now();resolve();};
      finishSpeech=complete;
      timer=setTimeout(()=>{if(id===generation)void disconnect('Live 語音回傳逾時，已停止連線；未重複播放。');complete();},data.length/32+15000);
      try{for(let i=0;i<data.length;i+=6000)c.sendAudioData(data.slice(i,i+6000));}catch{void disconnect('Live 傳送失敗，已停止連線；未自動重試。');complete();}
    });
  }
  controls.insertAdjacentHTML('beforeend','<button type="button" class="btn btn-outline btn-sm" id="live-patient-unmute">播放聲音</button>');
  controls.querySelector('#live-patient-unmute').onclick=()=>{if(connected)audio.play().catch(()=>message('瀏覽器尚未允許聲音，請確認音訊設定。'));};
  start.onclick=()=>void connect();stop.onclick=()=>void disconnect();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&client)void disconnect('已離開頁面，Live 已斷線以節省分鐘。');});
  window.addEventListener('pagehide',()=>{if(client)void disconnect();});
  window.LivePatient={refresh,connect,ready:()=>connectJob||Promise.resolve(),stop:disconnect,speak,get active(){return connected},get busy(){return busy},clear(){if(client){try{client.ClearBuffer();}catch{}}if(finishSpeech){finishSpeech();finishSpeech=null;}busy=false;lastSpeakEnd=Date.now();}};
  refresh();
})();
