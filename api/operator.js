import { getActiveSubscription } from "../lib/billing.js";

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

function nextDailyRun() {\n  const next = new Date();\n  next.setUTCHours(15, 0, 0, 0);\n  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);\n  return next.toISOString();\n}\n\nfunction emailOf(value) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Use GET or POST." });

  try {
    const access = await getActiveSubscription(req);
    if (!access) return res.status(402).json({ error: "An active GoSolo subscription is required to run the operator." });
    const user = await getUser(req);
    const checkoutEmail = access.checkout.customer_details?.email || access.checkout.customer_email || "";
    if (checkoutEmail && emailOf(checkoutEmail) !== emailOf(user.email)) {
      return res.status(403).json({ error: "Your GoSolo account email must match the email on your subscription." });
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
        stripe_session_id: access.checkout.id,
        business,
        tasks: current?.tasks || business.tasks || [],
        assets: current?.assets || business.assets || [],
        approval_queue: current?.approval_queue || business.approvalQueue || [],
        activity: current?.activity || [],
        status: "active",
        next_run_at: nextDailyRun(),
        last_error: null,
        updated_at: new Date().toISOString()
      };
      const saved = await db(req, "/rest/v1/operator_workspaces?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      });
      return res.status(200).json({ success: true, workspace: saved?.[0] || record, message: "GoSolo operator started. Your first internal work cycle is queued for the next daily run." });
    }

    if (!current) return res.status(404).json({ error: "No operator workspace exists yet. Build your business and start the operator." });

    if (action === "pause" || action === "resume") {
      const patch = action === "pause"
        ? { status: "paused", updated_at: new Date().toISOString() }
        : { status: "active", next_run_at: nextDailyRun(), last_error: null, updated_at: new Date().toISOString() };
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
