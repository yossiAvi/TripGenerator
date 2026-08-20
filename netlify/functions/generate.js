// netlify/functions/generate.js
// מתווך בין הדפדפן למודל. המפתח יושב כאן בלבד ולא נחשף למשתמש.
//
// משתני סביבה שצריך להגדיר בנטליפיי (Site settings → Environment variables):
//   GEMINI_API_KEY     — מפתח חינמי מ-aistudio.google.com  (מומלץ להתחלה)
//   ANTHROPIC_API_KEY  — מפתח בתשלום מ-console.anthropic.com (איכות גבוהה יותר)
// מספיק להגדיר אחד מהם. אם שניהם מוגדרים, ANTHROPIC_API_KEY מקבל עדיפות.
//
// אופציונלי:
//   DAILY_LIMIT_PER_IP — כמה בקשות ליום לכל כתובת (ברירת מחדל 60, בערך 5 טיולים)
//   GEMINI_MODEL       — ברירת מחדל gemini-2.5-flash
//   ANTHROPIC_MODEL    — ברירת מחדל claude-sonnet-4-6

const hits = new Map(); // מונה בזיכרון. מתאפס כשהפונקציה נרדמת — הגנה בסיסית, לא חומת אש.

function tooMany(ip, limit) {
  const today = new Date().toISOString().slice(0, 10);
  const key = ip + '|' + today;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  return n > limit;
}

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST בלבד' }), { status: 405, headers: cors });

  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  const limit = +(process.env.DAILY_LIMIT_PER_IP || 60);
  if (tooMany(ip, limit)) {
    return new Response(JSON.stringify({ error: 'הגעתם למכסה היומית. נסו שוב מחר, או השתמשו במפתח אישי בהגדרות.' }),
      { status: 429, headers: cors });
  }

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'בקשה לא תקינה' }), { status: 400, headers: cors }); }

  const messages = body.messages || [];
  const prompt = messages.map(m => m.content).join('\n').slice(0, 12000);
  if (!prompt) return new Response(JSON.stringify({ error: 'חסרה הנחיה' }), { status: 400, headers: cors });

  const rawAnthropicKey = process.env.ANTHROPIC_API_KEY;
  // Netlify injects a JWT as ANTHROPIC_API_KEY for their own integration — ignore it
  const anthropicKey = rawAnthropicKey && rawAnthropicKey.startsWith('sk-ant-') ? rawAnthropicKey : null;
  const geminiKey = process.env.GEMINI_API_KEY;

  try {
    if (anthropicKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
          max_tokens: Math.min(body.max_tokens || 1200, 2000),
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await r.json();
      if (!r.ok) return new Response(JSON.stringify({ error: (data.error && data.error.message) || 'שגיאה מהמודל' }), { status: r.status, headers: cors });
      return new Response(JSON.stringify(data), { status: 200, headers: cors });
    }

    if (geminiKey) {
      const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, temperature: 0.8, responseMimeType: 'application/json' }
        })
      });
      const data = await r.json();
      if (!r.ok) {
        console.error('Gemini error', r.status, JSON.stringify(data));
        return new Response(JSON.stringify({ error: (data.error && data.error.message) || 'שגיאה מהמודל' }), { status: r.status, headers: cors });
      }
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      const text = parts.map(p => p.text || '').join('');
      // מוחזר במבנה של אנתרופיק כדי שהדפדפן לא יצטרך לדעת מי הספק
      return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ error: 'לא הוגדר מפתח בשרת' }), { status: 501, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'לא הצלחנו להגיע למודל' }), { status: 502, headers: cors });
  }
};

export const config = { path: '/api/generate' };
