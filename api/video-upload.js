import { handleUpload } from "@vercel/blob/client";
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "Application storage is not configured." });
  try {
    const sql = neon(process.env.DATABASE_URL);
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload || "{}");
        const applicationId = payload.applicationId;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId || "")) {
          throw new Error("Invalid application upload session");
        }
        const rows = await sql`SELECT id, athlete_level, parent_consent FROM athlete_applications WHERE id = ${applicationId} LIMIT 1`;
        if (!rows.length || (rows[0].athlete_level === "High school" && !rows[0].parent_consent)) {
          throw new Error("Application not found or parent consent is missing");
        }
        if (!pathname.startsWith(`athlete-videos/${applicationId}/`)) {
          throw new Error("Invalid video destination");
        }
        return {
          access: "private",
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"],
          maximumSizeInBytes: 250 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ applicationId })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = JSON.parse(tokenPayload || "{}");
        if (!payload.applicationId || !blob.pathname.startsWith(`athlete-videos/${payload.applicationId}/`)) {
          throw new Error("Video upload could not be matched to its application");
        }
      }
    });
    return res.status(200).json(json);
  } catch (error) {
    console.error("Video upload authorization failed", error);
    return res.status(400).json({ error: "Unable to authorize this private video upload." });
  }
}
