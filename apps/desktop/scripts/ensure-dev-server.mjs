import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const devUrl = "http://localhost:1420";
const devPort = 1420;
const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function isPortOccupied() {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: "localhost",
      port: devPort
    });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function isDevServerReady() {
  try {
    const response = await fetch(devUrl, {
      headers: {
        accept: "text/html"
      }
    });

    return response.ok;
  } catch {
    return false;
  }
}

if ((await isPortOccupied()) || (await isDevServerReady())) {
  console.log(`[mystt desktop] Reusing existing dev server at ${devUrl}`);
  process.exit(0);
}

const child = spawn(executable, ["dev"], {
  stdio: "inherit",
  env: process.env
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

let settled = false;

child.on("exit", async (code, signal) => {
  if (settled) {
    return;
  }

  settled = true;

  if (signal === "SIGTERM" || signal === "SIGINT" || code === 143 || code === 130) {
    process.exit(0);
  }

  process.exit(code ?? 1);
});

for (let attempt = 0; attempt < 60; attempt += 1) {
  if (await isDevServerReady()) {
    console.log(`[mystt desktop] Dev server ready at ${devUrl}`);
    break;
  }

  await delay(500);
}

if (!(await isDevServerReady())) {
  console.error(`[mystt desktop] Dev server did not start at ${devUrl}`);
  process.exit(1);
}

await new Promise(() => {
  // Keep this process alive so Tauri can manage the child lifecycle.
});
