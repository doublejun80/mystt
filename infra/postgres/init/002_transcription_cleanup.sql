ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS cleanup_targets JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS cleanup_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS cleanup_requested_at TIMESTAMPTZ;

ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS cleanup_completed_at TIMESTAMPTZ;

ALTER TABLE transcription_jobs
  ADD COLUMN IF NOT EXISTS cleanup_last_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transcription_jobs_cleanup_status_check'
  ) THEN
    ALTER TABLE transcription_jobs
      ADD CONSTRAINT transcription_jobs_cleanup_status_check
      CHECK (cleanup_status IN ('pending', 'completed', 'failed', 'skipped'));
  END IF;
END $$;
