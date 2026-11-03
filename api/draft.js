import { getActiveSubscription } from "../lib/billing.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use a POST request." });
  }

  try {
    const access = await getActiveSubscription(req);
    if (!access) {
      return res.status(402).json({ error: "Subscribe to GoSolo to prepare AI outreach drafts." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "AI drafting is not configured. Add GEMINI_API_KEY in Vercel." });
    }

    const body = req.body || {};
    const prospect = body.prospect || {};
    const name = String(prospect.name || "").trim().slice(0, 200);
    const contact = String(prospect.contact || "").trim().slice(0, 500);
    const need = String(prospect.need || "").trim().slice(0, 500);
    const notes = String(prospect.notes || "").trim().slice(0, 1200);
    const service = String(body.service || "").trim().slice(0, 300);
    const area = String(body.area || "").trim().slice(0, 200);
    const business = String(body.business || "").trim().slice(0, 500);

    if (!name || !service) {
      return res.status(400).json({ error: "A prospect name and your service are required." });
    }

    const prompt = `Write one concise, natural first-contact outreach draft for this business.
Do not send it. Return only the message text, with no subject line or commentary.
Use a respectful, low-pressure tone and a clear, simple question.
Do not claim the prospect requested help, has a problem, or is interested unless the supplied facts explicitly say so.
Do not invent prior contact, referrals, results, credentials, prices, guarantees, or facts.
If the need is uncertain, introduce the service without pretending it is confirmed.
Keep it under 120 words and include an easy way to decline further contact.

Sender business: ${business || service}
Service offered: ${service}
Service area: ${area || "Not specified"}
Prospect name: ${name}
Public contact/source: ${contact || "Not supplied"}
Known need: ${need || "Not verified"}
Research notes: ${notes || "None"}`;

    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 350 }
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const raw = await response.text();
    let data = {};
    try { data = JSON.parse(raw); } catch {}

    if (!response.ok) {
      console.error("GoSolo draft Gemini error:", response.status, raw.slice(0, 400));
      return res.status(502).json({
        error: data?.error?.message || "AI could not prepare the draft. Check the Gemini model setting and try again."
      });
    }

    const draft = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "").join("").trim();

    if (!draft) return res.status(502).json({ error: "AI returned an empty draft. Please try again." });

    return res.status(200).json({ success: true, draft });
  } catch (error) {
    console.error("GoSolo outreach draft error:", error);
    return res.status(502).json({ error: "Could not prepare the outreach draft. Please try again." });
  }
}
