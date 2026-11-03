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
Parent/guardian: ${application.parentEmail || "Not provided"}`;
  await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: notify, subject: "New Saint-Crown athlete application: " + application.name, text: summary });
  await resend.emails.send({ from: process.env.APPLICATION_FROM_EMAIL, to: application.email, subject: "Saint-Crown received your evaluation request", text: "Thank you for submitting your athlete profile. Our team will review your information and follow up with next steps. Saint-Crown does not guarantee offers, scholarships or roster spots." });
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Applications are not enabled yet. Please email SaintCrownRecruiting@gmail.com." });
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS athlete_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      athlete_name TEXT NOT NULL,
      athlete_level TEXT NOT NULL CHECK (athlete_level IN ('High school','JUCO','Transfer portal')),
      grad_year TEXT NOT NULL, position TEXT NOT NULL, current_school TEXT NOT NULL,
      gpa TEXT, preferred_plan TEXT, film_blob_pathname TEXT, film_original_name TEXT,
      film_content_type TEXT, film_size_bytes BIGINT, recruiting_status TEXT,
      contact_email TEXT NOT NULL, parent_email TEXT, parent_consent BOOLEAN NOT NULL DEFAULT FALSE,
      review_status TEXT NOT NULL DEFAULT 'New', staff_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    const body = req.body || {};
    if (body.action === "complete") {
      const { applicationId } = body;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId || "")) {
        return res.status(400).json({ error: "Invalid application reference." });
      }
      const submittedVideos = Array.isArray(body.videos) ? body.videos : (body.filmPathname ? [{
        pathname: body.filmPathname, originalName: body.filmOriginalName,
        contentType: body.filmContentType, sizeBytes: body.filmSizeBytes
      }] : []);
      if (submittedVideos.length > 5) return res.status(400).json({ error: "You can upload up to five videos per application." });
      const allowedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"]);
      for (const video of submittedVideos) {
        if (!video || typeof video.pathname !== "string" || !video.pathname.startsWith(`athlete-videos/${applicationId}/`) ||
            !allowedVideoTypes.has(video.contentType) || !Number.isInteger(video.sizeBytes) ||
            video.sizeBytes < 1 || video.sizeBytes > 100 * 1024 * 1024) {
          return res.status(400).json({ error: "One of the private video references is invalid." });
        }
      }
      const rows = await sql`SELECT id, athlete_name AS name, athlete_level AS level, grad_year AS grad, position, current_school AS school, gpa, preferred_plan AS plan, recruiting_status AS status, contact_email AS email, parent_email AS "parentEmail" FROM athlete_applications WHERE id = ${applicationId} LIMIT 1`;
      if (!rows.length) return res.status(404).json({ error: "Application not found." });
      if (submittedVideos.length) {
        await sql`CREATE TABLE IF NOT EXISTS athlete_application_videos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          application_id UUID NOT NULL REFERENCES athlete_applications(id) ON DELETE CASCADE,
          blob_pathname TEXT NOT NULL UNIQUE,
          original_name TEXT,
          content_type TEXT NOT NULL,
          size_bytes BIGINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        for (const video of submittedVideos) {
          await sql`INSERT INTO athlete_application_videos
            (application_id, blob_pathname, original_name, content_type, size_bytes)
            VALUES (${applicationId}, ${video.pathname}, ${String(video.originalName || "").slice(0, 180) || null},
              ${video.contentType}, ${video.sizeBytes})
            ON CONFLICT (blob_pathname) DO NOTHING`;
        }
        const first = submittedVideos[0];
        await sql`UPDATE athlete_applications SET film_blob_pathname = ${first.pathname},
          film_original_name = ${String(first.originalName || "").slice(0, 180) || null},
          film_content_type = ${first.contentType}, film_size_bytes = ${first.sizeBytes}
          WHERE id = ${applicationId}`;
      }
      const application = { ...rows[0], filmPathname: submittedVideos[0]?.pathname || "", film: body.film || "" };
      let emailsSent = false;
      try { emailsSent = await sendNotifications(application); }
      catch (mailError) { console.error("Application email delivery failed", mailError); }
      return res.status(200).json({ ok: true, emailsSent, videoCount: submittedVideos.length, message: "Your evaluation request has been received." });
    }

    const { name, level, grad, position, school, gpa, plan, film, status, email, parentEmail, parentConsent } = body;
    if (![name, level, grad, position, school, email].every(v => typeof v === "string" && v.trim())) {
      return res.status(400).json({ error: "Please complete all required fields." });
    }
    if (!emailPattern.test(email) || !allowedLevels.has(level) || !allowedPlans.has(plan)) {
      return res.status(400).json({ error: "Please check the email, athlete level and selected plan." });
    }
    if (level === "High school" && (!emailPattern.test(parentEmail || "") || parentConsent !== true)) {
      return res.status(400).json({ error: "A valid parent or guardian email and consent are required for high-school athletes." });
    }
    const rows = await sql`INSERT INTO athlete_applications
      (athlete_name, athlete_level, grad_year, position, current_school, gpa, preferred_plan, recruiting_status, contact_email, parent_email, parent_consent)
      VALUES (${name.trim()}, ${level}, ${grad.trim()}, ${position.trim()}, ${school.trim()}, ${gpa || null}, ${plan}, ${status || null}, ${email.trim()}, ${parentEmail || null}, ${Boolean(parentConsent)})
      RETURNING id`;
    return res.status(200).json({ ok: true, applicationId: rows[0].id, film: film || "" });
  } catch (error) {
    console.error("Application submission failed", error);
    return res.status(500).json({ error: "We couldn't submit your request. Please email SaintCrownRecruiting@gmail.com." });
  }
}
