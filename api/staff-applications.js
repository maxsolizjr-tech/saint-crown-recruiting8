import { neon } from "@neondatabase/serverless";
import { timingSafeEqual } from "node:crypto";

function authorized(req) {
  const expected = process.env.STAFF_REVIEW_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STAFF_REVIEW_TOKEN) return res.status(503).json({ error: "Staff review is not configured." });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Database is not configured." });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`ALTER TABLE athlete_applications
      ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'New',
      ADD COLUMN IF NOT EXISTS staff_notes TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
    await sql`CREATE TABLE IF NOT EXISTS athlete_agreements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), athlete_name TEXT NOT NULL, athlete_dob DATE NOT NULL,
      signer_name TEXT NOT NULL, signer_email TEXT NOT NULL, signer_phone TEXT NOT NULL, relationship TEXT NOT NULL,
      program_key TEXT NOT NULL, program_name TEXT NOT NULL, program_price TEXT NOT NULL,
      authority_confirmed BOOLEAN NOT NULL, terms_accepted BOOLEAN NOT NULL,
      social_consent BOOLEAN NOT NULL DEFAULT FALSE, typed_signature TEXT NOT NULL,
      signed_date DATE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    if (req.method === "POST") {
      const { applicationId, reviewStatus, staffNotes } = req.body || {};
      const statuses = new Set(["New", "Reviewing", "Contacted", "Active", "Closed"]);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId || "") || !statuses.has(reviewStatus)) {
        return res.status(400).json({ error: "Invalid application or review status." });
      }
      const updated = await sql`UPDATE athlete_applications
        SET review_status = ${reviewStatus}, staff_notes = ${String(staffNotes || "").slice(0, 5000)}, updated_at = NOW()
        WHERE id = ${applicationId} RETURNING id`;
      if (!updated.length) return res.status(404).json({ error: "Application not found." });
      return res.status(200).json({ ok: true, message: "Review updated." });
    }
    const rows = await sql`SELECT id, athlete_name AS name, athlete_level AS level, grad_year AS grad,
      position, current_school AS school, gpa, preferred_plan AS plan, recruiting_status AS status,
      review_status AS "reviewStatus", staff_notes AS "staffNotes",
      contact_email AS email, parent_email AS "parentEmail", parent_consent AS "parentConsent",
      film_original_name AS "filmOriginalName", film_content_type AS "filmContentType",
      film_size_bytes AS "filmSizeBytes", (film_blob_pathname IS NOT NULL) AS "hasVideo",
      created_at AS "createdAt"
      FROM athlete_applications ORDER BY created_at DESC LIMIT 100`;
    const agreements = await sql`SELECT id, athlete_name AS "athleteName", athlete_dob AS "athleteDob",
      signer_name AS "signerName", signer_email AS "signerEmail", signer_phone AS "signerPhone",
      relationship, program_name AS "programName", program_price AS "programPrice",
      social_consent AS "socialConsent", typed_signature AS signature, signed_date AS "signedDate",
      created_at AS "createdAt"
      FROM athlete_agreements ORDER BY created_at DESC LIMIT 100`;
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ ok: true, applications: rows, agreements });
  } catch (error) {
    console.error("Staff application list failed", error);
    return res.status(500).json({ error: "Unable to load applications." });
  }
}
