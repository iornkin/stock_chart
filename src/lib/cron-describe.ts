/** GitHub Actions cron(UTC) 을 사람이 읽을 수 있게 바꾼다: "45 13,15 * * 1-5" → 요일별 UTC 시각과 한국 시각 */
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

function expandDow(f: string): number[] | null {
  if (f === "*") return [0, 1, 2, 3, 4, 5, 6];
  const out: number[] = [];
  for (const part of f.split(",")) {
    const m = /^(\d)(?:-(\d))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]) % 7;
    const b = m[2] ? Number(m[2]) % 7 : a;
    for (let d = a; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === b) break;
    }
  }
  return [...new Set(out)];
}

function dowLabel(days: number[]): string {
  if (days.length === 7) return "매일";
  const s = [...days].sort((a, b) => a - b);
  if (s.join() === "0,6") return "토·일";
  // 연속된 3일 이상은 범위로 (예: 화–토)
  if (s.length >= 3 && s.every((d, i) => i === 0 || d === s[i - 1] + 1)) return `${DOW_KO[s[0]]}–${DOW_KO[s[s.length - 1]]}`;
  return s.map((d) => DOW_KO[d]).join("·");
}

const pad = (n: number) => String(n).padStart(2, "0");

export interface CronDescription {
  cron: string;
  utc: string;
  kst: string;
}

export function describeCron(cron: string): CronDescription {
  const f = cron.trim().split(/\s+/);
  const fallback = { cron, utc: cron, kst: "-" };
  if (f.length !== 5 || f[2] !== "*" || f[3] !== "*") return fallback;
  const minute = Number(f[0]);
  const hours = f[1].split(",").map(Number);
  const days = expandDow(f[4]);
  if (!Number.isInteger(minute) || hours.some((h) => !Number.isInteger(h)) || !days) return fallback;
  const shift = (offset: number) => {
    const byDay = new Map<string, string[]>();
    for (const h of hours) {
      const total = h + offset;
      const dayShift = Math.floor(total / 24);
      const hh = ((total % 24) + 24) % 24;
      const key = dowLabel(days.map((d) => (((d + dayShift) % 7) + 7) % 7));
      byDay.set(key, [...(byDay.get(key) ?? []), `${pad(hh)}:${pad(minute)}`]);
    }
    return [...byDay.entries()].map(([d, ts]) => `${d} ${ts.join("·")}`).join(", ");
  };
  return { cron, utc: shift(0), kst: shift(9) };
}
