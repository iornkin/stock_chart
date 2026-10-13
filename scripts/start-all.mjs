// 웹 서버(next start)와 스케줄러 워커를 함께 실행 (단일 서버 배포용)
import { spawn } from "node:child_process";

const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --disable-warning=ExperimentalWarning`.trim() };
const port = process.env.PORT ?? "3000";
const procs = [
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { stdio: "inherit", env }),
  spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts"], { stdio: "inherit", env }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) {
  p.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
