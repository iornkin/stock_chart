/**
 * 배포 전 최종 점검 (정적 사이트 out/) — 하나라도 실패하면 종료 코드 1 로 배포를 막는다.
 * 1) 꼭 있어야 할 페이지·데이터 파일
 * 2) out/data 의 모든 JSON 이 읽히는지
 * 3) 비밀 값 노출: 환경변수의 API 키·토큰 값, 제공처 주소에 붙은 키(apikey=…) 가 out/ 어디에도 없는지
 * 4) 시세 값이 숫자이고 0 보다 큰지 (오래된 데이터는 경고만)
 * 사용: npm run verify:static  (GitHub Actions 에서는 비밀 값이 환경변수로 주어져 실제 값까지 검사)
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "out");
const problems: string[] = [];
const warnings: string[] = [];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// 1) 필수 파일
for (const f of ["index.html", "404.html", "data/build.json", "data/quotes.json", "data/income.json", "data/exposure.json", "data/exposure-history.json", "data/series/QQQ.json", "data/chart/QQQ/1d.json", "backtest/strategy/index.html", "stock/QQQ/index.html"])
  if (!fs.existsSync(path.join(OUT, f))) problems.push(`필수 파일 없음: ${f}`);

// 2) JSON 읽기
const files = walk(OUT);
let jsonCount = 0;
for (const f of files.filter((x) => x.endsWith(".json"))) {
  jsonCount++;
  try {
    JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    problems.push(`JSON 을 읽을 수 없음: ${path.relative(OUT, f)} (${(e as Error).message})`);
  }
}

// 3) 비밀 값
const secretNames = ["FINNHUB_API_KEY", "POLYGON_API_KEY", "FRED_API_KEY", "ALPHAVANTAGE_API_KEY", "ANTHROPIC_API_KEY", "ADMIN_TOKEN"];
const secrets = secretNames.map((n) => [n, (process.env[n] ?? "").trim()] as const).filter(([, v]) => v.length >= 8);
// 데이터 제공처 주소에 키가 붙은 채 남은 경우 (뉴스 기사 주소의 token= 등은 제외하려고 제공처 주소로 한정)
const keyInUrl = /(?:finnhub\.io|stlouisfed\.org|polygon\.io|alphavantage\.co)[^"'\s<>]*?[?&](?:apikey|api_key|apiKey|token)=(?!\*\*\*)[A-Za-z0-9_-]{8,}/;
const textExt = /\.(html|js|json|css|txt|xml|webmanifest|map)$/;
for (const f of files.filter((x) => textExt.test(x))) {
  const s = fs.readFileSync(f, "utf8");
  for (const [n, v] of secrets) if (s.includes(v)) problems.push(`비밀 값 노출: ${n} 값이 ${path.relative(OUT, f)} 에 들어 있음`);
  const m = s.match(keyInUrl);
  if (m) problems.push(`주소에 키로 보이는 값: ${path.relative(OUT, f)} — ${m[0].slice(0, 20)}…`);
}

// 4) 시세 값
try {
  const q = JSON.parse(fs.readFileSync(path.join(OUT, "data/quotes.json"), "utf8")) as { quotes: { symbol: string; price: number | null; fetchedAt?: number; marketTime?: number | null }[]; serverTime: number };
  const bad = q.quotes.filter((x) => x.price !== null && !(typeof x.price === "number" && Number.isFinite(x.price) && x.price > 0));
  if (bad.length) problems.push(`시세 값이 이상함: ${bad.map((x) => x.symbol).join(", ")}`);
  const old = q.quotes.filter((x) => q.serverTime - (x.marketTime ?? x.fetchedAt ?? 0) > 7 * 86400_000);
  if (old.length) warnings.push(`7일 넘게 갱신되지 않은 시세 ${old.length}개 (예: ${old.slice(0, 5).map((x) => x.symbol).join(", ")}) — 화면에는 기준 시각과 함께 표시됨`);
} catch {
  /* 1) 에서 이미 알림 */
}

console.log(`정적 사이트 점검: 파일 ${files.length}개, JSON ${jsonCount}개, 비밀 값 ${secrets.length}개 대조`);
for (const w of warnings) console.log(`경고: ${w}`);
if (problems.length) {
  for (const p of problems.slice(0, 50)) console.error(`실패: ${p}`);
  process.exit(1);
}
console.log("통과");
