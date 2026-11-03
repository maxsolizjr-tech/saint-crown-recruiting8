# Saint-Crown Recruiting backend setup

This document describes the backend prerequisites. Changes are made on the preview branch only; the public production website and checkout have not been changed.

## Required services

- Neon Postgres with `db/schema.sql` applied.
- A **Private** Vercel Blob store connected to this Vercel project. The upload endpoint uses short-lived, single-path signed PUT URLs and the Vercel OIDC credentials available to the function; it does not expose a store token to the browser.
- Resend with an API key and a verified sender address.

## Environment variables

Configure secrets directly in Vercel Project → Settings → Environment Variables. Never commit secrets or paste them into chat.

- `DATABASE_URL`: Neon pooled Postgres connection string.
- `RESEND_API_KEY`: Resend API key.
- `APPLICATION_FROM_EMAIL`: sender address verified in Resend.
- `APPLICATION_NOTIFY_EMAIL`: `SaintCrownRecruiting@gmail.com` (optional; this is the default notification recipient).
- `STAFF_REVIEW_TOKEN`: a long, random secret used by the private staff review workspace at `/staff.html`.

For Blob, confirm the connected store is **Private** and the project has Vercel OIDC access. A long-lived `BLOB_READ_WRITE_TOKEN` is not required when the store is upgraded/connected with OIDC.

## Application and video flow

1. The application is validated and saved to Neon first.
2. For a video, the server checks that the application exists and that required parent consent is recorded.
3. The server creates a 10-minute signed URL scoped to one private Blob pathname, PUT operation, accepted content type and maximum size.
4. The browser uploads directly to Blob. Up to five videos per application; each video is limited to 100 MB.
5. The application is finalized and notification emails are attempted.

The signed upload URL is temporary and scoped; it is not a public viewing link. Staff review is available at `/staff.html`. Staff can update an application’s private review status and internal notes, review signed enrollment agreements, and play each private video. Signed enrollment agreements are saved to the database before checkout and their reference is passed to Stripe as `client_reference_id`. The API requires the `STAFF_REVIEW_TOKEN` bearer secret and retrieves footage through the private Blob SDK `get()` method; the browser never receives a public Blob URL.

## Required verification before launch

1. Confirm the Blob store is **Private**, connected to this project, and using OIDC.
2. Confirm the database is provisioned and the schema has been applied.
3. Verify the sender address/domain in Resend and add the Resend environment variables to Preview.
4. Add the Neon connection string and Resend variables to Preview first.
5. Test a dummy application without a video and one with a small test video in Preview.
6. Confirm both rows are saved, the Blob object is private, and the two emails arrive.
7. Test `/staff.html` with the staff token, verify unauthorized requests are rejected, and confirm authorized staff can play uploaded footage.
8. Only then consider a production deployment, with explicit owner approval.

## Safeguards

- Do not collect payment details in the application form.
- Do not promise a recruiting outcome.
- High-school athletes require a valid parent/guardian email and explicit consent before video upload authorization.
- Uploaded videos are private; never display or email a public Blob URL.
- The upload endpoint enforces MIME type and size limits server-side and checks for an existing application.
- Do not enable live submissions until all service credentials and end-to-end tests pass.
