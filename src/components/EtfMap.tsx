"use client";
/** ETF 관계 지도: 기초지수 묶음별 연결 그림 + 선택한 종목의 관계·차이 */
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { RELATION_LABEL, type EtfMapData, type MapNode, type RelationKind } from "@/lib/etf-map-types";

const EDGE: Record<RelationKind, { stroke: string; width: number; dash?: string }> = {
  index: { stroke: "var(--text-2)", width: 2 },
  leveraged: { stroke: "var(--warn)", width: 3.5 },
  covered_call: { stroke: "var(--accent)", width: 2, dash: "7 4" },
  option_active: { stroke: "var(--accent)", width: 2, dash: "2 4" },
  dividend: { stroke: "var(--border-strong)", width: 1.5 },
  sector: { stroke: "var(--border-strong)", width: 1.5 },
  gold: { stroke: "var(--border-strong)", width: 1.5 },
  broad: { stroke: "var(--border-strong)", width: 1.5 },
};

const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "-" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "" : v > 0 ? "text-up" : "text-down");

function Cluster({ title, description, members, nodes, selected, onSelect }: { title: string; description: string; members: string[]; nodes: Record<string, MapNode>; selected: string; onSelect: (s: string) => void }) {
  const W = 360;
  const n = members.length;
  const R = n <= 3 ? 82 : n <= 6 ? 100 : 112;
  const H = 2 * R + 70;
  const cx = W / 2;
  const cy = H / 2;
  const pos = members.map((s, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { s, x: cx + R * Math.cos(a) * 1.25, y: cy + R * Math.sin(a) };
  });
  return (
    <div className="card p-4">
      <p className="text-[15px] font-bold">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="group" aria-label={`${title} 관계 그림`}>
        {pos.map((p) => {
          const e = EDGE[nodes[p.s].relation];
          return <line key={`e-${p.s}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={e.stroke} strokeWidth={e.width} strokeDasharray={e.dash} strokeLinecap="round" />;
        })}
        <rect x={cx - 46} y={cy - 16} width={92} height={32} rx={16} fill="var(--surface-3)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text)">
          {title}
        </text>
        {pos.map((p) => {
          const sel = p.s === selected;
          const node = nodes[p.s];
          return (
            <g key={p.s} role="button" tabIndex={0} aria-label={`${p.s} ${node.name}`} aria-pressed={sel} onClick={() => onSelect(p.s)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(p.s)} className="cursor-pointer outline-none">
              <circle cx={p.x} cy={p.y} r={sel ? 27 : 24} fill={sel ? "var(--accent)" : "var(--surface)"} stroke={sel ? "var(--accent)" : "var(--border-strong)"} strokeWidth={sel ? 3 : 1.5} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={p.s.length > 4 ? 10 : 11.5} fontWeight="700" fill={sel ? "#fff" : "var(--text)"}>
                {p.s}
              </text>
              {node.leverage && (
                <text x={p.x + ((p.x - cx) / Math.hypot(p.x - cx, p.y - cy)) * 40} y={p.y + ((p.y - cy) / Math.hypot(p.x - cx, p.y - cy)) * 40 + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--warn)">
                  {node.leverage}배
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function EtfMap({ data }: { data: EtfMapData }) {
  const [selected, setSelected] = useState("QQQ" in data.nodes ? "QQQ" : Object.keys(data.nodes)[0]);
  const [stock, setStock] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const node = data.nodes[selected];
  const hub = data.hubs.find((h) => h.key === node?.hub);

  const select = (s: string) => {
    setSelected(s);
    setStock(null);
    if (window.innerWidth < 1280) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const similar = useMemo(() => {
    const c = data.corr[selected] ?? {};
    return Object.entries(c)
      .filter(([s]) => s !== selected)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [data, selected]);

  const stockInfo = stock ? data.stocks.find((s) => s.stock === stock) : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
          {(Object.keys(EDGE) as RelationKind[])
            .filter((k) => Object.values(data.nodes).some((n) => n.relation === k))
            .map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <svg width="28" height="8" aria-hidden>
                  <line x1="2" y1="4" x2="26" y2="4" stroke={EDGE[k].stroke} strokeWidth={EDGE[k].width} strokeDasharray={EDGE[k].dash} strokeLinecap="round" />
                </svg>
                {RELATION_LABEL[k]}
              </span>
            ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {data.hubs.map((h) => (
            <Cluster key={h.key} title={h.title} description={h.description} members={h.members} nodes={data.nodes} selected={stock ? "" : selected} onSelect={select} />
          ))}
        </div>
        <div className="card p-4">
          <p className="text-[15px] font-bold">개별 주식과 ETF 연결</p>
          <p className="mt-0.5 text-xs text-muted">M7 종목을 누르면 그 종목을 상위 편입 종목으로 담은 ETF 와 비중을 보여 줍니다 (제공처 상위 편입 종목 기준).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.stocks.map((s) => (
              <button
                key={s.stock}
                type="button"
                onClick={() => {
                  setStock(s.stock);
                  if (window.innerWidth < 1280) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                aria-pressed={stock === s.stock}
                className={`rounded-full border px-3 py-1.5 text-sm ${stock === s.stock ? "border-accent bg-accent text-white" : "border-line hover:border-accent"}`}
              >
                {s.stock} <span className={`text-xs ${stock === s.stock ? "text-white/80" : "text-muted"}`}>{s.holders.length}개 ETF</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div ref={panelRef} className="scroll-mt-20 xl:sticky xl:top-20 xl:self-start">
        {stockInfo ? (
          <div className="card flex flex-col gap-4 p-5">
            <div>
              <p className="text-xs text-muted">개별 주식</p>
              <p className="text-xl font-bold">
                {stockInfo.stock} <span className="text-sm font-normal text-muted">{stockInfo.name}</span>
              </p>
            </div>
            {stockInfo.holders.length ? (
              <table className="table-basic">
                <thead>
                  <tr>
                    <th>이 종목을 담은 ETF</th>
                    <th className="r">비중</th>
                    <th className="r">1년 상관계수</th>
                  </tr>
                </thead>
                <tbody>
                  {stockInfo.holders.map((h) => (
                    <tr key={h.etf}>
                      <td>
                        <button type="button" onClick={() => select(h.etf)} className="font-semibold hover:text-accent">
                          {h.etf}
                        </button>
                      </td>
                      <td className="r num">{h.weight.toFixed(1)}%</td>
                      <td className="r num">{data.corr[stockInfo.stock]?.[h.etf]?.toFixed(2) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">수집된 ETF 상위 편입 종목 중 이 종목이 없습니다.</p>
            )}
            <Link href={`/stock/${stockInfo.stock}`} className="link text-sm">
              {stockInfo.stock} 상세 보기 →
            </Link>
          </div>
        ) : node ? (
          <div className="card flex flex-col gap-4 p-5">
            <div>
              <p className="text-xs text-muted">
                {hub?.title} · {RELATION_LABEL[node.relation]}
              </p>
              <p className="text-xl font-bold">
                {node.symbol} <span className="text-sm font-normal text-muted">{node.name}</span>
              </p>
              <p className="mt-1 text-sm text-ink-2">
                기초자산: <span className="text-ink">{node.underlying}</span>
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{node.strategyNote}</p>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {[
                ["1년 총수익", <span key="r" className={tone(node.ret1y)}>{pct(node.ret1y)}</span>],
                ["1년 변동성", node.vol1y !== null ? `${node.vol1y.toFixed(1)}%` : "-"],
                ["총보수", node.expenseRatio !== null ? `${node.expenseRatio.toFixed(2)}%` : "미제공"],
                ["TTM 분배 수익률", node.ttmYield !== null ? `${node.ttmYield.toFixed(2)}%` : "-"],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-lg bg-surface-2 px-3 py-2">
                  <dt className="text-[11px] text-muted">{l}</dt>
                  <dd className="num mt-0.5 font-semibold">{v}</dd>
                </div>
              ))}
            </dl>

            {hub && hub.members.length > 1 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-ink-2">같은 묶음과 비교 ({node.symbol} 기준)</p>
                <div className="overflow-x-auto">
                  <table className="table-basic">
                    <thead>
                      <tr>
                        <th>종목</th>
                        <th className="r">1년 수익 차이</th>
                        <th className="r">변동성</th>
                        <th className="r">상관</th>
                        <th className="r">중복</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hub.members
                        .filter((s) => s !== node.symbol)
                        .map((s) => {
                          const m = data.nodes[s];
                          const diff = m.ret1y !== null && node.ret1y !== null ? m.ret1y - node.ret1y : null;
                          return (
                            <tr key={s}>
                              <td>
                                <button type="button" onClick={() => select(s)} className="font-semibold hover:text-accent">
                                  {s}
                                </button>
                                <span className="block text-[10px] text-muted">{m.leverage ? `${m.leverage}배` : RELATION_LABEL[m.relation]}</span>
                              </td>
                              <td className={`r num ${tone(diff)}`}>{diff === null ? "-" : `${pct(diff)}p`}</td>
                              <td className="r num">{m.vol1y !== null ? `${m.vol1y.toFixed(0)}%` : "-"}</td>
                              <td className="r num">{data.corr[node.symbol]?.[s]?.toFixed(2) ?? "-"}</td>
                              <td className="r num">{data.overlap[node.symbol]?.[s] !== undefined ? `${data.overlap[node.symbol][s].toFixed(0)}%` : "-"}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10px] text-muted">상관 = 최근 1년 일간 수익률 상관계수 · 중복 = 상위 편입 종목 비중 중 겹치는 부분(전체 보유 내역 아님)</p>
              </div>
            )}

            {similar.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-ink-2">가장 비슷하게 움직인 종목 (1년 상관계수)</p>
                <div className="flex flex-wrap gap-1.5">
                  {similar.map(([s, c]) => (
                    <button key={s} type="button" onClick={() => (data.nodes[s] ? select(s) : setStock(s))} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs hover:text-accent">
                      <strong>{s}</strong> {c.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {node.holdings.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-ink-2">상위 편입 종목 ({node.holdingsSource})</p>
                <ul className="flex flex-col gap-1">
                  {node.holdings.slice(0, 6).map((h) => (
                    <li key={h.name} className="flex items-center gap-2 text-sm">
                      <span className="w-14 shrink-0 font-semibold">{h.symbol ?? "-"}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, h.weight * 4)}%` }} />
                      </span>
                      <span className="num w-12 text-right text-xs">{h.weight.toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-3 text-sm">
              <Link href={`/stock/${node.symbol}`} className="link">
                {node.symbol} 상세 →
              </Link>
              {hub && hub.members.length > 1 && (
                <Link href={`/compare?symbols=${[node.symbol, ...hub.members.filter((s) => s !== node.symbol).slice(0, 2)].join(",")}`} className="link">
                  같은 묶음 성과 비교 →
                </Link>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
