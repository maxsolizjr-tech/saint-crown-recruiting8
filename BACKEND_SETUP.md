# Saint-Crown Recruiting backend setup

This document describes the backend prerequisites. The public website and production deployment have not been changed.

## Required services and environment variables

Configure these in Vercel Project → Settings → Environment Variables. Never commit secrets or paste them into chat.

- `DATABASE_URL`: Neon Postgres connection string (use a pooled connection string).
- `BLOB_READ_WRITE_TOKEN`: token for the private Vercel Blob store `saint-crown-athlete-videos`.
- `RESEND_API_KEY`: Resend API key.
- `APPLICATION_FROM_EMAIL`: sender address verified in Resend.
- `APPLICATION_NOTIFY_EMAIL`: `SaintCrownRecruiting@gmail.com`.

Apply `db/schema.sql` to the Neon database before enabling application submissions.

## Required verification before launch

1. Confirm the Blob store exists, is **Private**, and is connected to this Vercel project.
2. Confirm the database is provisioned and the schema has been applied.
3. Verify the sender domain/address in Resend.
4. Add all environment variables to Preview first.
5. Test a dummy application and video upload in Preview; confirm the database row and both notification emails.
6. Confirm private video access is restricted and no public video URL is exposed.
7. Only then consider a production deployment, with explicit owner approval.

## Safeguards

- Do not accept real payment details as part of the application form.
- Do not promise a recruiting outcome.
- High-school athletes may be minors: collect parent/guardian contact and consent before processing their footage.
- Limit video uploads to accepted video MIME types and a documented maximum size; reject unsupported files server-side.
- Keep database reads private to authenticated staff. Never expose a public list endpoint.
- Do not enable live submissions until all service credentials and end-to-end tests pass.
