export const config = { maxDuration: 60 };

import { getGoSoloAccess } from "../lib/billing.js";

const base = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const anon = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

async function getUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Log in to your GoSolo account first.");
  if (!base() || !anon()) throw new Error("Supabase authentication is not configured.");
  const response = await fetch(base() + "/auth/v1/user", {
    headers: { apikey: anon(), Authorization: "Bearer " + token }
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user.id || !user.email) throw new Error("Your GoSolo login expired. Log in again.");
  return user;
}

async function db(req, path, options = {}) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const response = await fetch(base() + path, {
    ...options,
    headers: {
      apikey: anon(),
      Authorization: "Bearer " + token,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) throw new Error(data?.message || data?.hint || "Could not save the operator workspace.");
  return data;
}

async function triggerWorker() {
  const secret = process.env.CRON_SECRET || "";
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  const geminiKey = process.env.GEMINI_API_KEY || "";
  if (!secret || !stripeKey || !geminiKey || !base() || !anon()) return { started: false, reason: "Background worker secrets are not configured." };
  const response = await fetch(base() + "/functions/v1/gosolo-operator", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anon(), Authorization: "Bearer " + anon(), "x-gosolo-cron-secret": secret, "x-gosolo-stripe-key": stripeKey, "x-gosolo-gemini-key": geminiKey },
    body: "{}",
    signal: AbortSignal.timeout(50000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not start the first operator cycle.");
  return { started: true, processed: data.processed || 0, due: data.due || 0 };
}


async function warriorPlusRequest(path, params, apiKey) {
  const url = new URL("https://warriorplus.com/api/v2" + path);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, { headers: { apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("WarriorPlus returned an unreadable response."); }
  if (response.status === 402) return { success: 1, data: [], has_more: "false", total_count: null };
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "WarriorPlus rejected the saved API key. Recheck it in WarriorPlus and update Vercel if needed." : response.status === 429 ? "WarriorPlus rate limit reached. Wait and retry." : String(data.message || data.error || "WarriorPlus request failed."));
    error.status = response.status === 401 ? 502 : response.status === 429 ? 429 : 502;
    throw error;
  }
  return data;
}

async function handleWarriorPlus(req, res) {
  const apiKey = String(process.env.WARRIORPLUS_API_KEY || "").trim();
  if (!apiKey) return res.status(503).json({ connected: false, error: "WARRIORPLUS_API_KEY is not configured in Vercel." });
  const action = String(req.query?.action || "overview").toLowerCase();
  const parsedLimit = Number.parseInt(String(req.query?.limit || "25"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 25;
  const cursor = String(req.query?.starting_after || "").trim();
  const pagination = { limit, ...( /^[A-Za-z0-9_-]{1,100}$/.test(cursor) ? { starting_after: cursor } : {}) };
  const endpoints = {
    products: ["/products", pagination],
    offers: ["/offers", pagination],
    sales: ["/sales", { ...pagination, ...(req.query?.as === "affiliate" ? { as: "affiliate" } : {}) }],
    purchases: ["/purchases", pagination]
  };
  if (action === "status") {
    const check = await warriorPlusRequest("/products", { limit: 1 }, apiKey);
    return res.status(200).json({ connected: true, provider: "WarriorPlus", api: "v2", checkedAt: new Date().toISOString(), productsAvailable: Array.isArray(check.data) ? check.data.length : 0 });
  }
  if (action === "overview") {
    const entries = await Promise.all(Object.keys(endpoints).map(async key => {
      const pair = endpoints[key];
      const result = await warriorPlusRequest(pair[0], pair[1], apiKey);
      return [key, { data: Array.isArray(result.data) ? result.data : [], has_more: result.has_more === "true", total_count: result.total_count ?? null }];
    }));
    return res.status(200).json({ connected: true, provider: "WarriorPlus", api: "v2", checkedAt: new Date().toISOString(), ...Object.fromEntries(entries) });
  }
  if (!endpoints[action]) return res.status(400).json({ error: "Choose status, overview, products, offers, sales, or purchases." });
  const pair = endpoints[action];
  const result = await warriorPlusRequest(pair[0], pair[1], apiKey);
  return res.status(200).json({ connected: true, provider: "WarriorPlus", action, data: Array.isArray(result.data) ? result.data : [], has_more: result.has_more === "true", total_count: result.total_count ?? null });
}

function emailOf(value) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Use GET or POST." });

  try {
    const user = await getUser(req);
    const access = await getGoSoloAccess(req);
    if (!access) return res.status(402).json({ error: "An active GoSolo subscription is required to run the operator." });
    if (!access.owner) {
      const checkoutEmail = access.checkout.customer_details?.email || access.checkout.customer_email || "";
      if (checkoutEmail && emailOf(checkoutEmail) !== emailOf(user.email)) {
        return res.status(403).json({ error: "Your GoSolo account email must match the email on your subscription." });
      }
    }

    if (req.method === "GET" && String(req.query?.resource || "").toLowerCase() === "warriorplus") {
      try { return await handleWarriorPlus(req, res); }
      catch (error) {
        console.error("GoSolo WarriorPlus integration error:", error.message);
        return res.status(error.status || 502).json({ connected: false, error: error.message || "WarriorPlus integration unavailable." });
      }
    }

    const query = "/rest/v1/operator_workspaces?select=*&user_id=eq." + encodeURIComponent(user.id);
    if (req.method === "GET") {
      const rows = await db(req, query);
      return res.status(200).json({ workspace: rows?.[0] || null });
    }

    const body = req.body || {};
    const action = String(body.action || "");
    const rows = await db(req, query);
    const current = rows?.[0] || null;

    if (action === "start" || action === "resume") {
      const business = body.business && typeof body.business === "object"
        ? body.business
        : current?.business || {};
      if (!business.businessName && !business.businessModel && !business.offer) {
        return res.status(400).json({ error: "Build your business first, then start the operator." });
      }
      const record = {
        user_id: user.id,
        stripe_session_id: access.owner ? "owner:" + user.id : access.checkout.id,
        business,
        tasks: current?.tasks || business.tasks || [],
        assets: current?.assets || business.assets || [],
        approval_queue: current?.approval_queue || business.approvalQueue || [],
        activity: current?.activity || [],
        status: "active",
        next_run_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString()
      };
      const saved = await db(req, "/rest/v1/operator_workspaces?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      });
      let firstCycle = null;
      try { firstCycle = await triggerWorker(); } catch (error) { console.error("GoSolo first operator cycle did not start:", error); }
      const refreshed = await db(req, query);
      return res.status(200).json({ success: true, workspace: refreshed?.[0] || saved?.[0] || record, firstCycle, message: firstCycle?.started ? "GoSolo operator started and the first internal cycle ran." : "GoSolo operator started. The first internal cycle is queued for the daily scheduler." });
    }

    if (!current) return res.status(404).json({ error: "No operator workspace exists yet. Build your business and start the operator." });

    if (action === "pause" || action === "resume") {
      const patch = action === "pause"
        ? { status: "paused", updated_at: new Date().toISOString() }
        : { status: "active", next_run_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() };
      const saved = await db(req, query, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch)
      });
      return res.status(200).json({ success: true, workspace: saved?.[0] || null });
    }

    if (action === "decision") {
      const approvalId = String(body.approvalId || "");
      const decision = body.decision === "approved" ? "approved" : body.decision === "rejected" ? "rejected" : "";
      if (!approvalId || !decision) return res.status(400).json({ error: "Choose an approval and a valid decision." });
      const queue = Array.isArray(current.approval_queue) ? current.approval_queue : [];
      const updated = queue.map(item => item.id === approvalId
        ? { ...item, status: decision, decided_at: new Date().toISOString(), note: "Decision recorded. No external action was performed." }
        : item);
      if (!queue.some(item => item.id === approvalId)) return res.status(404).json({ error: "Approval item not found." });
      const saved = await db(req, query, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ approval_queue: updated, updated_at: new Date().toISOString() })
      });
      return res.status(200).json({ success: true, workspace: saved?.[0] || null });
    }

    return res.status(400).json({ error: "Unknown operator action." });
  } catch (error) {
    console.error("GoSolo operator API error:", error);
    return res.status(500).json({ error: error.message || "Operator service unavailable." });
  }
}
