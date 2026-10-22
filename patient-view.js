/* Stable character display. No frame swapping, head movement or image scaling. */
(() => {
  const host=document.getElementById('avatar-3d');
  host.innerHTML='<div class="patient-scene"><div class="patient-art-frame"><div class="patient-motion"><img class="patient-art" alt=""></div><div class="portrait-error" hidden>病人插畫載入失敗，請重新整理。</div></div><div class="patient-identity"></div><div class="patient-audio"><span class="speaking-dot" aria-hidden="true"></span><span class="audio-label">準備好，慢慢開始對話</span></div><span class="portrait-note">病人情境插畫</span></div>';
  const image=host.querySelector('.patient-art'),label=host.querySelector('.audio-label');
  let currentSrc='';
  image.onload=()=>{image.hidden=false;host.querySelector('.portrait-error').hidden=true;};
  image.onerror=()=>{image.hidden=true;host.querySelector('.portrait-error').hidden=false;};
  const speaking=active=>{host.classList.toggle('is-speaking',active);label.textContent=active?'病人正在說話…':'正在聆聽';};
  window.Avatar3D={
    async load(url,person={}){
      speaking(false);label.textContent='準備好，慢慢開始對話';
      if(url!==currentSrc){currentSrc=url;image.src=url;}
      image.alt=`${person.name||'模擬病人'}，${person.age||''}歲${person.gender||''}性病人插畫`;
      host.querySelector('.patient-identity').textContent=`${person.name||'病人'} · ${person.age||''} 歲 · ${person.gender||''}`;
    },
    startMouth(){speaking(true);},stopMouth(){speaking(false);},
    setExpression(){},gesture(){},setViseme(){},setSpeakHint(){},setMouthLevel(){},
  };
})();
