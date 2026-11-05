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
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STAFF_REVIEW_TOKEN) return res.status(503).json({ error: "Staff review is not configured." });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Database is not configured." });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS instagram_handle TEXT`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS twitter_handle TEXT`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS height TEXT`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS weight_lbs INTEGER`;
    await sql`ALTER TABLE athlete_applications ADD COLUMN IF NOT EXISTS sixty_yard_dash NUMERIC(4,2)`;
    await sql`CREATE TABLE IF NOT EXISTS athlete_application_videos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL REFERENCES athlete_applications(id) ON DELETE CASCADE, blob_pathname TEXT NOT NULL, original_name TEXT, content_type TEXT, size_bytes BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    const rows = await sql`SELECT id, athlete_name AS name, athlete_level AS level, grad_year AS grad,
      position, height, weight_lbs AS "weight", sixty_yard_dash AS "sixtyYardDash", current_school AS school, gpa, preferred_plan AS plan,
      contact_email AS email, parent_email AS "parentEmail", parent_consent AS "parentConsent",
      film_original_name AS "filmOriginalName", film_content_type AS "filmContentType",
      film_size_bytes AS "filmSizeBytes", (film_blob_pathname IS NOT NULL) AS "hasVideo",
      instagram_handle AS instagram, twitter_handle AS twitter,
      COALESCE((SELECT json_agg(json_build_object('id', v.id, 'name', v.original_name, 'contentType', v.content_type, 'sizeBytes', v.size_bytes) ORDER BY v.created_at) FROM athlete_application_videos v WHERE v.application_id = athlete_applications.id), '[]'::json) AS videos,
      created_at AS "createdAt"
      FROM athlete_applications ORDER BY created_at DESC LIMIT 100`;
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
      typed_signature TEXT NOT NULL,
      authority_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
      social_media_consent BOOLEAN NOT NULL DEFAULT FALSE,
      agreement_version TEXT NOT NULL,
      signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    const agreements = await sql`SELECT id, athlete_name AS "athleteName", plan_name AS "planName",
      plan_price AS "planPrice", signer_name AS "signerName", signer_email AS "signerEmail",
      signer_phone AS "signerPhone", relationship, typed_signature AS signature,
      authority_confirmed AS "authorityConfirmed", terms_accepted AS "termsAccepted",
      social_media_consent AS "socialConsent", agreement_version AS "agreementVersion",
      signed_at AS "signedAt"
      FROM signed_agreements ORDER BY signed_at DESC LIMIT 100`;
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ ok: true, applications: rows, agreements });
  } catch (error) {
    console.error("Staff application list failed", error);
    return res.status(500).json({ error: "Unable to load applications." });
  }
}
