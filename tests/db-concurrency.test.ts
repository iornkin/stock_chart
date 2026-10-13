import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

function openInChild(dbPath: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "tests/fixtures/open-db.ts"], { cwd: ROOT, env: { ...process.env, DATABASE_PATH: dbPath } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

describe("DB 마이그레이션", () => {
  // 정적 빌드는 여러 작업자가 같은 새 DB 를 동시에 연다 → 같은 열을 두 번 추가하다 실패하면 안 됨
  it("여러 프로세스가 새 DB 를 동시에 열어도 실패하지 않는다", { timeout: 60_000 }, async () => {
    for (let round = 0; round < 3; round++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usi-db-"));
      const file = path.join(dir, "app.db");
      const rs = await Promise.all(Array.from({ length: 6 }, () => openInChild(file)));
      for (const r of rs) expect(r.code, r.out).toBe(0);
      const db = new DatabaseSync(file);
      const cols = (db.prepare("PRAGMA table_info(news)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).toContain("image");
      expect(db.prepare("SELECT value FROM settings WHERE key='migration_bars_granularity_v1'").get()).toBeTruthy();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
