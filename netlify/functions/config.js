// netlify/functions/config.js
// מספק לדפדפן את פרטי החיבור הציבוריים של סופאבייס, כדי שהמשתמשים לא יצטרכו להגדיר כלום.
//
// משתני סביבה בנטליפיי:
//   SUPABASE_URL       — https://xxxx.supabase.co
//   SUPABASE_ANON_KEY  — המפתח המסומן anon public
//
// מפתח ה-anon נועד לרוץ בדפדפן והוא ציבורי מטבעו. לעולם אל תשימו כאן service_role.

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300'
  };
  // מנרמל כתובת: מקבלים לפעמים ".../rest/v1/" או לוכסן מיותר
  let url = (process.env.SUPABASE_URL || '').trim();
  if (url) {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
    try { url = new URL(url).origin; } catch { url = ''; }
  }
  const key = process.env.SUPABASE_ANON_KEY || '';

  if (!url || !key) return new Response(JSON.stringify({ supabase: null }), { status: 200, headers });
  if (/service_role/i.test(key) || key.length > 500) {
    return new Response(JSON.stringify({ supabase: null, error: 'מפתח לא מתאים' }), { status: 200, headers });
  }
  return new Response(JSON.stringify({ supabase: { url, key, shared: true } }), { status: 200, headers });
};

export const config = { path: '/api/config' };
