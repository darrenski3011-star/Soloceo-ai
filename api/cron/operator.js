export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

  const cronSecret = process.env.CRON_SECRET || "";
  const authorization = String(req.headers.authorization || "");
  if (!cronSecret || authorization !== "Bearer " + cronSecret) {
    return res.status(401).json({ error: "Unauthorized cron request." });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  const geminiKey = process.env.GEMINI_API_KEY || "";
  if (!supabaseUrl || !anonKey || !stripeKey || !geminiKey) {
    return res.status(503).json({ error: "GoSolo background operator needs Supabase, Stripe and Gemini environment variables." });
  }

  try {
    const response = await fetch(supabaseUrl + "/functions/v1/gosolo-operator", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: "Bearer " + anonKey,
        "x-gosolo-cron-secret": cronSecret,
        "x-gosolo-stripe-key": stripeKey,
        "x-gosolo-gemini-key": geminiKey
      },
      body: "{}",
      signal: AbortSignal.timeout(55000)
    });
    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}
    if (!response.ok) {
      console.error("GoSolo Edge operator returned:", response.status, raw.slice(0, 500));
      return res.status(response.status).json(data);
    }
    return res.status(200).json(data);
  } catch (error) {
    console.error("GoSolo cron proxy error:", error);
    return res.status(502).json({ error: "Could not reach the GoSolo background operator." });
  }
}
