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
  const lock=LockService.getScriptLock(); lock.waitLock(20000);
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
  } finally { lock.releaseLock(); }
}

function getOrCreate(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function sanitize(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120); }
function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
