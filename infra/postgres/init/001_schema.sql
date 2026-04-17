CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('meeting', 'speech', 'interview')),
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'recording',
      'paused',
      'uploading',
      'transcribing',
      'summarizing',
      'emailing',
      'completed',
      'failed'
    )
  ),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  project_key TEXT,
  local_audio_path TEXT NOT NULL,
  language_hints TEXT[] NOT NULL DEFAULT ARRAY['ko', 'en'],
  profile JSONB NOT NULL,
  realtime_policy TEXT NOT NULL CHECK (realtime_policy IN ('foreground-only', 'disabled')),
  pending_chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_participants (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  PRIMARY KEY (session_id, participant_id)
);

CREATE TABLE IF NOT EXISTS session_artifacts (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'raw_transcript_json',
      'clean_transcript_md',
      'meeting_notes_json',
      'meeting_notes_html',
      'meeting_notes_docx',
      'email_preview_html'
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  location TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, kind)
);

CREATE TABLE IF NOT EXISTS transcription_jobs (
  transcription_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filename TEXT,
  audio_url TEXT,
  file_id TEXT,
  cleanup_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  cleanup_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    cleanup_status IN ('pending', 'completed', 'failed', 'skipped')
  ),
  cleanup_requested_at TIMESTAMPTZ,
  cleanup_completed_at TIMESTAMPTZ,
  cleanup_last_error TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS provider_checks (
  provider TEXT PRIMARY KEY CHECK (provider IN ('soniox', 'openai')),
  configured BOOLEAN NOT NULL DEFAULT FALSE,
  ok BOOLEAN,
  detail TEXT,
  checked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS note_artifacts (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  notes JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcript_cache (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  transcript_text TEXT NOT NULL,
  normalized_transcript JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_fingerprints (
  fingerprint TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_project_key ON sessions(project_key);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_session_id ON transcription_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_webhook_fingerprints_created_at ON webhook_fingerprints(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_session_id ON audit_events(session_id);
