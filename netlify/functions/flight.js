// netlify/functions/flight.js
// מחפש פרטי טיסה לפי מספר טיסה ותאריך.
//
// משתנה סביבה בנטליפיי:
//   AVIATION_API_KEY — מפתח חינמי מ-aviationstack.com (100 בקשות/חודש בחינם)
//
// הרשמה חינמית: https://aviationstack.com/signup/free

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8'
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST בלבד' }), { status: 405, headers: cors });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'בקשה לא תקינה' }), { status: 400, headers: cors });
  }

  const { flight, date } = body;
  if (!flight) return new Response(JSON.stringify({ error: 'חסר מספר טיסה' }), { status: 400, headers: cors });

  const key = process.env.AVIATION_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'no_key' }), { status: 501, headers: cors });
  }

  try {
    const num = String(flight).toUpperCase().replace(/\s/g, '');
    const params = new URLSearchParams({ access_key: key, flight_iata: num });
    if (date) params.set('flight_date', date);

    const r = await fetch(`https://api.aviationstack.com/v1/flights?${params}`);
    const data = await r.json();

    if (!r.ok) {
      const msg = (data.error && data.error.message) || 'שגיאת API';
      return new Response(JSON.stringify({ error: msg }), { status: r.status, headers: cors });
    }

    const flights = (data.data || []).filter(f => f.departure && f.arrival);
    if (!flights.length) {
      return new Response(JSON.stringify({ error: 'טיסה לא נמצאה. בדקו שהמספר והתאריך נכונים.' }), { status: 404, headers: cors });
    }

    // Sort: prefer upcoming/today flights
    const pick = flights[0];

    // Times come as ISO UTC strings — slice HH:MM
    const hhmm = iso => iso ? iso.replace('Z','').slice(11, 16) : '';

    return new Response(JSON.stringify({
      flight:  pick.flight?.iata  || num,
      date:    pick.flight_date   || date || '',
      status:  pick.flight_status || '',
      from: {
        iata:    pick.departure?.iata    || '',
        airport: pick.departure?.airport || '',
        timeUtc: hhmm(pick.departure?.scheduled),
        timeLocal: hhmm(pick.departure?.estimated || pick.departure?.scheduled)
      },
      to: {
        iata:    pick.arrival?.iata    || '',
        airport: pick.arrival?.airport || '',
        timeUtc: hhmm(pick.arrival?.scheduled),
        timeLocal: hhmm(pick.arrival?.estimated || pick.arrival?.scheduled)
      }
    }), { status: 200, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'לא הצלחנו לאחזר נתונים' }), { status: 502, headers: cors });
  }
};

export const config = { path: '/api/flight' };
