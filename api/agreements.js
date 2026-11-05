import { neon } from "@neondatabase/serverless";
import { Resend } from "resend";

const plans = {
  monthly: ["Monthly Recruiting Program", "$200 per month"],
  "90-day": ["90-Day Recruiting Program", "$500 one-time payment"],
  "6-month": ["6-Month Recruiting Development", "$1,000 one-time payment"],
  "12-month": ["12-Month Prospect Development", "$2,000 one-time payment"]
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ageOnToday(dateString) {
  const birth = new Date(dateString + "T00:00:00Z");
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== dateString) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() ||
      (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age <= 100 ? age : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Secure agreement storage is not configured. Please contact Saint-Crown before paying." });
  try {
    const b = req.body || {};
    const plan = plans[b.planKey];
    const athlete = String(b.athlete || "").trim().slice(0, 180);
    const dob = String(b.dob || "");
    const signer = String(b.signer || "").trim().slice(0, 180);
    const email = String(b.email || "").trim().toLowerCase();
    const phone = String(b.phone || "").trim().slice(0, 50);
    const relationship = String(b.relationship || "").trim().slice(0, 100);
    const submittedBy = String(b.submittedBy || "").trim().toLowerCase();
    const signature = String(b.signature || "").trim().slice(0, 180);
    const age = ageOnToday(dob);
    const norm = s => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
    if (!plan || !athlete || !signer || !emailPattern.test(email) ||
        phone.replace(/\D/g, "").length < 7 || !relationship || !["athlete", "parent", "guardian"].includes(submittedBy) || age === null ||
        b.authority !== true || b.agree !== true || norm(signature) !== norm(signer)) {
      return res.status(400).json({ error: "Please check the required details, consent boxes and matching typed signature." });
    }
    if (age < 18 && !/(parent|guardian)/i.test(relationship)) {
      return res.status(400).json({ error: "An athlete under 18 must have a parent or legal guardian sign." });
    }
    if (age >= 18 && !/(self|athlete)/i.test(relationship)) {
      return res.status(400).json({ error: "An athlete aged 18 or older must sign for themselves." });
    }
    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS signed_agreements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      athlete_name TEXT NOT NULL,
      plan_key TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      plan_price TEXT NOT NULL,
      signer_name TEXT NOT NULL,
      signer_email TEXT NOT NULL,
      signer_phone TEXT NOT NULL,
      relationship TEXT NOT NULL,
      submitted_by TEXT NOT NULL DEFAULT 'athlete',
      typed_signature TEXT NOT NULL,
      authority_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
      social_media_consent BOOLEAN NOT NULL DEFAULT FALSE,
      agreement_version TEXT NOT NULL,
      signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE signed_agreements ADD COLUMN IF NOT EXISTS submitted_by TEXT NOT NULL DEFAULT 'athlete'`;
    const rows = await sql`INSERT INTO signed_agreements
      (athlete_name, plan_key, plan_name, plan_price, signer_name, signer_email, signer_phone,
       relationship, submitted_by, typed_signature, authority_confirmed, terms_accepted, social_media_consent, agreement_version)
      VALUES (${athlete}, ${b.planKey}, ${plan[0]}, ${plan[1]}, ${signer}, ${email}, ${phone},
       ${relationship}, ${submittedBy}, ${signature}, TRUE, TRUE, ${b.social === true}, '2026-11-04')
      RETURNING id, signed_at AS "signedAt"`;
    let emailsSent = false;
    if (process.env.RESEND_API_KEY && process.env.APPLICATION_FROM_EMAIL) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const notify = process.env.APPLICATION_NOTIFY_EMAIL || "SaintCrownRecruiting@gmail.com";
        const message = `A signed Saint-Crown Recruiting agreement was recorded.\n\nProgram: ${plan[0]} — ${plan[1]}\nAthlete: ${athlete}\nSigner: ${signer}\nEmail: ${email}\nPhone: ${phone}\nSigner relationship: ${relationship}\nSubmitted by: ${submittedBy}\nTyped signature: ${signature}\nPublic social-media consent: ${b.social === true ? "Yes" : "No"}\nReference: ${rows[0].id}\n\nThe complete record is available in the authenticated staff workspace.`;
        await Promise.all([
          resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: notify, subject: "Signed Saint-Crown agreement: " + athlete, text: message }),
          resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: email, subject: "Your Saint-Crown Recruiting agreement copy", text: message })
        ]);
        emailsSent = true;
      } catch (mailError) { console.error("Agreement email delivery failed", mailError); }
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(201).json({ ok: true, agreementId: rows[0].id, emailsSent, message: "Your signed agreement has been securely recorded." });
  } catch (error) {
    console.error("Agreement submission failed", error);
    return res.status(500).json({ error: "We couldn't securely save the agreement. Please contact Saint-Crown before paying." });
  }
}
