/**
 * SQLite 저장소 (Node.js 내장 node:sqlite 사용 — 네이티브 모듈 빌드 불필요).
 * 웹 서버와 스케줄러(worker)가 같은 DB 파일을 WAL 모드로 공유한다.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { env } from "./env";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS quotes (
  symbol TEXT PRIMARY KEY,
  name TEXT,
  price REAL, change REAL, change_pct REAL, prev_close REAL,
  open REAL, high REAL, low REAL, volume REAL,
  avg_volume_3m REAL, avg_volume_10d REAL,
  market_cap REAL, fifty_two_high REAL, fifty_two_low REAL,
  pre_price REAL, pre_change_pct REAL, post_price REAL, post_change_pct REAL,
  market_state TEXT, exchange TEXT, currency TEXT, quote_type TEXT,
  market_time INTEGER,
  delay_minutes INTEGER,
  source TEXT, source_detail TEXT,
  fetched_at INTEGER NOT NULL,
  extra TEXT
);

CREATE TABLE IF NOT EXISTS bars (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  ts INTEGER NOT NULL,
  open REAL, high REAL, low REAL, close REAL, volume REAL, adjclose REAL,
  PRIMARY KEY (symbol, interval, ts)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS bar_meta (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  source TEXT,
  first_ts INTEGER, last_ts INTEGER,
  meta TEXT,
  PRIMARY KEY (symbol, interval)
);

CREATE TABLE IF NOT EXISTS dividends (
  symbol TEXT NOT NULL,
  ex_date TEXT NOT NULL,
  amount REAL NOT NULL,
  amount_raw REAL,
  split_adjusted INTEGER NOT NULL DEFAULT 0,
  pay_date TEXT, record_date TEXT, declared_date TEXT,
  kind TEXT NOT NULL DEFAULT 'regular',
  frequency_reported INTEGER,
  sources TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, ex_date, kind)
);

CREATE TABLE IF NOT EXISTS splits (
  symbol TEXT NOT NULL, date TEXT NOT NULL, numerator REAL, denominator REAL, source TEXT,
  PRIMARY KEY (symbol, date)
);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT NOT NULL,
  publisher TEXT,
  published_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  related TEXT,
  ai_title_ko TEXT,
  ai_summary_ko TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news(published_at);

CREATE TABLE IF NOT EXISTS news_symbols (
  news_id TEXT NOT NULL, symbol TEXT NOT NULL, reason TEXT, match_type TEXT,
  PRIMARY KEY (news_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_news_symbols_symbol ON news_symbols(symbol);

CREATE TABLE IF NOT EXISTS snapshots (
  kind TEXT NOT NULL, symbol TEXT NOT NULL, data TEXT NOT NULL, source TEXT, fetched_at INTEGER NOT NULL,
  PRIMARY KEY (kind, symbol)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  time_hint TEXT,
  title TEXT NOT NULL,
  data TEXT,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

CREATE TABLE IF NOT EXISTS macro (
  series TEXT NOT NULL, date TEXT NOT NULL, value REAL, source TEXT,
  PRIMARY KEY (series, date)
);

CREATE TABLE IF NOT EXISTS briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  session TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  price_as_of INTEGER,
  news_as_of INTEGER,
  status TEXT NOT NULL,
  headline TEXT,
  content TEXT NOT NULL,
  llm_model TEXT,
  UNIQUE (scope, trade_date, session)
);
CREATE INDEX IF NOT EXISTS idx_briefings_scope ON briefings(scope, generated_at);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  slot TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  message TEXT,
  details TEXT,
  trigger TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, started_at);

CREATE TABLE IF NOT EXISTS job_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  picked_at INTEGER,
  options TEXT
);

CREATE TABLE IF NOT EXISTS provider_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  endpoint TEXT,
  ok INTEGER NOT NULL,
  status INTEGER,
  error TEXT,
  at INTEGER NOT NULL,
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_provider_calls ON provider_calls(provider, at);

CREATE TABLE IF NOT EXISTS http_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_budget (
  provider TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (provider, day)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL
);
`;

declare global {
  var __stockDb: DatabaseSync | undefined;
  var __stockDbPath: string | undefined;
}

export function getDb(): DatabaseSync {
  const file = env.databasePath;
  if (globalThis.__stockDb && globalThis.__stockDbPath === file) return globalThis.__stockDb;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // 다른 프로세스(정적 빌드 작업자·워커)가 같은 DB 를 동시에 열 수 있으므로 잠금 대기를 가장 먼저 설정
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  scrubLeakedSecrets(db);
  globalThis.__stockDb = db;
  globalThis.__stockDbPath = file;
  return db;
}

/**
 * 기존 DB 에 새 열 추가·일회성 정리 (CREATE TABLE IF NOT EXISTS 는 열을 추가하지 않으므로)
 * 여러 프로세스가 동시에 열 수 있어(정적 빌드 작업자 등) 쓰기 잠금(BEGIN IMMEDIATE)을 잡은 뒤 다시 확인하고 바꾼다.
 */
