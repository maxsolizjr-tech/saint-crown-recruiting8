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
    const rows = await sql`SELECT id, athlete_name AS name, athlete_level AS level, grad_year AS grad,
      position, current_school AS school, gpa, preferred_plan AS plan, recruiting_status AS status,
      contact_email AS email, parent_email AS "parentEmail", parent_consent AS "parentConsent",
      film_original_name AS "filmOriginalName", film_content_type AS "filmContentType",
      film_size_bytes AS "filmSizeBytes", (film_blob_pathname IS NOT NULL) AS "hasVideo",
      created_at AS "createdAt"
      FROM athlete_applications ORDER BY created_at DESC LIMIT 100`;
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ ok: true, applications: rows });
  } catch (error) {
    console.error("Staff application list failed", error);
    return res.status(500).json({ error: "Unable to load applications." });
  }
}
