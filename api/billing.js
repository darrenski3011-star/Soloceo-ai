import { clearSessionCookie, getActiveSubscription, getGoSoloAccess, setSessionCookie, stripeRequest } from "../lib/billing.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const action = String(req.query?.action || req.body?.action || "");

  try {
    if (action === "checkout" && req.method === "POST") {
      const priceId = String(process.env.STRIPE_PRICE_ID || "").trim().replace(/^["']+|["']+$/g, "");
      if (!/^price_[A-Za-z0-9]+$/.test(priceId)) throw new Error("The GoSolo monthly Stripe price ID is missing or incorrectly formatted in Vercel.");
      if (!process.env.APP_SESSION_SECRET) throw new Error("APP_SESSION_SECRET is missing in Vercel.");
      const price = await stripeRequest("prices/" + encodeURIComponent(priceId));
      if (!price.active || price.type !== "recurring" || price.recurring?.interval !== "month") {
        throw new Error("The configured GoSolo Stripe price must be active and billed monthly.");
      }
      const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host);
      const params = new URLSearchParams();
      params.set("mode", "subscription");
      params.set("line_items[0][price]", priceId);
      params.set("line_items[0][quantity]", "1");
      params.set("success_url", origin + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}");
      params.set("cancel_url", origin + "/?checkout=cancelled");
      params.set("billing_address_collection", "auto");
      params.set("allow_promotion_codes", "true");
      params.set("subscription_data[metadata][product]", "gosolo_ai");
      const session = await stripeRequest("checkout/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      return res.status(200).json({ url: session.url });
    }

    if (action === "confirm" && req.method === "GET") {
      const sessionId = String(req.query?.session_id || "");
      if (!sessionId.startsWith("cs_")) return res.status(400).json({ error: "Invalid checkout session." });
      const session = await stripeRequest("checkout/sessions/" + encodeURIComponent(sessionId));
      if (session.mode !== "subscription" || session.payment_status !== "paid" || !session.subscription) {
        return res.status(402).json({ error: "Payment is not complete yet." });
      }
      setSessionCookie(res, session.id);
      return res.status(200).json({ success: true, email: session.customer_details?.email || "" });
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
      const active = await getActiveSubscription(req);
      if (!active) return res.status(401).json({ error: "An active GoSolo subscription is required." });
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
    return res.status(500).json({ error: error.message || "Billing service unavailable." });
  }
}