function migrate(db: DatabaseSync) {
  const cols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
  // 2026-10: Yahoo range=max 응답이 월봉으로 줄어든 채 일·주봉으로 저장된 문제 → 한 번 지우고 다시 받는다
  const barsFixed = () => Boolean(db.prepare("SELECT value FROM settings WHERE key='migration_bars_granularity_v1'").get());
  if (cols("news").has("image") && barsFixed()) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!cols("news").has("image")) db.exec("ALTER TABLE news ADD COLUMN image TEXT");
    if (!barsFixed()) {
      db.exec("DELETE FROM bars WHERE interval IN ('1d','1wk','1mo')");
      db.exec("DELETE FROM bar_meta WHERE interval IN ('1d','1wk','1mo')");
      // 장 마감 데이터와 그 데이터로 만든 장 마감 브리핑이 다음 실행 때 다시 만들어지도록 실행 기록 제거
      db.exec("DELETE FROM job_runs WHERE job IN ('collect_eod','briefing_close')");
      db.prepare("INSERT INTO settings(key, value, updated_at) VALUES('migration_bars_granularity_v1', '1', ?)").run(Date.now());
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * 비밀 값이 섞여 저장된 과거 오류 기록 제거 (비밀 값을 잘못 넣었을 때 헤더 오류 문구에 값이 포함된 경우)
 * 이후 기록은 저장 시점에 redactSecrets 로 가려진다.
 */
function scrubLeakedSecrets(db: DatabaseSync) {
  const leak = "(%s LIKE '%API_KEY=%' OR %s LIKE '%Headers.append%' OR %s LIKE '%_TOKEN=%')";
  const cond = (col: string) => leak.replaceAll("%s", col);
  try {
    db.exec(`DELETE FROM provider_calls WHERE ${cond("error")}`);
    db.exec(`UPDATE job_runs SET details = NULL WHERE ${cond("details")}`);
    db.exec(`UPDATE job_runs SET message = '오류 내용에 비밀 값이 포함되어 삭제됨' WHERE ${cond("message")}`);
  } catch {
    // 읽기 전용 등으로 실패해도 무시
  }
}

/** 테스트용: 연결 종료 */
export function closeDb() {
  if (globalThis.__stockDb) {
    globalThis.__stockDb.close();
    globalThis.__stockDb = undefined;
    globalThis.__stockDbPath = undefined;
  }
}

type Row = Record<string, SQLInputValue>;

export function all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return getDb().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  run(
    "INSERT INTO settings(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

/** 단순 리스 기반 잠금 (worker 중복 실행 방지) */
export function acquireLock(name: string, owner: string, ttlMs: number): boolean {
  const now = Date.now();
  return tx(() => {
    const row = get<{ owner: string; expires_at: number }>("SELECT owner, expires_at FROM locks WHERE name = ?", name);
    if (row && row.owner !== owner && row.expires_at > now) return false;
    run(
      "INSERT INTO locks(name, owner, expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at",
      name,
      owner,
      now + ttlMs,
    );
    return true;
  });
}

export function releaseLock(name: string, owner: string) {
  run("DELETE FROM locks WHERE name = ? AND owner = ?", name, owner);
}

export function jsonOrNull<T>(s: unknown): T | null {
  if (typeof s !== "string" || !s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
