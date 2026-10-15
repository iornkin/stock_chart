/**
 * CNN 공포·탐욕 지수 화면 조각 (서버 컴포넌트)
 * - 계기(0~100, 다섯 구간) + 지금 값·판정 + CNN 비교 값 + 일별 기록 선 그래프 + 7개 구성 지표 표
 * - 색: 공포 쪽은 하락 색, 탐욕 쪽은 상승 색 (설정의 색 관례를 따름), 가운데 중립은 회색.
 *   구간 이름과 경계 숫자를 함께 적어 색만으로 구분하지 않는다.
 * - 값은 모두 CNN 이 준 그대로다. 이 사이트가 지수를 다시 계산하지 않는다.
 */
import { STALE_DAYS } from "@/config/positioning";
import type { MarketSentimentData } from "@/lib/data/positioning";
import { FG_COMPONENTS, type FgComponent, type FgRating } from "@/lib/providers/cnn";
import { FG_RATING_KO, FG_ZONES, fgRating, fgZone } from "@/lib/positioning";
import { fmtPrice } from "@/lib/format";
import { formatEt } from "@/lib/time";
import { Fold, Notice, SourceLine, Stat } from "@/components/ui";
import { LineSvg } from "./Charts";

export const CNN_FG_URL = "https://edition.cnn.com/markets/fear-and-greed";
const DAY = 86400_000;

const ZONE_BG: Record<FgRating, string> = {
  "extreme fear": "var(--down)",
  fear: "color-mix(in srgb, var(--down) 55%, var(--surface))",
  neutral: "var(--surface-3)",
  greed: "color-mix(in srgb, var(--up) 55%, var(--surface))",
  "extreme greed": "var(--up)",
};

const signed = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

/** 판정 이름 — CNN 판정이 없으면 점수 구간으로 정하고 그렇다고 적는다 */
export function fgLabel(score: number | null, cnnRating: FgRating | null): string {
  const r = fgRating(score, cnnRating);
  if (!r) return "판정 없음";
  return cnnRating ? FG_RATING_KO[r] : `${FG_RATING_KO[r]} (점수 구간 기준)`;
}

