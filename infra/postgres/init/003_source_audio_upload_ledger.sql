CREATE TABLE IF NOT EXISTS source_audio_uploads (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  byte_length BIGINT NOT NULL,
  source_location TEXT NOT NULL,
  soniox_file_id TEXT NOT NULL,
  soniox_file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL,
  content_type TEXT,
  source_file_name TEXT,
  PRIMARY KEY (session_id, sha256, byte_length)
);
