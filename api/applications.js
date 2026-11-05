import { neon } from "@neondatabase/serverless";
import { Resend } from "resend";

const allowedLevels = new Set(["High school", "JUCO", "Transfer portal"]);
const allowedPlans = new Set([
  "$200/month Monthly Recruiting Program",
  "$500 90-day recruiting program",
  "$1,000 six-month recruiting development",
  "$2,000 twelve-month prospect development",
  "Not sure yet"
]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendNotifications(application) {
  if (!process.env.RESEND_API_KEY || !process.env.APPLICATION_FROM_EMAIL) return false;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const notify = process.env.APPLICATION_NOTIFY_EMAIL || "SaintCrownRecruiting@gmail.com";
  const summary = `Athlete: ${application.name}
Level: ${application.level}
Year: ${application.grad}
Position: ${application.position}
School: ${application.school}
GPA: ${application.gpa || "Not provided"}
Plan: ${application.plan}
Film link: ${application.film || "Not provided"}
Private uploaded video: ${application.filmPathname ? "Uploaded (private; review through authenticated staff workflow)" : "None"}
Recruiting status: ${application.status || "Not provided"}
Contact: ${application.email}
Parent/guardian: ${application.parentEmail || "Not provided"}
Instagram: ${application.instagram || "Not provided"}
Twitter / X: ${application.twitter || "Not provided"}`;
  await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: notify, subject: "New Saint-Crown athlete application: " + application.name, text: summary });
  await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: application.email, subject: "Saint-Crown received your evaluation request", text: "Thank you for submitting your athlete profile. Our team will review your information and follow up with next steps. Saint-Crown does not guarantee offers, scholarships or roster spots." });
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Applications are not enabled yet. Please email SaintCrownRecruiting@gmail.com." });
  try {
    const sql = neon(process.env.DATABASE_URL);
    const body = req.body || {};
    if (body.action === "complete") {
      const { applicationId, filmPathname, filmOriginalName, filmContentType, filmSizeBytes } = body;
      const videos = Array.isArray(body.videos) ? body.videos : [];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId || "")) {
        return res.status(400).json({ error: "Invalid application reference." });
      }
      if (videos.length > 10 || videos.some(v => !v || typeof v.pathname !== "string" || !v.pathname.startsWith(`athlete-videos/${applicationId}/`) || !["video/mp4","video/quicktime","video/webm","video/x-msvideo"].includes(v.contentType) || !Number.isInteger(v.sizeBytes) || v.sizeBytes < 1 || v.sizeBytes > 100 * 1024 * 1024)) {
        return res.status(400).json({ error: "Invalid video list. Upload up to 10 supported videos, each under 100 MB." });
      }
      if (filmPathname && !filmPathname.startsWith(`athlete-videos/${applicationId}/`)) {
        return res.status(400).json({ error: "Invalid private video reference." });
      }
      const rows = await sql`SELECT id, athlete_name AS name, athlete_level AS level, grad_year AS grad, position, current_school AS school, gpa, preferred_plan AS plan, recruiting_status AS status, contact_email AS email, parent_email AS "parentEmail", instagram_handle AS instagram, twitter_handle AS twitter FROM athlete_applications WHERE id = ${applicationId} LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: "Application not found." });
      await sql`CREATE TABLE IF NOT EXISTS athlete_application_videos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL REFERENCES athlete_applications(id) ON DELETE CASCADE, blob_pathname TEXT NOT NULL, original_name TEXT, content_type TEXT, size_bytes BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
      for (const video of videos) {
        await sql`INSERT INTO athlete_application_videos (application_id, blob_pathname, original_name, content_type, size_bytes) VALUES (${applicationId}, ${video.pathname}, ${String(video.originalName || "").slice(0,180) || null}, ${video.contentType}, ${video.sizeBytes})`;
      }
      if (filmPathname) {
        await sql`UPDATE athlete_applications SET film_blob_pathname = ${filmPathname}, film_original_name = ${String(filmOriginalName || "").slice(0, 180) || null}, film_content_type = ${String(filmContentType || "").slice(0, 100) || null}, film_size_bytes = ${Number.isInteger(filmSizeBytes) && filmSizeBytes > 0 ? filmSizeBytes : null} WHERE id = ${applicationId}`;
      }
      const application = { ...rows[0], filmPathname: filmPathname || videos[0]?.pathname || null, film: body.film || "" };
      let emailsSent = false;
      try { emailsSent = await sendNotifications(application); }
      catch (mailError) { console.error("Application email delivery failed", mailError); }
      return res.status(200).json({ ok: true, emailsSent, message: "Your evaluation request has been received." });
    }

    const { name, level, age, grad, position, height, weight, sixtyYardDash, school, gpa, plan, film, status, email, parentEmail, parentConsent, instagram, twitter } = body;
    if (![name, level, age, grad, position, height, weight, school, email].every(v => (typeof v === "string" || typeof v === "number") && String(v).trim())) {
      return res.status(400).json({ error: "Please complete all required fields." });
    }
    if (!emailPattern.test(email) || !allowedLevels.has(level) || !allowedPlans.has(plan) || !Number.isInteger(Number(age)) || Number(age) < 13 || Number(age) > 60 || !Number.isFinite(Number(weight)) || Number(weight) < 50 || Number(weight) > 500 || (sixtyYardDash && (!Number.isFinite(Number(sixtyYardDash)) || Number(sixtyYardDash) < 5 || Number(sixtyYardDash) > 15))) {
      return res.status(400).json({ error: "Please check the email, athlete level and selected plan." });
    }
    if (Number(age) < 18 && (!emailPattern.test(parentEmail || "") || parentConsent !== true)) {
      return res.status(400).json({ error: "A valid parent or guardian email and consent are required for high-school athletes." });
    }
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS age INTEGER`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS instagram_handle TEXT`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS twitter_handle TEXT`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS height TEXT`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS weight_lbs INTEGER`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS sixty_yard_dash NUMERIC(4,2)`;
    const rows = await sql`INSERT INTO athlete_applications
      (athlete_name, athlete_level, age, grad_year, position, height, weight_lbs, sixty_yard_dash, current_school, gpa, preferred_plan, recruiting_status, contact_email, parent_email, parent_consent, instagram_handle, twitter_handle)
      VALUES (${name.trim()}, ${level}, ${Number(age)}, ${grad.trim()}, ${position.trim()}, ${height.trim()}, ${Number(weight)}, ${sixtyYardDash ? Number(sixtyYardDash) : null}, ${school.trim()}, ${gpa || null}, ${plan}, ${status || null}, ${email.trim()}, ${parentEmail || null}, ${Boolean(parentConsent)}, ${String(instagram || "").trim().slice(0,80) || null}, ${String(twitter || "").trim().slice(0,80) || null})
      RETURNING id`;
    return res.status(200).json({ ok: true, applicationId: rows[0].id, film: film || "" });
  } catch (error) {
    console.error("Application submission failed", error);
    return res.status(500).json({ error: "We couldn't submit your request. Please email SaintCrownRecruiting@gmail.com." });
  }
}