/** 0~100 계기: 다섯 구간 색 띠 + 지금 값 표시 막대 + 경계 숫자 + 구간 이름 */
export function FearGreedMeter({ score, rating }: { score: number; rating: FgRating | null }) {
  const label = fgLabel(score, rating);
  return (
    <div role="img" aria-label={`공포·탐욕 지수 ${score.toFixed(0)} — ${label} (0 극단적 공포 ~ 100 극단적 탐욕)`}>
      <div className="relative h-3">
        <div className="absolute inset-0 overflow-hidden rounded-full" aria-hidden>
          {FG_ZONES.map((z) => (
            <div key={z.rating} className="absolute inset-y-0" style={{ left: `${z.from}%`, width: `${z.to - z.from}%`, background: ZONE_BG[z.rating] }} title={`${FG_RATING_KO[z.rating]} ${z.from}~${z.to}`} />
          ))}
          {/* 구간 사이 2px 표면색 간격 (위치는 경계 그대로) */}
          {FG_ZONES.slice(1).map((z) => (
            <div key={`gap-${z.from}`} className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-surface" style={{ left: `${z.from}%` }} />
          ))}
        </div>
        <div aria-hidden className="absolute -top-1.5 h-6 w-[4px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface" style={{ left: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
      <div aria-hidden className="relative mt-1 h-3.5 text-[10px] text-muted">
        {[0, 25, 45, 55, 75, 100].map((t) => (
          <span key={t} className={`num absolute ${t === 0 ? "" : t === 100 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${t}%` }}>
            {t}
          </span>
        ))}
      </div>
      <div aria-hidden className="relative h-4 text-[11px] text-ink-2">
        {FG_ZONES.map((z) => (
          <span key={z.rating} className="absolute truncate text-center" style={{ left: `${z.from}%`, width: `${z.to - z.from}%` }}>
            {z.rating === "neutral" ? "중립" : FG_RATING_KO[z.rating]}
          </span>
        ))}
      </div>
    </div>
  );
}

function componentValue(c: FgComponent): string {
  const [a, b] = c.values;
  if (a === null) return "데이터 미제공";
  const def = FG_COMPONENTS.find((d) => d.key === c.key)!;
  if (c.key === "momentum") return `S&P 500 ${fmtPrice(a, 2)}${b !== null && b > 0 ? ` · 125일 평균 ${fmtPrice(b, 2)} (${signed((a / b - 1) * 100)}%)` : ""}`;
  if (c.key === "volatility") return `VIX ${a.toFixed(2)}${b !== null ? ` · 50일 평균 ${b.toFixed(2)}` : ""}`;
  if (def.unit === "ratio") return a.toFixed(2);
  if (def.unit === "pp") return `${signed(a, 2)}%p`;
  return signed(a, 2);
}

export function FearGreedSection({ fg, now }: { fg: NonNullable<MarketSentimentData["fearGreed"]>; now: number }) {
  const cur = fg.now;
  const stale = (now - cur.at) / DAY > STALE_DAYS.fearGreed;
  const hist = fg.history;
  const year = hist.slice(-252);
  const lo = year.length ? year.reduce((m, p) => (p.score < m.score ? p : m)) : null;
  const hi = year.length ? year.reduce((m, p) => (p.score > m.score ? p : m)) : null;
  const prev = cur.previous;
  const cmp: { label: string; v: number | null }[] = [
    { label: "직전 장 마감", v: prev.close },
    { label: "1주 전", v: prev.week },
    { label: "1개월 전", v: prev.month },
    { label: "1년 전", v: prev.year },
  ];
  return (
    <div className="flex flex-col gap-4">
      {stale && (
        <Notice tone="warn">
          CNN 지수 값이 {formatEt(cur.at)} 기준으로 {Math.floor((now - cur.at) / DAY)}일 지났습니다. 수집이 실패했거나 CNN 자료 형식이 바뀌었을 수 있습니다.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:items-center">
        <div>
          <div className="text-xs text-muted">지금 값 (0~100)</div>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold leading-tight">{cur.score.toFixed(0)}</span>
            <span className="text-lg font-semibold text-ink-2">{fgLabel(cur.score, cur.rating)}</span>
          </div>
          <div className="text-[11px] text-muted">
            CNN 기준 {formatEt(cur.at)}{prev.close !== null ? ` · 직전 장 마감 대비 ${signed(cur.score - prev.close)}` : ""}
          </div>
        </div>
        <FearGreedMeter score={cur.score} rating={cur.rating} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cmp.map((c) => (
          <Stat key={c.label} label={`${c.label} (CNN)`} value={c.v !== null ? c.v.toFixed(0) : "데이터 미제공"} sub={c.v !== null ? `${FG_RATING_KO[fgZone(c.v)!]} · 지금과 ${signed(cur.score - c.v)}` : undefined} />
        ))}
      </div>
      {hist.length >= 2 ? (
        <div>
          <p className="mb-1 text-xs text-muted">
            일별 기록 {hist[0].date} ~ {hist[hist.length - 1].date} ({hist.length}거래일)
            {lo && hi ? ` · 최근 1년 최저 ${lo.score.toFixed(0)} (${lo.date}), 최고 ${hi.score.toFixed(0)} (${hi.date})` : ""}
          </p>
          <LineSvg
            dates={hist.map((p) => p.date)}
            series={[{ key: "fg", label: "공포·탐욕 지수", color: "var(--s1)", values: hist.map((p) => p.score) }]}
            fmt="compact"
            domain={[0, 100]}
            refLines={[
              { value: 25, label: "25 아래 극단적 공포" },
              { value: 75, label: "75 위 극단적 탐욕" },
            ]}
            ariaLabel="CNN 공포·탐욕 지수 일별 추이"
          />
          <Fold summary="최근 20거래일 표">
            <div className="overflow-x-auto">
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th className="r">지수</th>
                    <th>판정</th>
                  </tr>
                </thead>
                <tbody>
                  {hist
                    .slice(-20)
                    .reverse()
                    .map((p) => (
                      <tr key={p.date}>
                        <td className="whitespace-nowrap">{p.date}</td>
                        <td className="r num">{p.score.toFixed(1)}</td>
                        <td>{fgLabel(p.score, p.rating)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Fold>
        </div>
      ) : (
        <p className="text-xs text-muted">일별 기록이 아직 부족해 추이 그래프를 그리지 않습니다.</p>
      )}
      <div>
        <h3 className="mb-1 text-sm font-semibold">구성 지표 7개 (CNN 이 같은 비중으로 합침)</h3>
        <div className="overflow-x-auto">
          <table className="table-basic">
            <thead>
              <tr>
                <th>지표 (무엇을 보나)</th>
                <th>최근 값 (CNN)</th>
                <th className="r">CNN 점수</th>
                <th>판정</th>
                <th>CNN 갱신</th>
              </tr>
            </thead>
            <tbody>
              {FG_COMPONENTS.map((def) => {
                const c = cur.components.find((x) => x.key === def.key);
                return (
                  <tr key={def.key}>
                    <td className="min-w-[10rem]">
                      <span className="font-semibold">{def.label}</span>
                      <span className="block text-[11px] text-muted">{def.what}</span>
                    </td>
                    <td className="num text-xs">{c ? componentValue(c) : "데이터 미제공"}</td>
                    <td className="r num">{c?.score !== null && c?.score !== undefined ? c.score.toFixed(1) : "-"}</td>
                    <td className="text-xs">{c && c.score !== null ? fgLabel(c.score, c.rating) : "데이터 미제공"}</td>
                    <td className="whitespace-nowrap text-xs">{c?.at ? formatEt(c.at) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <SourceLine>
        출처:{" "}
        <a href={CNN_FG_URL} className="link" target="_blank" rel="noopener noreferrer">
          CNN Business Fear &amp; Greed Index
        </a>{" "}
        · 수집 {formatEt(fg.info.fetchedAt)}. CNN 이 7개 지표를 같은 비중으로 합쳐 0~100 으로 만든 지수이며, 이 사이트가 계산한 값이 아닙니다. 각 지표를 점수로 바꾸는 자세한 방식은 CNN 이 공개하지 않아 이 사이트에서 검증할 수 없습니다.
        공식 API 가 아니라 CNN 웹 페이지가 쓰는 자료를 읽으므로 형식이 바뀌면 수집이 멈출 수 있고, 그때는 마지막으로 받은 값과 시각을 그대로 보여 줍니다. 일별 기록은 그날의 마지막 값이며, 장 마감 뒤 늦게 갱신되는 지표가 있어 가장 최근 하루 값은 다음 수집 때 바뀔 수 있습니다.
        구성 지표 중 풋·콜은 CNN 산출값이라 아래 Cboe 표와 기준이 다를 수 있습니다. 구간 경계(25·45·55·75)는 CNN 화면 기준입니다. 지수가 낮다고(공포) 사라거나 높다고(탐욕) 팔라는 뜻이 아니며, 시장 분위기를 보는 참고 자료입니다.
      </SourceLine>
    </div>
  );
}
