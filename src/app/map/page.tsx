import { buildEtfMap } from "@/lib/etf-map";
import { perRequest } from "@/lib/page-mode";
import EtfMap from "@/components/EtfMap";

export const metadata = { title: "ETF 관계 지도" };

export default async function MapPage() {
  await perRequest();
  const data = buildEtfMap();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ETF 관계 지도</h1>
        <p className="mt-1 text-sm text-ink-2">
          지원 종목을 실제 기초지수와 운용 전략으로 묶었습니다. 종목을 누르면 같은 묶음의 다른 ETF 와 1년 성과·변동성·상관계수·편입 종목 중복을 비교합니다.
        </p>
      </div>
      <EtfMap data={data} />
      <p className="text-[11px] leading-relaxed text-muted">
        연결 기준: 설정 파일의 기초지수·운용 전략·레버리지 배수. 성과는 분배금 재투자 총수익(최근 1년), 변동성·상관계수는 일간 수익률 기준이며 데이터 기준일은 {data.asOf ?? "-"}입니다. 편입 종목 중복은 제공처가 주는 상위 편입 종목(보통 10개)만으로 계산해 실제 전체 중복과 다를 수 있습니다.
      </p>
    </div>
  );
}
