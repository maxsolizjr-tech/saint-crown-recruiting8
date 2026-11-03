import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload || "{}");
        if (!payload.applicationId || !/^[a-zA-Z0-9-]{8,80}$/.test(payload.applicationId)) {
          throw new Error("Invalid application upload session");
        }
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"],
          maximumSizeInBytes: 250 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ applicationId: payload.applicationId })
        };
      },
      onUploadCompleted: async () => {}
    });
    return res.status(200).json(json);
  } catch (error) {
    console.error("Video upload token error", error);
    return res.status(400).json({ error: "Unable to authorize this video upload." });
  }
}
