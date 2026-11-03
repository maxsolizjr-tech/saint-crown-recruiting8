CREATE TABLE IF NOT EXISTS athlete_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_name TEXT NOT NULL,
  athlete_level TEXT NOT NULL CHECK (athlete_level IN ('High school','JUCO','Transfer portal')),
  grad_year TEXT NOT NULL,
  position TEXT NOT NULL,
  current_school TEXT NOT NULL,
  gpa TEXT,
  preferred_plan TEXT,
  film_blob_pathname TEXT,
  film_original_name TEXT,
  film_content_type TEXT,
  film_size_bytes BIGINT,
  recruiting_status TEXT,
  contact_email TEXT NOT NULL,
  parent_email TEXT,
  parent_consent BOOLEAN NOT NULL DEFAULT FALSE,
  review_status TEXT NOT NULL DEFAULT 'New',
  staff_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS athlete_applications_created_at_idx ON athlete_applications (created_at DESC);

CREATE TABLE IF NOT EXISTS athlete_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_name TEXT NOT NULL,
  athlete_dob DATE NOT NULL,
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  signer_phone TEXT NOT NULL,
  relationship TEXT NOT NULL,
  program_key TEXT NOT NULL,
  program_name TEXT NOT NULL,
  program_price TEXT NOT NULL,
  authority_confirmed BOOLEAN NOT NULL,
  terms_accepted BOOLEAN NOT NULL,
  social_consent BOOLEAN NOT NULL DEFAULT FALSE,
  typed_signature TEXT NOT NULL,
  signed_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS athlete_agreements_created_at_idx ON athlete_agreements (created_at DESC);

CREATE TABLE IF NOT EXISTS athlete_application_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES athlete_applications(id) ON DELETE CASCADE,
  blob_pathname TEXT NOT NULL UNIQUE,
  original_name TEXT,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS athlete_application_videos_application_idx ON athlete_application_videos (application_id, created_at);
