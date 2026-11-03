import { neon } from "@neondatabase/serverless";
import { Resend } from "resend";

const allowedLevels = new Set(["High school", "JUCO", "Transfer portal"]);
const allowedPlans = new Set([
  "$350 monthly flex program", "$900 90-day recruiting program",
  "$1,500 six-month recruiting development", "$2,400 twelve-month prospect development",
  "Not sure yet"
]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { name, level, grad, position, school, gpa, plan, film, status, email, parentEmail, parentConsent, applicationId, filmPathname } = req.body || {};
    if (![name, level, grad, position, school, email, applicationId].every(v => typeof v === "string" && v.trim())) {
      return res.status(400).json({ error: "Please complete all required fields." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !allowedLevels.has(level) || !allowedPlans.has(plan)) {
      return res.status(400).json({ error: "Please check the email, athlete level and selected plan." });
    }
    if (level === "High school" && (!parentEmail || !parentConsent)) {
      return res.status(400).json({ error: "A parent or guardian email and consent are required for high-school athletes." });
    }
    if (filmPathname && !filmPathname.startsWith("athlete-videos/")) {
      return res.status(400).json({ error: "Invalid video reference." });
    }
    if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Applications are not enabled yet. Please email SaintCrownRecruiting@gmail.com." });
    const sql = neon(process.env.DATABASE_URL);
    await sql`INSERT INTO athlete_applications
      (id, athlete_name, athlete_level, grad_year, position, current_school, gpa, preferred_plan, film_blob_pathname, recruiting_status, contact_email, parent_email, parent_consent)
      VALUES (${applicationId}, ${name.trim()}, ${level}, ${grad.trim()}, ${position.trim()}, ${school.trim()}, ${gpa || null}, ${plan}, ${filmPathname || null}, ${status || null}, ${email.trim()}, ${parentEmail || null}, ${Boolean(parentConsent)})`;
    if (process.env.RESEND_API_KEY && process.env.APPLICATION_FROM_EMAIL) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const notify = process.env.APPLICATION_NOTIFY_EMAIL || "SaintCrownRecruiting@gmail.com";
      const summary = `Athlete: ${name}\nLevel: ${level}\nYear: ${grad}\nPosition: ${position}\nSchool: ${school}\nGPA: ${gpa || "Not provided"}\nPlan: ${plan}\nFilm link: ${film || "Not provided"}\nPrivate uploaded video: ${filmPathname ? "Uploaded (private)" : "None"}\nRecruiting status: ${status || "Not provided"}\nContact: ${email}\nParent/guardian: ${parentEmail || "Not provided"}`;
      await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: notify, subject: "New Saint-Crown athlete application: " + name, text: summary });
      await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: email, subject: "Saint-Crown received your evaluation request", text: "Thank you for submitting your athlete profile. Our team will review your information and follow up with next steps. Saint-Crown does not guarantee offers, scholarships or roster spots." });
    }
    return res.status(200).json({ ok: true, message: "Your evaluation request has been received." });
  } catch (error) {
    console.error("Application submission failed", error);
    return res.status(500).json({ error: "We couldn't submit your request. Please email SaintCrownRecruiting@gmail.com." });
  }
}
