// 行為過程紀錄練習平台 — Google Drive 收件（Google Apps Script 網頁應用程式）
// 學生按「繳交」後，檔案會存到你 Google Drive 的：
//   行為過程紀錄_學生繳交 / 2026-10-21 / 學號_姓名_1530_個案名 / （學生版PDF、AI版PDF、逐字稿、影片）
//
// 部署方式：script.google.com → 新專案 → 貼上本檔 → 部署 → 新增部署作業 →
//   類型「網頁應用程式」、執行身分「我」、存取權「所有人」→ 部署 → 複製「網頁應用程式網址」貼到平台設定。
// 之後若修改程式，要「管理部署作業 → 編輯 → 版本：新版本 → 部署」才會生效。

const ROOT_FOLDER_NAME = '行為過程紀錄_學生繳交';
const CLASS_CODE = 'nsysu2026';   // 與平台的課程代碼相同；留空字串則不檢查

function doGet() {
  return out({ ok: true, service: 'nursing-bpr-drive-inbox' });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (CLASS_CODE && d.classCode !== CLASS_CODE) return out({ ok: false, error: '課程代碼錯誤' });
    if (d.action === 'evaluation') return receiveEvaluation(d);
    if (d.action === 'video-chunk' || d.action === 'video-finish') return receiveVideo(d);
    if (!d.folder || !d.file) return out({ ok: false, error: '資料不完整' });

    const root = getOrCreate(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
    const day  = getOrCreate(root, sanitize(d.date || Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd')));
    const sub  = getOrCreate(day, sanitize(d.folder));

    const f = d.file;
    const bytes = Utilities.base64Decode(f.data);
    const blob = Utilities.newBlob(bytes, f.type || 'application/octet-stream', sanitize(f.name));
    // 同名覆蓋（學生重複繳交時以最後一次為準）
    const existing = sub.getFilesByName(blob.getName());
    while (existing.hasNext()) existing.next().setTrashed(true);
    const file = sub.createFile(blob);
    return out({ ok: true, folder: sub.getUrl(), file: file.getName(), size: bytes.length });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

// Decode small pieces independently, then assemble the original bytes into one playable file.
function receiveVideo(d) {
  const f=d.file||{}, total=Number(d.total), size=Number(f.size);
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(d.uploadId||'') || !Number.isInteger(total) || total<1 || total>200 || !Number.isInteger(size) || size<1 || size>50*1024*1024 || !d.folder || !f.name) throw new Error('影片上傳資料不完整或超過50MB');
  // Hold the shared mutex only for a short lease update, never during Drive I/O.
  // Different uploads can then write chunks concurrently.
  const leaseKey='video-lease:'+d.uploadId, leaseId=String(Date.now())+':'+Math.random();
  const leaseProps=PropertiesService.getScriptProperties();
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    const active=JSON.parse(leaseProps.getProperty(leaseKey)||'null');
    if(active&&active.until>Date.now())throw new Error('同一份影片仍在處理，請稍後重試');
    leaseProps.setProperty(leaseKey,JSON.stringify({id:leaseId,until:Date.now()+420000}));
  } finally {lock.releaseLock();}
  try {
    const props=PropertiesService.getScriptProperties(), key='video:'+d.uploadId;
    let m=JSON.parse(props.getProperty(key)||'null');
    if (!m) {
      if (d.action!=='video-chunk' || d.index!==0) throw new Error('影片上傳尚未開始，請重新繳交');
      const root=getOrCreate(DriveApp.getRootFolder(),ROOT_FOLDER_NAME);
      const day=getOrCreate(root,sanitize(d.date));
      const sub=getOrCreate(day,sanitize(d.folder));
      const temp=sub.createFolder('_影片上傳中_'+d.uploadId);
      m={temp:temp.getId(),target:sub.getId(),name:sanitize(f.name),type:f.type||'video/webm',total,size};
      props.setProperty(key,JSON.stringify(m));
    }
    if (m.total!==total || m.size!==size || m.name!==sanitize(f.name)) throw new Error('影片上傳資料不一致');
    const sub=DriveApp.getFolderById(m.target);
    if (m.done) return out({ok:true,folder:sub.getUrl(),size:m.size});
    const temp=DriveApp.getFolderById(m.temp);
    if (d.action==='video-chunk') {
      if (!Number.isInteger(d.index) || d.index<0 || d.index>=total || typeof f.data!=='string' || f.data.length>360000) throw new Error('影片分段格式錯誤');
      const bytes=Utilities.base64Decode(f.data);
      const expected=Math.min(256*1024,size-d.index*256*1024);
      if (bytes.length!==expected) throw new Error('影片分段大小不完整');
      const name=String(d.index), old=temp.getFilesByName(name);
      if (!old.hasNext()) temp.createFile(Utilities.newBlob(bytes,'application/octet-stream',name));
      return out({ok:true,index:d.index});
    }
    const bytes=[];
    for (let i=0;i<total;i++) {
      const it=temp.getFilesByName(String(i));
      if (!it.hasNext()) throw new Error('影片尚未傳完：缺少第'+(i+1)+'段');
      const part=it.next().getBlob().getBytes();
      for (let j=0;j<part.length;j++) bytes.push(part[j]);
    }
    if (bytes.length!==size) throw new Error('影片大小不完整，未標記繳交完成');
    const result=sub.createFile(Utilities.newBlob(bytes,m.type,m.name));
    m.done=result.getId(); props.setProperty(key,JSON.stringify(m));
    temp.setTrashed(true);
    return out({ok:true,folder:sub.getUrl(),file:result.getName(),size});
  } finally {
    const active=JSON.parse(leaseProps.getProperty(leaseKey)||'null');
    if(active&&active.id===leaseId)leaseProps.deleteProperty(leaseKey);
  }
}

function getOrCreate(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function sanitize(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120); }
function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Independent evaluation collection; no transcript, recording or AI request.
function receiveEvaluation(d){
 const e=d.evaluation||{},id=String(e.id||'');
 if(!/^[a-zA-Z0-9-]{16,64}$/.test(id)||!e.studentName||!e.studentId||!Array.isArray(e.ratings)||e.ratings.length!==10||e.ratings.some((n,i)=>!Number.isInteger(n)||n<(i<5?1:0)||n>5))throw new Error('評值資料不完整');
 const clean={id,studentName:String(e.studentName).slice(0,100),studentId:String(e.studentId).slice(0,100),caseName:String(e.caseName||'').slice(0,100),ratings:e.ratings,issues:String(e.issues||'').slice(0,2000),suggestions:String(e.suggestions||'').slice(0,2000),at:Utilities.formatDate(new Date(),'Asia/Taipei','yyyy-MM-dd HH:mm:ss')};
 const lock=LockService.getScriptLock();lock.waitLock(25000);
 try{
 const root=getOrCreate(DriveApp.getRootFolder(),'iNursing Lab_練習評值'),data=getOrCreate(root,'填答資料');
 const name=id+'.json',it=data.getFilesByName(name);
 if(it.hasNext())it.next().setContent(JSON.stringify(clean));else data.createFile(name,JSON.stringify(clean),'application/json');
 const all=[],files=data.getFiles();while(files.hasNext()){const f=files.next();if(/\.json$/.test(f.getName()))all.push(JSON.parse(f.getBlob().getDataAsString()));}all.sort((a,b)=>a.at.localeCompare(b.at));
 const q=['依會談目的互動','傾聽與回應感受需求','治療性溝通技巧','察覺待改善處','有助臨床準備','操作清楚易用','語音辨識正確','病人回應符合個案','聲音與Live適合情境','AI分析有助學習'];
 const rows=[['填答時間','學號','姓名','練習個案',...q,'遇到的問題','改善建議'],...all.map(x=>[x.at,x.studentId,x.studentName,x.caseName,...x.ratings.map(v=>v===0?'無法評估':v),x.issues,x.suggestions])];
 const summary=[['題目','有效評分人數','平均分數','無法評估人數'],...q.map((t,i)=>{const n=all.map(x=>x.ratings[i]).filter(v=>v>0);return[t,n.length,n.length?Math.round(n.reduce((a,b)=>a+b,0)/n.length*100)/100:'',all.length-n.length];}),['總填答筆數',all.length]];
 const blob=evaluationWorkbook(rows,summary),old=root.getFilesByName('練習評值統整.xlsx');
 const previous=[];while(old.hasNext())previous.push(old.next());
 root.createFile(blob);previous.forEach(f=>f.setTrashed(true));
 return out({ok:true,service:'evaluation-v1'});
 }finally{lock.releaseLock();}
}
function evaluationWorkbook(rows,summary){
 const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',esc=v=>String(v==null?'':v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const sheet=rs=>xml+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'+rs.map((r,i)=>'<row r="'+(i+1)+'">'+r.map(v=>typeof v==='number'?'<c><v>'+v+'</v></c>':'<c t="inlineStr"><is><t xml:space="preserve">'+esc(v)+'</t></is></c>').join('')+'</row>').join('')+'</sheetData></worksheet>';
 const ns='http://schemas.openxmlformats.org/package/2006/relationships';
 const parts={
 '[Content_Types].xml':xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
 '_rels/.rels':xml+'<Relationships xmlns="'+ns+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':xml+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="填答明細" sheetId="1" r:id="rId1"/><sheet name="評分摘要" sheetId="2" r:id="rId2"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':xml+'<Relationships xmlns="'+ns+'"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':sheet(rows),'xl/worksheets/sheet2.xml':sheet(summary)};
 return Utilities.zip(Object.keys(parts).map(n=>Utilities.newBlob(parts[n],'application/xml',n)),'練習評值統整.xlsx').setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
