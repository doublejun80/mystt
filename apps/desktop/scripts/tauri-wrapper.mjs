import { spawn } from "node:child_process";

const executable = process.platform === "win32" ? "tauri.cmd" : "tauri";
const child = spawn(executable, process.argv.slice(2), {
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

child.on("exit", (code, signal) => {
  if (signal === "SIGTERM" || signal === "SIGINT" || code === 143 || code === 130) {
    process.exit(0);
  }

  process.exit(code ?? 1);
});
