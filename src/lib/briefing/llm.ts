/**
 * (선택) Claude API 를 이용한 브리핑 서술 보강
 *
 * - ANTHROPIC_API_KEY 가 설정된 경우에만 동작한다. 없으면 규칙 기반 브리핑만 제공된다.
 * - 모델에는 이미 수집·계산된 근거 자료(evidence)만 전달한다. 모델이 웹을 검색하거나
 *   새 사실을 가져오지 않는다.
 * - 모든 문장은 근거 ID 를 인용해야 하며, 존재하지 않는 근거를 인용한 문장은 버린다.
 * - 뉴스 요약은 '제목 + 제공처 요약문'만으로 작성한다 (기사 본문을 읽지 않음).
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import { logProviderCall } from "../http";
import { saveAiNewsText } from "../data/news";
import type { BriefingNews, Evidence, MarketBriefing, Statement, SymbolBriefing } from "./types";

export function llmEnabled(): boolean {
  return Boolean(env.anthropicKey);
}

/** 서버 측 거절 대체(fallbacks)를 지원하는 모델 */
function supportsFallback(model: string) {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
}

const SYSTEM = `당신은 미국 주식·ETF 분석 웹사이트의 브리핑 작성 보조자입니다.
사용자가 제공하는 '근거 자료(evidence)'와 '확인된 문장'만 사용해 한국어로 간결한 분석 문단을 작성합니다.

반드시 지킬 규칙:
1. 근거 자료에 없는 사실, 수치, 날짜, 원인을 만들지 마세요. 모르면 "자료가 부족해 판단을 유보합니다"라고 쓰세요.
2. 각 문단의 evidence 배열에는 그 문단이 사용한 근거 ID(예: P1, N2)를 모두 넣으세요. 근거 ID 목록에 없는 ID 는 쓰지 마세요.
3. 주가 움직임의 원인을 단정하지 마세요. 뉴스와 주가는 '같은 기간에 보도됨(시간적 연관성)'으로만 연결하세요.
4. 기사 내용을 전할 때는 "○○ 보도에 따르면"처럼 출처를 밝히고, 사이트의 분석과 구분하세요.
5. 매수·매도·보유 권유, 목표가, 상승·하락 단정 표현을 쓰지 마세요.
6. 레버리지 ETF 는 일일 목표·복리 효과를, 커버드콜·인컴 ETF 는 옵션 전략과 분배금 변동 가능성을, 금 ETF 는 금 가격·금리·달러를 중심으로 다루세요. 근거 자료 범위 안에서만 쓰세요.
7. 뉴스 번역·요약(news)은 주어진 제목과 제공처 요약문만 사용하세요. 요약문이 없으면 summary_ko 는 제목을 자연스럽게 옮긴 한 문장으로 쓰고, 본문 내용을 추측하지 마세요.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paragraphs", "news"],
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence"],
        properties: {
          text: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    news: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title_ko", "summary_ko"],
        properties: {
          id: { type: "string" },
          title_ko: { type: "string" },
          summary_ko: { type: "string" },
        },
      },
    },
  },
} as const;

interface LlmOutput {
  paragraphs: { text: string; evidence: string[] }[];
  news: { id: string; title_ko: string; summary_ko: string }[];
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 120_000 });
  return client;
}

async function callModel(userContent: string): Promise<LlmOutput> {
  const model = env.llmModel;
  const started = Date.now();
  try {
    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: env.llmEffort, format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: "user", content: userContent }],
    };
    if (supportsFallback(model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    const res = await getClient().beta.messages.create(params);
    logProviderCall("anthropic", `messages:${model}`, true, 200, null, Date.now() - started);
    if (res.stop_reason === "refusal") throw new Error("모델이 요청을 거절했습니다");
    if (res.stop_reason === "max_tokens") throw new Error("출력 길이 한도 초과");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return JSON.parse(text) as LlmOutput;
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? (e.status ?? null) : null;
    logProviderCall("anthropic", `messages:${model}`, false, status, (e as Error).message, Date.now() - started);
    throw e;
  }
}

function evidenceText(ev: Evidence[]): string {
  return ev.map((e) => `- ${e.id} [${e.type}] ${e.label}${e.value ? `: ${e.value}` : ""} (출처: ${e.source}${e.asOf ? `, 기준: ${e.asOf}` : ""})`).join("\n");
}

function statementsText(title: string, st: Statement[]): string {
  if (!st.length) return "";
  return `## ${title}\n${st.map((s) => `- (${s.kind}) ${s.text}${s.evidence.length ? ` [${s.evidence.join(",")}]` : ""}`).join("\n")}\n`;
}

