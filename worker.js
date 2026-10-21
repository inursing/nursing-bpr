// 行為過程紀錄練習平台 — 金鑰代理（Cloudflare Worker）
// 金鑰放在 Worker 的 Secrets（GEMINI_KEY、AZURE_KEY、AZURE_REGION、CLASS_CODE），
// 學生的瀏覽器只拿到 Worker 網址 + 課程代碼，永遠看不到金鑰。
//
// 需要設定的 Variables and Secrets（Settings → Variables and Secrets → Add）：
//   GEMINI_KEY    = 你的 Gemini API 金鑰（Secret）
//   AZURE_KEY     = 你的 Azure 語音金鑰（Secret）
//   AZURE_REGION  = 例如 eastasia（Text 即可）
//   CLASS_CODE    = 自訂課程代碼，例如 n2026fall（Secret；每學期可以換）
//   ALLOWED_ORIGIN= （可選）只允許某個網站呼叫，例如 https://inursing.github.io
//   MAX_SESSIONS  = 每位學生可用課堂金鑰練習的次數，例如 3（Text；留空＝不限制）
//   TEACHER_TOKEN = 教師密語（Secret）：教師自己的瀏覽器不受次數限制，也可用來重設學生次數
// 另需綁定 KV：Settings → Bindings → Add → KV namespace，變數名稱 QUOTA（用來記每位學生的次數）

const CORS = (env, origin) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || origin || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Class-Code, X-Session, X-Teacher-Token',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',
});

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = CORS(env, origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (url.pathname === '/' || url.pathname === '/ping') return json({ ok: true, service: 'nursing-bpr-proxy' });

    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json({ error: 'origin not allowed' }, 403);

    // 課程代碼檢查
    if (env.CLASS_CODE && req.headers.get('X-Class-Code') !== env.CLASS_CODE) return json({ error: '課程代碼錯誤' }, 401);

    const isTeacher = !!env.TEACHER_TOKEN && req.headers.get('X-Teacher-Token') === env.TEACHER_TOKEN;
    const maxSessions = parseInt(env.MAX_SESSIONS || '0', 10) || 0;
    const quotaOn = maxSessions > 0 && !!env.QUOTA;

    // ---- 練習次數：POST /session/start {studentId, name} → 登記一次練習，回傳 sid 與剩餘次數 ----
    if (url.pathname === '/session/start' && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch (e) {}
      const sid = crypto.randomUUID();
      if (!quotaOn || isTeacher) {
        if (env.QUOTA) await env.QUOTA.put('sid:' + sid, '1', { expirationTtl: 4 * 3600 });
        return json({ ok: true, sid, remaining: null, limited: false });
      }
      const id = String(b.studentId || '').trim();
      if (!id) return json({ error: '請先填寫學號，課堂金鑰需以學號計算練習次數' }, 400);
      const key = 'count:' + id.toLowerCase();
      const used = parseInt((await env.QUOTA.get(key)) || '0', 10);
      if (used >= maxSessions) return json({ error: `課堂金鑰的練習次數已用完（${maxSessions} 次）。課後練習請到「設定 → ④ 學生課後練習」改用自己的金鑰。`, used, max: maxSessions }, 403);
      await env.QUOTA.put(key, String(used + 1));
      await env.QUOTA.put('log:' + id.toLowerCase() + ':' + Date.now(), JSON.stringify({ name: b.name || '', at: new Date().toISOString() }), { expirationTtl: 180 * 86400 });
      await env.QUOTA.put('sid:' + sid, '1', { expirationTtl: 4 * 3600 });
      return json({ ok: true, sid, remaining: maxSessions - used - 1, used: used + 1, max: maxSessions, limited: true });
    }

    // ---- 教師：GET /admin/quota?student=學號 查詢；POST /admin/quota {studentId, count} 重設 ----
    if (url.pathname === '/admin/quota') {
      if (!isTeacher) return json({ error: '教師密語錯誤' }, 401);
      if (!env.QUOTA) return json({ error: '未綁定 KV（QUOTA）' }, 500);
      if (req.method === 'GET') {
        const sid = (url.searchParams.get('student') || '').trim().toLowerCase();
        if (sid) return json({ studentId: sid, used: parseInt((await env.QUOTA.get('count:' + sid)) || '0', 10), max: maxSessions });
        const list = await env.QUOTA.list({ prefix: 'count:' });
        const rows = [];
        for (const k of list.keys) rows.push({ studentId: k.name.slice(6), used: parseInt((await env.QUOTA.get(k.name)) || '0', 10) });
        return json({ max: maxSessions, students: rows });
      }
      if (req.method === 'POST') {
        let b = {}; try { b = await req.json(); } catch (e) {}
        const sid = String(b.studentId || '').trim().toLowerCase(); if (!sid) return json({ error: '缺少學號' }, 400);
        await env.QUOTA.put('count:' + sid, String(parseInt(b.count || '0', 10) || 0));
        return json({ ok: true, studentId: sid, used: parseInt(b.count || '0', 10) || 0 });
      }
    }

    // Gemini 呼叫需有有效的練習 sid（教師或未啟用次數限制時免檢查）
    const needSid = quotaOn && !isTeacher && url.pathname.startsWith('/gemini/');
    if (needSid) {
      const sid = req.headers.get('X-Session') || '';
      if (!sid || !(await env.QUOTA.get('sid:' + sid))) return json({ error: '練習尚未登記或已逾時，請重新開始會談' }, 403);
    }

    // ---- Gemini：POST /gemini/<model>:<method>[?alt=sse] ----
    let m = url.pathname.match(/^\/gemini\/([A-Za-z0-9.\-]+):(generateContent|streamGenerateContent)$/);
    if (m && req.method === 'POST') {
      if (!env.GEMINI_KEY) return json({ error: 'GEMINI_KEY 未設定' }, 500);
      const alt = url.searchParams.get('alt');
      const target = `https://generativelanguage.googleapis.com/v1beta/models/${m[1]}:${m[2]}${alt ? '?alt=' + alt : ''}`;
      const r = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
        body: req.body,
      });
      const h = new Headers(r.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      return new Response(r.body, { status: r.status, headers: h });
    }

    // ---- Azure 語音：GET /azure/token → 10 分鐘有效的短期 token ----
    if (url.pathname === '/azure/token' && req.method === 'GET') {
      if (!env.AZURE_KEY || !env.AZURE_REGION) return json({ error: 'AZURE_KEY / AZURE_REGION 未設定' }, 500);
      const r = await fetch(`https://${env.AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_KEY, 'Content-Length': '0' },
      });
      if (!r.ok) return json({ error: 'Azure token 失敗 ' + r.status }, 502);
      return json({ token: await r.text(), region: env.AZURE_REGION, expiresIn: 540 });
    }

    return json({ error: 'not found' }, 404);
  },
};
