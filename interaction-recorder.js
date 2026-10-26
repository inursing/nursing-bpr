/* Record the actual patient feed and nurse camera together; never replay TTS to record it. */
(() => {
  function create({camera,context,patientAudio,info,conversation,microphone=()=>null}) {
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=640;
    const g=canvas.getContext('2d'), destination=context.createMediaStreamDestination();
    const nurse=document.getElementById('cam-video');
    let mic=null, micTrack=null, remote=null, remoteTrack=null, stopped=false;
    function syncMicrophone(){
      const input=camera.getAudioTracks().length?camera:microphone();
      const track=input?.getAudioTracks().find(t=>t.readyState!=='ended')||null;
      if(track===micTrack)return;
      try{mic?.disconnect();}catch{}mic=null;micTrack=track;
      if(track){mic=context.createMediaStreamSource(input);mic.connect(destination);}
    }
    syncMicrophone();
    if(patientAudio)patientAudio.connect(destination);
    const fit=(el,x,y,w,h,mirror=false)=>{
      const sw=el.videoWidth||el.naturalWidth,sh=el.videoHeight||el.naturalHeight;
      if(!sw||!sh)return false;
      const scale=Math.min(w/sw,h/sh),dw=sw*scale,dh=sh*scale;
      g.save();g.beginPath();g.rect(x,y,w,h);g.clip();
      if(mirror){g.translate(x+w,y);g.scale(-1,1);g.drawImage(el,(w-dw)/2,(h-dh)/2,dw,dh);}
      else g.drawImage(el,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
      g.restore();return true;
    };
    const text=(s,x,y,max,lines=2)=>{
      let row='',n=0;
      for(const ch of String(s||'')){if(g.measureText(row+ch).width>max){g.fillText(row,x,y+n*24);row='';if(++n>=lines)return;}row+=ch;}
      if(row)g.fillText(row,x,y+n*24);
    };
    function draw(){
      if(stopped)return;
      syncMicrophone();
      const live=document.getElementById('live-patient-video');
      const active=!!window.LivePatient?.active&&live?.readyState>=2;
      const audio=document.getElementById('live-patient-audio');
      const track=active?audio?.srcObject?.getAudioTracks()[0]:null;
      if(track!==remoteTrack){
        if(remote)remote.disconnect();remote=null;remoteTrack=track||null;
        if(track){remote=context.createMediaStreamSource(new MediaStream([track]));remote.connect(destination);}
      }
      g.fillStyle='#171b30';g.fillRect(0,0,960,640);
      g.fillStyle='#fff';g.font='bold 21px sans-serif';
      text(info(),20,30,920,1);
      const portrait=document.querySelector('#avatar-3d .patient-art');
      let shown=false;
      // A foreign image without CORS taints the canvas and blocks captureStream.
      const portraitSafe=portrait&&(new URL(portrait.currentSrc||portrait.src,location.href).origin===location.origin||portrait.crossOrigin==='anonymous');
      try{shown=active?fit(live,12,78,462,376):!!portraitSafe&&fit(portrait,12,78,462,376);}catch{}
      if(!shown){g.font='20px sans-serif';text('病人畫面尚未就緒',100,260,300,1);}
      try{fit(nurse,486,78,462,376,true);}catch{}
      g.fillStyle='#fff';g.font='18px sans-serif';
      text(active?'虛擬病人 · Live實際影像':'虛擬病人 · 情境插畫',20,64,440,1);
      text('護生 · 當時鏡頭',494,64,440,1);
      g.fillStyle='#f5efe5';g.fillRect(12,466,936,162);
      const msgs=conversation().filter(m=>m.role==='nurse'||m.role==='patient').slice(-2);
      g.fillStyle='#202443';g.font='18px sans-serif';
      msgs.forEach((m,i)=>text((m.role==='nurse'?'護生：':'病人：')+m.text,24,494+i*66,908,2));
      if(!mic){g.fillStyle='#fff';g.font='14px sans-serif';text('目前未接收護生麥克風；護生發言請參照字幕。',20,452,920,1);}
    }
    draw();const timer=setInterval(draw,67);
    let stream;
    try{stream=canvas.captureStream(15);}catch(e){
      stopped=true;clearInterval(timer);
      try{mic?.disconnect();remote?.disconnect();patientAudio?.disconnect(destination);}catch{}
      destination.stream.getTracks().forEach(t=>t.stop());
      throw new Error(e.name==='SecurityError'?'病人圖片尚未更新，請重新整理後再試。':'此瀏覽器無法建立互動錄影，請改用最新版 Safari 或 Chrome。');
    }
    destination.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
    return {stream,stop(){
      if(stopped)return;stopped=true;clearInterval(timer);
      try{mic?.disconnect();remote?.disconnect();patientAudio?.disconnect(destination);}catch{}
      stream.getTracks().forEach(t=>t.stop());
    }};
  }
  window.InteractionRecorder={create};
})();
