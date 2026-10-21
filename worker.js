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

const CORS = (env, origin) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || origin || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Class-Code',
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
