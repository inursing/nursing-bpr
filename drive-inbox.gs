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

function getOrCreate(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function sanitize(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120); }
function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
