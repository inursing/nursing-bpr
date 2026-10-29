function renderPracticeMode(){
  const classroom=getSettings().practiceMode==='classroom';
  const label=classroom?'課堂練習 · OpenAI':'課後練習 · Claude';
  document.getElementById('practice-mode-badge').textContent=label;
  document.getElementById('conv-practice-mode').textContent=label;
  document.getElementById('practice-mode-current').textContent='目前：'+label;
  document.getElementById('set-ownkey').checked=!classroom;
}
function choosePracticeMode(mode,access=''){
  if(state.phase==='conv')stopConversationMedia();
  const st=getSettings();st.practiceMode=mode;st.classroomAccess=access;
  localStorage.setItem(SET_KEY,JSON.stringify(st));state.sid=null;saveState();renderPracticeMode();
}
function useHomeworkPractice(){choosePracticeMode('homework');toast('已切換課後練習');}
async function joinClassroomPractice(){
  const out=document.getElementById('practice-mode-current'),code=document.getElementById('classroom-code').value.trim();
  if(!code){out.textContent='請輸入本次課堂代碼';return;}
  try{
    const r=await fetch(getSettings().proxyUrl+'/classroom/join',{method:'POST',headers:proxyHeaders({'Content-Type':'application/json'}),body:JSON.stringify({code})});const j=await r.json();if(!r.ok)throw new Error(j.error||'無法進入課堂');
    choosePracticeMode('classroom',j.access);document.getElementById('classroom-code').value='';toast('已進入課堂練習');
  }catch(e){out.textContent=e.message;}
}
async function teacherClassroom(enabled){
  saveSettings();openSettings();document.getElementById('teacher-tools').open=true;
  const out=document.getElementById('teacher-classroom-status');
  try{
    const r=await fetch(getSettings().proxyUrl+'/admin/classroom',{method:'POST',headers:proxyHeaders({'Content-Type':'application/json'}),body:JSON.stringify({enabled,code:document.getElementById('teacher-classroom-code').value.trim()})});const j=await r.json();if(!r.ok)throw new Error(j.error||'課堂設定失敗');
    out.textContent=j.enabled?'課堂已開啟，請將本次代碼提供給學生。':'課堂已關閉，學生無法再使用課堂 AI。';
    document.getElementById('teacher-classroom-code').value='';
  }catch(e){out.textContent=e.message;}
}
async function resetAllClassroomCounts(){
  if(!confirm('將所有學生的課堂練習次數歸零？作業與評值資料會保留。'))return;
  saveSettings();openSettings();document.getElementById('teacher-tools').open=true;
  const out=document.getElementById('quota-list');out.textContent='重設中…';
  try{
    const r=await fetch(getSettings().proxyUrl+'/admin/quota',{headers:proxyHeaders()});const j=await r.json();if(!r.ok)throw new Error(j.error||'無法讀取課堂次數');
    let reset=0;for(const row of j.students||[]){if(!row.used)continue;const r=await fetch(getSettings().proxyUrl+'/admin/quota',{method:'POST',headers:proxyHeaders({'Content-Type':'application/json'}),body:JSON.stringify({studentId:row.studentId,count:0})});if(!r.ok)throw new Error('部分次數尚未重設，請重新操作');reset++;}
    await teacherQuota('list');toast('已重設 '+reset+' 位學生的課堂次數');
  }catch(e){out.textContent=e.message;}
}
renderPracticeMode();
