import { clearSessionCookie, getActiveSubscription, getGoSoloAccess, setSessionCookie, stripeRequest } from "../lib/billing.js";

const supabaseBase = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const supabaseAnon = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const normalizedEmail = value => String(value || "").trim().toLowerCase();

async function requireUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) { const error = new Error("Create a GoSolo account or log in before subscribing."); error.status = 401; throw error; }
  if (!supabaseBase() || !supabaseAnon()) throw new Error("GoSolo account verification is not configured.");
  const response = await fetch(supabaseBase() + "/auth/v1/user", {
    headers: { apikey: supabaseAnon(), Authorization: "Bearer " + token }
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user.id || !user.email) { const error = new Error("Your GoSolo login expired. Log in again."); error.status = 401; throw error; }
  return user;
}

function sessionBelongsToUser(session, user) {
  const linkedUserId = session.client_reference_id || session.metadata?.supabase_user_id || session.subscription_details?.metadata?.supabase_user_id;
  if (linkedUserId) return linkedUserId === user.id;
  const email = session.customer_details?.email || session.customer_email;
  return !!email && normalizedEmail(email) === normalizedEmail(user.email);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = String(req.query?.action || req.body?.action || "");

  try {
    if (action === "checkout" && req.method === "POST") {
      const user = await requireUser(req);
      const monthlyPriceId = String(process.env.STRIPE_PRICE_ID || "").trim();
      const introCouponId = String(process.env.STRIPE_INTRO_COUPON_ID || "").trim();
      if (monthlyPriceId !== "price_1Uezma2RG6SNDPSAw5x50cdS" || !/^price_[A-Za-z0-9]+$/.test(monthlyPriceId)) {
        throw new Error("GoSolo's canonical $29.99 monthly Stripe price is not configured in STRIPE_PRICE_ID.");
      }
      if (introCouponId !== "qRKwI8OU" || !/^[A-Za-z0-9]+$/.test(introCouponId)) {
        throw new Error("GoSolo's existing $24.99 introductory coupon is not configured in STRIPE_INTRO_COUPON_ID.");
      }
      if (!process.env.APP_SESSION_SECRET) throw new Error("APP_SESSION_SECRET is missing in Vercel.");

      const [monthlyPrice, introCoupon] = await Promise.all([
        stripeRequest("prices/" + encodeURIComponent(monthlyPriceId)),
        stripeRequest("coupons/" + encodeURIComponent(introCouponId))
      ]);
      if (!monthlyPrice.active || monthlyPrice.type !== "recurring" || monthlyPrice.recurring?.interval !== "month" || monthlyPrice.unit_amount !== 2999 || monthlyPrice.currency !== "usd" || monthlyPrice.product !== "prod_VXpyzV5dwa471p") {
        throw new Error("The canonical GoSolo Stripe price must be active at $29.99 USD per month on GoSolo AI Monthly.");
      }
      if (!introCoupon.valid || introCoupon.amount_off !== 2499 || introCoupon.duration !== "once" || introCoupon.currency !== "usd") {
        throw new Error("The existing GoSolo introductory coupon must be valid, $24.99 off, once, in USD.");
      }

      const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
      const params = new URLSearchParams();
      params.set("mode", "subscription");
      params.set("line_items[0][price]", monthlyPriceId);
      params.set("line_items[0][quantity]", "1");
      params.set("discounts[0][coupon]", introCouponId);
      params.set("client_reference_id", user.id);
      params.set("customer_email", user.email);
      params.set("success_url", origin + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}");
      params.set("cancel_url", origin + "/?checkout=cancelled");
      params.set("billing_address_collection", "auto");
      params.set("subscription_data[metadata][product]", "gosolo_ai");
      params.set("subscription_data[metadata][supabase_user_id]", user.id);

      const session = await stripeRequest("checkout/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "gosolo-checkout-" + user.id + "-" + Date.now() },
        body: params.toString()
      });
      return res.status(200).json({ url: session.url });
    }

    if (action === "confirm" && req.method === "GET") {
      const user = await requireUser(req);
      const sessionId = String(req.query?.session_id || "");
      if (!sessionId.startsWith("cs_")) return res.status(400).json({ error: "Invalid checkout session." });
      const session = await stripeRequest("checkout/sessions/" + encodeURIComponent(sessionId));
      if (!sessionBelongsToUser(session, user)) return res.status(403).json({ error: "This checkout does not belong to your GoSolo account." });
      if (session.mode !== "subscription" || session.payment_status !== "paid" || !session.subscription) {
        return res.status(402).json({ error: "Your $5 introductory payment is not complete yet." });
      }
      setSessionCookie(res, session.id);
      return res.status(200).json({ success: true, email: session.customer_details?.email || user.email });
    }

    if (action === "status" && req.method === "GET") {
      const access = await getGoSoloAccess(req);
      if (!access) return res.status(200).json({ active: false, owner: false });
      if (access.owner) return res.status(200).json({ active: true, owner: true, status: "owner" });
      return res.status(200).json({
        active: true,
        owner: false,
        status: access.subscription.status,
        currentPeriodEnd: access.subscription.current_period_end
      });
    }

    if (action === "portal" && req.method === "POST") {
      const user = await requireUser(req);
      const active = await getActiveSubscription(req);
      if (!active || !sessionBelongsToUser(active.checkout, user)) return res.status(401).json({ error: "An active GoSolo subscription for this account is required." });
      const customer = active.checkout.customer;
      const customerId = typeof customer === "string" ? customer : customer?.id;
      if (!customerId) throw new Error("Stripe customer record was not found.");
      const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
      const params = new URLSearchParams({ customer: customerId, return_url: origin + "/" });
      const portal = await stripeRequest("billing_portal/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      return res.status(200).json({ url: portal.url });
    }

    if (action === "logout" && req.method === "POST") {
      clearSessionCookie(res);
      return res.status(200).json({ success: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Unsupported billing action." });
  } catch (error) {
    console.error("GoSolo billing error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Billing service unavailable." });
  }
}
