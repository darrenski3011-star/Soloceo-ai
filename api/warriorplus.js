import { getGoSoloAccess } from "../lib/billing.js";

const API_BASE = "https://warriorplus.com/api/v2";

function safeLimit(value) {
  const n = Number.parseInt(String(value || "25"), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 25;
}

function safeCursor(value) {
  const cursor = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(cursor) ? cursor : "";
}

async function warriorRequest(path, params, apiKey) {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: "GET",
    headers: { apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {
    throw new Error("WarriorPlus returned an unreadable response.");
  }

  // WarriorPlus uses HTTP 402 for a valid list request with no matching records.
  if (response.status === 402) {
    return { success: 1, object: "list", data: [], has_more: "false", total_count: null };
  }
  if (!response.ok) {
    const message = response.status === 401
      ? "WarriorPlus rejected the saved API key. Recheck it in WarriorPlus and update Vercel if needed."
      : response.status === 429
        ? "WarriorPlus rate limit reached. Wait a little and retry."
        : String(data?.message || data?.error || "WarriorPlus request failed.");
    const error = new Error(message);
    error.status = response.status === 401 ? 502 : response.status === 429 ? 429 : 502;
    throw error;
  }
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Authorization");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use a GET request." });
  }

  try {
    const access = await getGoSoloAccess(req);
    if (!access) {
      return res.status(402).json({ error: "Log in with the GoSolo owner account or an active GoSolo subscription to access this integration." });
    }

    const apiKey = String(process.env.WARRIORPLUS_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(503).json({ connected: false, error: "WARRIORPLUS_API_KEY is not configured in the GoSolo Vercel project." });
    }

    const action = String(req.query?.action || "overview").toLowerCase();
    const limit = safeLimit(req.query?.limit);
    const cursor = safeCursor(req.query?.starting_after);
    const pagination = { limit, ...(cursor ? { starting_after: cursor } : {}) };

    if (action === "status") {
      // A real authenticated API request verifies the saved key without exposing it.
      const check = await warriorRequest("/products", { limit: 1 }, apiKey);
      return res.status(200).json({
        connected: true,
        provider: "WarriorPlus",
        api: "v2",
        checkedAt: new Date().toISOString(),
        productsAvailable: Array.isArray(check.data) ? check.data.length : 0
      });
    }

    const endpoints = {
      products: ["/products", pagination],
      offers: ["/offers", pagination],
      sales: ["/sales", { ...pagination, ...(req.query?.as === "affiliate" ? { as: "affiliate" } : {}) }],
      purchases: ["/purchases", pagination]
    };

    if (action === "overview") {
      const entries = await Promise.all(
        ["products", "offers", "sales", "purchases"].map(async key => {
          const [path, params] = endpoints[key];
          const result = await warriorRequest(path, params, apiKey);
          return [key, {
            data: Array.isArray(result.data) ? result.data : [],
            has_more: result.has_more === "true",
            total_count: result.total_count ?? null
          }];
        })
      );
      return res.status(200).json({
        connected: true,
        provider: "WarriorPlus",
        api: "v2",
        checkedAt: new Date().toISOString(),
        ...Object.fromEntries(entries)
      });
    }

    if (!endpoints[action]) {
      return res.status(400).json({ error: "Choose status, overview, products, offers, sales, or purchases." });
    }

    const [path, params] = endpoints[action];
    const result = await warriorRequest(path, params, apiKey);
    return res.status(200).json({
      connected: true,
      provider: "WarriorPlus",
      action,
      data: Array.isArray(result.data) ? result.data : [],
      has_more: result.has_more === "true",
      total_count: result.total_count ?? null
    });
  } catch (error) {
    console.error("GoSolo WarriorPlus integration error:", error.message);
    return res.status(error.status || 502).json({
      connected: false,
      error: error.message || "WarriorPlus integration is temporarily unavailable."
    });
  }
}
