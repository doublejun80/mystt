import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const requiredFiles = [
  "AGENTS.md",
  "README.md",
  "apps/mobile/app/index.tsx",
  "apps/web/app/page.tsx",
  "services/api/src/index.ts",
  "services/worker-session/src/index.ts",
  "services/worker-transcribe/src/index.ts",
  "packages/audio-core/src/index.ts",
  "packages/session-queue/src/index.ts",
  "packages/notes-schema/src/index.ts",
  "infra/docker/docker-compose.yml",
  "evals/audio-golden-set/manifest.json"
];

async function verifyFiles() {
  for (const file of requiredFiles) {
    await access(resolve(process.cwd(), file));
  }
}

async function verifyJson(relativePath) {
  const raw = await readFile(resolve(process.cwd(), relativePath), "utf8");
  JSON.parse(raw);
}

async function main() {
  await verifyFiles();
  await verifyJson("evals/audio-golden-set/manifest.json");
  await verifyJson("evals/summary-golden-set/cases.json");

  console.log(
    JSON.stringify(
      {
        ok: true,
        checked: requiredFiles.length,
        now: new Date().toISOString()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
