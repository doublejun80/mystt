import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const postgresIntegrationUrl =
  process.env.MYSTT_POSTGRES_INTEGRATION_URL ?? process.env.POSTGRES_URL;
const shouldRunPostgresIntegration =
  process.env.MYSTT_RUN_POSTGRES_INTEGRATION === "1" && postgresIntegrationUrl;
const describePostgres = shouldRunPostgresIntegration ? describe : describe.skip;
const testSessionIds: string[] = [];

async function readRepoFile(pathFromRoot: string) {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return readFile(resolve(currentDir, "../../../../", pathFromRoot), "utf8");
}

describePostgres("source_audio_uploads Postgres ledger", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: postgresIntegrationUrl
    });

    await pool.query(await readRepoFile("infra/postgres/init/001_schema.sql"));
    await pool.query(
      await readRepoFile("infra/postgres/init/003_source_audio_upload_ledger.sql")
    );
  });

  afterAll(async () => {
    if (pool) {
      for (const sessionId of testSessionIds) {
        await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
      }
      await pool.end();
    }
  });

  it("persists, reloads, upserts, and cascades source audio upload rows", async () => {
    const sessionId = `pg-ledger-${randomUUID()}`;
    testSessionIds.push(sessionId);
    const sha256 = "c0ffee".padEnd(64, "0");
    const byteLength = 1234;

    await pool.query(
      `INSERT INTO sessions (
        id,
        title,
        mode,
        status,
        started_at,
        local_audio_path,
        language_hints,
        profile,
        realtime_policy,
        pending_chunk_count
      ) VALUES ($1, $2, 'meeting', 'recording', $3, $4, $5::text[], $6::jsonb, 'foreground-only', 0)`,
      [
        sessionId,
        "Postgres ledger integration",
        "2026-05-17T00:00:00.000Z",
        "minio://audio/sessions/test/source.m4a",
        ["ko"],
        JSON.stringify({
          chunkMinutes: 10,
          uploadStrategy: "rolling-chunks",
          backgroundSurvivalCritical: true,
          allowForegroundRealtime: true,
          minimumBatteryPercentToStream: 25
        })
      ]
    );

    await pool.query(
      `INSERT INTO source_audio_uploads (
        session_id,
        sha256,
        byte_length,
        source_location,
        soniox_file_id,
        soniox_file_name,
        uploaded_at,
        content_type,
        source_file_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (session_id, sha256, byte_length) DO UPDATE SET
        source_location = EXCLUDED.source_location,
        soniox_file_id = EXCLUDED.soniox_file_id,
        soniox_file_name = EXCLUDED.soniox_file_name,
        uploaded_at = EXCLUDED.uploaded_at,
        content_type = EXCLUDED.content_type,
        source_file_name = EXCLUDED.source_file_name`,
      [
        sessionId,
        sha256,
        byteLength,
        "minio://audio/sessions/test/source.m4a",
        "soniox-file-a",
        "source-a.m4a",
        "2026-05-17T00:01:00.000Z",
        "audio/mp4",
        "source.m4a"
      ]
    );

    await expect(
      pool.query(
        `SELECT soniox_file_id, source_file_name
        FROM source_audio_uploads
        WHERE session_id = $1 AND sha256 = $2 AND byte_length = $3`,
        [sessionId, sha256, byteLength]
      )
    ).resolves.toMatchObject({
      rowCount: 1,
      rows: [
        {
          soniox_file_id: "soniox-file-a",
          source_file_name: "source.m4a"
        }
      ]
    });

    await pool.query(
      `INSERT INTO source_audio_uploads (
        session_id,
        sha256,
        byte_length,
        source_location,
        soniox_file_id,
        soniox_file_name,
        uploaded_at,
        content_type,
        source_file_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (session_id, sha256, byte_length) DO UPDATE SET
        source_location = EXCLUDED.source_location,
        soniox_file_id = EXCLUDED.soniox_file_id,
        soniox_file_name = EXCLUDED.soniox_file_name,
        uploaded_at = EXCLUDED.uploaded_at,
        content_type = EXCLUDED.content_type,
        source_file_name = EXCLUDED.source_file_name`,
      [
        sessionId,
        sha256,
        byteLength,
        "minio://audio/sessions/test/source-retry.m4a",
        "soniox-file-b",
        "source-b.m4a",
        "2026-05-17T00:02:00.000Z",
        "audio/mp4",
        "source-retry.m4a"
      ]
    );

    const upserted = await pool.query(
      `SELECT COUNT(*)::int AS count, MAX(soniox_file_id) AS soniox_file_id
      FROM source_audio_uploads
      WHERE session_id = $1 AND sha256 = $2 AND byte_length = $3`,
      [sessionId, sha256, byteLength]
    );
    expect(upserted.rows[0]).toEqual({
      count: 1,
      soniox_file_id: "soniox-file-b"
    });

    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    const afterDelete = await pool.query(
      "SELECT COUNT(*)::int AS count FROM source_audio_uploads WHERE session_id = $1",
      [sessionId]
    );
    expect(afterDelete.rows[0]).toEqual({ count: 0 });
  });
});
