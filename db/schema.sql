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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS athlete_applications_created_at_idx ON athlete_applications (created_at DESC);
