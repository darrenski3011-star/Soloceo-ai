import { getActiveSubscription } from "../lib/billing.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use a POST request." });
  }

  try {
    const access = await getActiveSubscription(req);
    if (!access) return res.status(402).json({ error: "A GoSolo subscription is required to research prospects." });
    const body = req.body || {};
    const service = String(body.service || "").trim().slice(0, 300);
    const area = String(body.area || "").trim().slice(0, 200);

    if (!service || !area) {
      return res.status(400).json({ error: "Enter a service and service area." });
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "Prospect research is not connected yet. Add FIRECRAWL_API_KEY to the GoSolo Vercel project environment variables, then redeploy." });
    }
    async function searchPublicWeb(query) {
      const response = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey
        },
        body: JSON.stringify({
          query,
          limit: 10,
          sources: ["web"]
        }),
        signal: AbortSignal.timeout(25000)
      });
      const raw = await response.text();
      let data = {};
      try { data = JSON.parse(raw); } catch {}
      if (!response.ok) {
        console.error("Firecrawl search failed:", response.status, raw.slice(0, 400));
        const error = new Error(response.status === 401 || response.status === 403
          ? "Firecrawl rejected the API key. Check FIRECRAWL_API_KEY in Vercel."
          : "Public prospect research is temporarily unavailable. Please try again.");
        error.status = response.status;
        throw error;
      }
      const web = data?.data?.web || data?.web || data?.data?.results || data?.results || [];
      return Array.isArray(web) ? web : [];
    }

    // Start broad: the old query required people to use phrases like "looking for"
    // and often returned zero results even when relevant local businesses existed.
    let web = await searchPublicWeb(service + " businesses and potential customers in " + area);
    if (!web.length) {
      web = await searchPublicWeb(service + " near " + area + " local companies organizations property managers");
    }

    // Search results are public research leads, not verified buyers.

    const seen = new Set();
    const results = web
      .filter(item => item && typeof item.url === "string" && /^https?:\/\//i.test(item.url))
      .filter(item => {
        const key = item.url.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8)
      .map(item => ({
        title: String(item.title || "Public web result").slice(0, 300),
        url: item.url,
        description: String(item.description || item.snippet || "").slice(0, 1200)
      }));

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error("GoSolo prospect research error:", error);
    return res.status(502).json({
      error: "Prospect research timed out or could not connect. Try again."
    });
  }
}
