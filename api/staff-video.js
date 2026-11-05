import { get } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

function authorized(req) {
  const expected = process.env.STAFF_REVIEW_TOKEN || "";
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");
  if (!process.env.STAFF_REVIEW_TOKEN) return res.status(503).send("Staff review is not configured.");
  if (!authorized(req)) return res.status(401).send("Unauthorized.");
  if (!process.env.DATABASE_URL) return res.status(503).send("Database is not configured.");

  const applicationId = String(req.query.applicationId || "");
  const videoId = String(req.query.videoId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId)) {
    return res.status(400).send("Invalid application reference.");
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    let pathname = "";
    if (videoId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) return res.status(400).send("Invalid video reference.");
      const rows = await sql`SELECT blob_pathname FROM athlete_application_videos WHERE id = ${videoId} AND application_id = ${applicationId} LIMIT 1`;
      pathname = rows[0]?.blob_pathname || "";
    } else {
      const rows = await sql`SELECT film_blob_pathname FROM athlete_applications WHERE id = ${applicationId} LIMIT 1`;
      pathname = rows[0]?.film_blob_pathname || "";
    }
    if (!pathname || !pathname.startsWith(`athlete-videos/${applicationId}/`)) return res.status(404).send("Video not found.");
    const result = await get(pathname, { access: "private" });
    if (result?.statusCode !== 200) return res.status(404).send("Video not found.");
    res.setHeader("Content-Type", result.blob.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", 'inline; filename="athlete-video"');
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    return Readable.fromWeb(result.stream).pipe(res);
  } catch (error) {
    console.error("Staff private video retrieval failed", error);
    return res.status(500).send("Unable to retrieve private video.");
  }
}
