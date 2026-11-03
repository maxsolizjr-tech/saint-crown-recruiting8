import { issueSignedToken, presignUrl } from "@vercel/blob";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const allowedTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"]);
const maxSize = 100 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Video uploads are not configured." });
  try {
    const { applicationId, contentType, size, originalName } = req.body || {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId || "")) {
      return res.status(400).json({ error: "Invalid application reference." });
    }
    if (!allowedTypes.has(contentType) || !Number.isInteger(size) || size < 1 || size > maxSize) {
      return res.status(400).json({ error: "Choose an MP4, MOV, WebM or AVI video up to 100 MB." });
    }
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT id, athlete_level, parent_consent FROM athlete_applications WHERE id = ${applicationId} LIMIT 1`;
    if (!rows.length || (rows[0].athlete_level === "High school" && !rows[0].parent_consent)) {
      return res.status(403).json({ error: "Application not found or parent consent is missing." });
    }
    const extension = ({ "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-msvideo": "avi" })[contentType];
    const pathname = `athlete-videos/${applicationId}/${randomUUID()}.${extension}`;
    const validUntil = Date.now() + 10 * 60 * 1000;
    const token = await issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: maxSize
    });
    const { presignedUrl } = await presignUrl(token, { pathname, operation: "put", validUntil });
    return res.status(200).json({ uploadUrl: presignedUrl, pathname, contentType, originalName: String(originalName || "").slice(0, 180) });
  } catch (error) {
    console.error("Private video URL generation failed", error);
    return res.status(500).json({ error: "Unable to prepare a secure video upload." });
  }
}
