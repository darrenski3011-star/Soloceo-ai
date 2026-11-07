import crypto from "node:crypto";

const COOKIE = "gosolo_access";

function secret() {
  return process.env.APP_SESSION_SECRET || "";
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function readSession(req) {
  if (!secret()) return null;
  const raw = String(req.headers.cookie || "").split(";").map(x => x.trim())
    .find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [sessionId, signature] = decodeURIComponent(raw).split(".");
  if (!sessionId || !signature || !safeEqual(sign(sessionId), signature)) return null;
  return sessionId;
}

export function setSessionCookie(res, sessionId) {
  const value = encodeURIComponent(sessionId + "." + sign(sessionId));
  res.setHeader("Set-Cookie", COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000");
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
}

export async function stripeRequest(path, options = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not connected yet. Add STRIPE_SECRET_KEY in Vercel.");
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + key,
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  if (!response.ok) {
    console.error("Stripe API error:", response.status, raw.slice(0, 500));
    throw new Error(data?.error?.message || "Stripe request failed.");
  }
  return data;
}

export async function getActiveSubscription(req) {
  const sessionId = readSession(req);
  if (!sessionId) return null;
  const checkout = await stripeRequest("checkout/sessions/" + encodeURIComponent(sessionId));
  if (checkout.mode !== "subscription" || !checkout.subscription || checkout.payment_status !== "paid") return null;
  const subscriptionId = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription.id;
  const subscription = await stripeRequest("subscriptions/" + encodeURIComponent(subscriptionId));
  if (!["active", "trialing"].includes(subscription.status)) return null;
  return { checkout, subscription };
}


function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

// Owner access is granted only after Supabase verifies the bearer token.
// A client-supplied email or the GoSolo outgoing Gmail address is never trusted.
export async function getGoSoloAccess(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  const ownerEmail = normalizedEmail(process.env.GOSOLO_OWNER_EMAIL);
  if (token && ownerEmail) {
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\\/$/, "");
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (supabaseUrl && anonKey) {
      const response = await fetch(supabaseUrl + "/auth/v1/user", {
        headers: { apikey: anonKey, Authorization: "Bearer " + token }
      });
      const user = await response.json().catch(() => ({}));
      if (response.ok && user.id && normalizedEmail(user.email) === ownerEmail) {
        return { owner: true, userId: user.id, email: user.email };
      }
    }
  }
  return getActiveSubscription(req);
}
