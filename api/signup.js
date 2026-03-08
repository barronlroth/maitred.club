module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'POST only' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, message: 'Valid email required' });
  }

  // Debug: check env vars are present
  const envCheck = {
    SHEET_ID: !!process.env.SHEET_ID,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: !!process.env.GOOGLE_REFRESH_TOKEN,
  };

  const missing = Object.entries(envCheck).filter(([k, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    return res.status(500).json({ ok: false, message: `Missing env: ${missing.join(', ')}` });
  }

  try {
    // Get access token
    const tokenParams = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      return res.status(500).json({ ok: false, message: 'Token refresh failed', detail: tokenData.error || 'unknown' });
    }
    const accessToken = tokenData.access_token;
    const sheetId = process.env.SHEET_ID;

    // Check for duplicate
    const existingResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Signups!A:A`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const existingData = await existingResp.json();
    const emails = (existingData.values || []).flat();
    if (emails.includes(email)) {
      return res.status(200).json({ ok: true, message: 'Already on the list' });
    }

    // Append row
    const timestamp = new Date().toISOString();
    const appendResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Signups!A:C:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [[email, timestamp, 'website']] }),
      }
    );
    const appendData = await appendResp.json();
    if (appendData.error) {
      return res.status(500).json({ ok: false, message: 'Sheets error', detail: appendData.error.message });
    }

    return res.status(200).json({ ok: true, message: 'Signed up' });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Server error', detail: err.message });
  }
};
