import { neon } from "@neondatabase/serverless";
import { createHmac, timingSafeEqual } from "node:crypto";

export const config = { api: { bodyParser: false } };

const plans = {
  monthly: { amount: 20000, mode: "subscription" },
  "90-day": { amount: 50000, mode: "payment" },
  "6-month": { amount: 100000, mode: "payment" },
  "12-month": { amount: 200000, mode: "payment" }
};

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(part => {
    const i = part.indexOf("=");
    return i > 0 ? [part.slice(0, i), part.slice(i + 1)] : ["", ""];
  }).filter(([key]) => key));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(String(timestamp) + "." + payload).digest("hex");
  const supplied = Buffer.from(parts.v1, "hex");
  const calculated = Buffer.from(expected, "hex");
  return supplied.length === calculated.length && timingSafeEqual(supplied, calculated);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  if (!process.env.DATABASE_URL || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send("Payment verification is not configured");
  }
  let payload, event;
  try {
    payload = await rawBody(req);
    const signature = req.headers["stripe-signature"];
    if (!verifyStripeSignature(payload, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
      return res.status(400).send("Invalid Stripe signature");
    }
    event = JSON.parse(payload.toString("utf8"));
  } catch (error) {
    console.error("Stripe webhook request invalid", error);
    return res.status(400).send("Invalid webhook payload");
  }

  const supported = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (!supported.includes(event.type)) return res.status(200).json({ received: true, ignored: true });

  const session = event.data?.object;
  if (!session || session.object !== "checkout.session") return res.status(400).send("Invalid Checkout Session event");
  if (session.payment_status !== "paid") return res.status(200).json({ received: true, pending: true });

  const agreementId = String(session.client_reference_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agreementId)) {
    return res.status(200).json({ received: true, ignored: true, reason: "No valid agreement reference" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'`;
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT`;
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT`;
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS paid_amount BIGINT`;
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS paid_currency TEXT`;
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
    const agreements = await sql`SELECT id, plan_key FROM signed_agreements WHERE id = ${agreementId} LIMIT 1`;
    if (!agreements.length) return res.status(200).json({ received: true, ignored: true, reason: "Agreement not found" });
    const plan = plans[agreements[0].plan_key];
    const amount = Number(session.amount_total);
    const currency = String(session.currency || "").toLowerCase();
    if (!plan || amount !== plan.amount || currency !== "usd" || session.mode !== plan.mode) {
      console.warn("Stripe payment did not match signed plan", { agreementId, amount, currency, mode: session.mode });
      return res.status(200).json({ received: true, ignored: true, reason: "Payment does not match agreement plan" });
    }
    const paidAt = new Date(Number(session.created) * 1000);
    if (!Number.isFinite(paidAt.getTime())) return res.status(400).send("Invalid payment timestamp");
    const result = await sql`UPDATE signed_agreements
      SET payment_status = 'paid',
          stripe_checkout_session_id = ${String(session.id)},
          stripe_payment_intent_id = ${typeof session.payment_intent === "string" ? session.payment_intent : null},
          stripe_customer_id = ${typeof session.customer === "string" ? session.customer : null},
          paid_amount = ${amount},
          paid_currency = ${currency},
          paid_at = ${paidAt.toISOString()}
      WHERE id = ${agreementId}
        AND plan_key = ${agreements[0].plan_key}
        AND (payment_status <> 'paid' OR stripe_checkout_session_id = ${String(session.id)})
      RETURNING id`;
    return res.status(200).json({ received: true, updated: result.length > 0 });
  } catch (error) {
    console.error("Stripe webhook processing failed", error);
    return res.status(500).send("Unable to record payment");
  }
}
