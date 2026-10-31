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
