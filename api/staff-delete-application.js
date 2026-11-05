import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";
import { timingSafeEqual } from "node:crypto";

function authorized(req) {
  const expected = process.env.STAFF_REVIEW_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Database is not configured." });
  const { applicationId } = req.body || {};
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId || "")) {
    return res.status(400).json({ error: "Invalid application reference." });
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`DELETE FROM athlete_applications WHERE id = ${applicationId} RETURNING film_blob_pathname AS pathname`;
    if (!rows.length) return res.status(404).json({ error: "Application not found." });
    let videoDeleted = false;
    if (rows[0].pathname) {
      try { await del(rows[0].pathname); videoDeleted = true; }
      catch (error) { console.error("Private video cleanup failed after application deletion", error); }
    }
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ ok: true, videoDeleted });
  } catch (error) {
    console.error("Staff application deletion failed", error);
    return res.status(500).json({ error: "Unable to delete application." });
  }
}