function newsText(items: BriefingNews[]): string {
  return items
    .map((n) => `- id=${n.id} (근거 ${n.evidenceId}) | ${n.publisher ?? n.provider} | 게시 ${new Date(n.publishedAt).toISOString()}\n  제목: ${n.title}\n  제공처 요약문: ${n.summary ?? "(없음)"}`)
    .join("\n");
}

function validate(out: LlmOutput, ev: Evidence[], news: BriefingNews[]) {
  const ids = new Set(ev.map((e) => e.id));
  const paragraphs: Statement[] = (out.paragraphs ?? [])
    .map((p) => ({ text: String(p.text ?? "").trim(), kind: "ai" as const, evidence: (p.evidence ?? []).filter((x) => ids.has(x)) }))
    .filter((p) => p.text && p.evidence.length > 0);
  const newsIds = new Set(news.map((n) => n.id));
  const newsOut = (out.news ?? []).filter((n) => newsIds.has(n.id) && n.title_ko && n.summary_ko);
  return { paragraphs, newsOut };
}

function applyNews(items: BriefingNews[], newsOut: LlmOutput["news"]) {
  const map = new Map(newsOut.map((n) => [n.id, n]));
  for (const it of items) {
    const t = map.get(it.id);
    if (!t) continue;
    it.titleKo = t.title_ko;
    it.summaryKo = t.summary_ko;
    it.summaryBasis = "ai";
    saveAiNewsText(it.id, t.title_ko, t.summary_ko);
  }
}

export async function enrichSymbolBriefing(b: SymbolBriefing): Promise<SymbolBriefing> {
  const allNews = [...b.news.items, ...b.news.holdingsItems];
  const needNews = allNews.filter((n) => !n.summaryKo);
  const content = `# 종목: ${b.scope} (${b.name}) — ${b.sessionLabel}

## 근거 자료 (이 목록의 ID 만 인용 가능)
${evidenceText(b.evidence)}

${statementsText("확인된 사실·계산 (주가)", [...b.price.statements, ...b.price.benchmark, ...b.price.intraday])}
${statementsText("기술적 지표 해석 (사이트 규칙 기반)", b.technical.interpretations)}
${statementsText("배당·분배금", b.distributions?.statements ?? [])}
${statementsText("현재 상황 관련 관찰", b.risks.current)}
## 뉴스 (${b.news.windowLabel})
${newsText(allNews) || "(없음)"}

## 작성 요청
1. paragraphs: 이 종목의 오늘 상황을 2~4개 문단(각 2~3문장)으로 정리하세요. 종목 유형(${b.kind === "etf" ? "ETF" : "개별 기업"}, 분류: ${b.category})의 특성에 맞추세요.
2. news: 다음 뉴스 id 들의 한국어 제목(title_ko)과 1~2문장 요약(summary_ko)을 작성하세요: ${needNews.map((n) => n.id).join(", ") || "(없음 — 빈 배열)"}`;
  const out = await callModel(content);
  const { paragraphs, newsOut } = validate(out, b.evidence, allNews);
  applyNews(allNews, newsOut);
  return { ...b, ai: paragraphs.length ? { model: env.llmModel, paragraphs, generatedAt: Date.now() } : null };
}

export async function enrichMarketBriefing(b: MarketBriefing): Promise<MarketBriefing> {
  const needNews = b.news.filter((n) => !n.summaryKo);
  const content = `# 오늘의 미국 시장 — ${b.sessionLabel}

## 근거 자료 (이 목록의 ID 만 인용 가능)
${evidenceText(b.evidence)}

${b.sections.map((s) => statementsText(s.title, s.statements)).join("\n")}
## 시장 뉴스
${newsText(b.news) || "(없음)"}

## 작성 요청
1. paragraphs: 오늘 미국 시장 상황을 3~5개 문단으로 정리하세요. (1) 확인된 사실 (2) 기사에 보도된 시장 참여자의 해석(출처 명시) (3) 근거 자료 범위 안의 분석을 문장마다 구분되게 쓰세요. 기사의 발행 시각과 사건 발생 시점을 혼동하지 마세요.
2. news: 다음 뉴스 id 들의 한국어 제목과 1~2문장 요약: ${needNews.map((n) => n.id).join(", ") || "(없음 — 빈 배열)"}`;
  const out = await callModel(content);
  const { paragraphs, newsOut } = validate(out, b.evidence, b.news);
  applyNews(b.news, newsOut);
  return { ...b, ai: paragraphs.length ? { model: env.llmModel, paragraphs, generatedAt: Date.now() } : null };
}
