import { operatorStore, operatorStoreReady } from "../../lib/operator-store.js";

function json(res, status, body) {
  return res.status(status).json(body);
}

async function stripe(path) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is missing.");
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    headers: { Authorization: "Bearer " + key }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Stripe verification failed.");
  return data;
}

async function makeDailyWork(workspace) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing.");
  const business = workspace.business || {};
  const prompt = `You are the internal operations engine for GoSolo AI.
Create the next useful piece of internal business work for this subscribed customer.
Business: ${JSON.stringify(business).slice(0, 5000)}
Existing tasks: ${JSON.stringify(workspace.tasks || []).slice(0, 3000)}
Existing assets: ${JSON.stringify(workspace.assets || []).slice(0, 3000)}
Existing approvals: ${JSON.stringify(workspace.approval_queue || []).slice(0, 3000)}
Rules:
- Do only internal research synthesis, planning, analysis, task organization, and draft creation.
- Never send messages, publish, spend money, purchase anything, create accounts, or make commitments.
- Never claim a lead, sale, customer, result, or revenue exists unless supplied as verified data.
- Prefer no-cost steps and recurring revenue.
- Do not repeat completed tasks. Keep output short and actionable.
- If an action would require contacting a person, publishing, spending, or committing, create an approval item instead of doing it.
Return only JSON with: summary (string), next_action (string), tasks_to_add (array of {title,description}), assets_to_add (array of {title,content}), approvals_to_add (array of {title,reason,proposed_action}), assumptions_to_check (array of strings).`;
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 1400, responseMimeType: "application/json" }
    }),
    signal: AbortSignal.timeout(25000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Gemini operator cycle failed.");
  const raw = data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
  if (!raw) throw new Error("Gemini returned an empty operator cycle.");
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return json(res, 405, { error: "Use GET." });
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization || "");
  if (!secret || auth !== "Bearer " + secret) return json(res, 401, { error: "Unauthorized cron request." });
  if (!operatorStoreReady()) return json(res, 503, { error: "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel before enabling background operator runs." });

  try {
    const due = await operatorStore("/rest/v1/operator_workspaces?select=*&status=eq.active&next_run_at=lte." + encodeURIComponent(new Date().toISOString()) + "&limit=5");
    let processed = 0;
    const errors = [];
    for (const workspace of due || []) {
      try {
        const checkout = await stripe("checkout/sessions/" + encodeURIComponent(workspace.stripe_session_id));
        if (checkout.mode !== "subscription" || checkout.payment_status !== "paid" || !checkout.subscription) {
          await operatorStore("/rest/v1/operator_workspaces?id=eq." + workspace.id, {
            method: "PATCH", body: JSON.stringify({ status: "paused", last_error: "Subscription is not paid and active.", updated_at: new Date().toISOString() })
          });
          continue;
        }
        const subId = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription.id;
        const subscription = await stripe("subscriptions/" + encodeURIComponent(subId));
        if (!["active", "trialing"].includes(subscription.status)) {
          await operatorStore("/rest/v1/operator_workspaces?id=eq." + workspace.id, {
            method: "PATCH", body: JSON.stringify({ status: "paused", last_error: "Subscription is no longer active.", updated_at: new Date().toISOString() })
          });
          continue;
        }

        const work = await makeDailyWork(workspace);
        const stamp = new Date().toISOString();
        const tasks = Array.isArray(workspace.tasks) ? [...workspace.tasks] : [];
        const assets = Array.isArray(workspace.assets) ? [...workspace.assets] : [];
        const approvals = Array.isArray(workspace.approval_queue) ? [...workspace.approval_queue] : [];
        for (const task of (work.tasks_to_add || []).slice(0, 3)) tasks.push({ id: crypto.randomUUID(), title: String(task.title || "Next task").slice(0, 180), description: String(task.description || "").slice(0, 1200), status: "pending", created_at: stamp, source: "daily_operator" });
        for (const asset of (work.assets_to_add || []).slice(0, 2)) assets.push({ id: crypto.randomUUID(), title: String(asset.title || "Business asset").slice(0, 180), content: String(asset.content || "").slice(0, 5000), created_at: stamp, source: "daily_operator" });
        for (const approval of (work.approvals_to_add || []).slice(0, 3)) approvals.push({ id: crypto.randomUUID(), title: String(approval.title || "Approval required").slice(0, 180), reason: String(approval.reason || "").slice(0, 1000), proposed_action: String(approval.proposed_action || "").slice(0, 1200), status: "pending", created_at: stamp });
        const activity = Array.isArray(workspace.activity) ? [...workspace.activity] : [];
        activity.unshift({ id: crypto.randomUUID(), at: stamp, summary: String(work.summary || "Completed an internal operator work cycle.").slice(0, 1000), next_action: String(work.next_action || "").slice(0, 500), assumptions_to_check: (work.assumptions_to_check || []).slice(0, 5) });
        await operatorStore("/rest/v1/operator_workspaces?id=eq." + workspace.id, {
          method: "PATCH",
          body: JSON.stringify({
            tasks: tasks.slice(-100), assets: assets.slice(-50), approval_queue: approvals.slice(-50),
            activity: activity.slice(0, 50), last_run_at: stamp,
            next_run_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            last_error: null, updated_at: stamp
          })
        });
        processed++;
      } catch (error) {
        errors.push({ workspace_id: workspace.id, error: error.message });
        await operatorStore("/rest/v1/operator_workspaces?id=eq." + workspace.id, {
          method: "PATCH",
          body: JSON.stringify({ next_run_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), last_error: String(error.message || "Operator run failed.").slice(0, 500), updated_at: new Date().toISOString() })
        });
      }
    }
    return json(res, 200, { success: true, due: due?.length || 0, processed, errors });
  } catch (error) {
    console.error("GoSolo cron operator error:", error);
    return json(res, 500, { error: error.message || "Background operator failed." });
  }
}
