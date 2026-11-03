import { neon } from "@neondatabase/serverless";
import { Resend } from "resend";

const plans = {
  monthly: { name: "Monthly Recruiting Program", price: "$200 per month" },
  "90-day": { name: "90-Day Recruiting Program", price: "$500 one-time payment" },
  "6-month": { name: "6-Month Recruiting Development", price: "$1,000 one-time payment" },
  "12-month": { name: "12-Month Prospect Development", price: "$2,000 one-time payment" }
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Agreement storage is not configured." });
  try {
    const body = req.body || {};
    const plan = plans[body.plan];
    const required = ["athlete", "dob", "signer", "email", "phone", "relationship", "signature", "date"];
    if (!plan || !required.every(key => typeof body[key] === "string" && body[key].trim()) ||
        !emailPattern.test(body.email) || body.authority !== true || body.agree !== true ||
        body.signature.trim().toLowerCase() !== body.signer.trim().toLowerCase() ||
        body.social !== true && body.social !== false) {
      return res.status(400).json({ error: "Please complete the agreement and confirm the required consent." });
    }
    const dob = new Date(body.dob + "T00:00:00Z");
    const signedDate = new Date(body.date + "T00:00:00Z");
    const now = new Date();
    if (Number.isNaN(dob.getTime()) || Number.isNaN(signedDate.getTime()) || dob > now || signedDate > now) {
      return res.status(400).json({ error: "Please enter valid dates for the athlete and agreement." });
    }
    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS athlete_agreements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      athlete_name TEXT NOT NULL,
      athlete_dob DATE NOT NULL,
      signer_name TEXT NOT NULL,
      signer_email TEXT NOT NULL,
      signer_phone TEXT NOT NULL,
      relationship TEXT NOT NULL,
      program_key TEXT NOT NULL,
      program_name TEXT NOT NULL,
      program_price TEXT NOT NULL,
      authority_confirmed BOOLEAN NOT NULL,
      terms_accepted BOOLEAN NOT NULL,
      social_consent BOOLEAN NOT NULL DEFAULT FALSE,
      typed_signature TEXT NOT NULL,
      signed_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    const rows = await sql`INSERT INTO athlete_agreements
      (athlete_name, athlete_dob, signer_name, signer_email, signer_phone, relationship,
       program_key, program_name, program_price, authority_confirmed, terms_accepted,
       social_consent, typed_signature, signed_date)
      VALUES (${body.athlete.trim()}, ${body.dob}, ${body.signer.trim()}, ${body.email.trim()},
       ${body.phone.trim()}, ${body.relationship.trim()}, ${body.plan}, ${plan.name}, ${plan.price},
       TRUE, TRUE, ${body.social}, ${body.signature.trim()}, ${body.date})
      RETURNING id`;
    let emailSent = false;
    if (process.env.RESEND_API_KEY && process.env.APPLICATION_FROM_EMAIL) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const summary = `Saint-Crown Recruiting signed agreement
Reference: ${rows[0].id}
Athlete: ${body.athlete}
Athlete DOB: ${body.dob}
Program: ${plan.name} — ${plan.price}
Signer: ${body.signer}
Relationship: ${body.relationship}
Signer email: ${body.email}
Signer phone: ${body.phone}
Signed date: ${body.date}
Electronic signature: ${body.signature}
Optional public media consent: ${body.social ? "Yes" : "No"}`;
        await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: body.email, subject: "Your Saint-Crown Recruiting agreement", text: summary });
        await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: process.env.APPLICATION_NOTIFY_EMAIL || "SaintCrownRecruiting@gmail.com", subject: "New signed Saint-Crown agreement: " + body.athlete, text: summary });
        emailSent = true;
      } catch (mailError) {
        console.error("Agreement email delivery failed", mailError);
      }
    }
    return res.status(200).json({ ok: true, agreementId: rows[0].id, emailSent });
  } catch (error) {
    console.error("Agreement save failed", error);
    return res.status(500).json({ error: "We could not save the agreement. Please contact Saint-Crown." });
  }
}
