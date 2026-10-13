import { buildEtfMap } from "@/lib/etf-map";
import { perRequest } from "@/lib/page-mode";
import EtfMap from "@/components/EtfMap";
import { Fold, PageHeader } from "@/components/ui";

export const metadata = { title: "ETF 관계 지도" };

export default async function MapPage() {
  await perRequest();
  const data = buildEtfMap();
  return (
    <div className="flex flex-col">
      <PageHeader title="ETF 관계 지도" description="기초지수·운용 전략이 같은 ETF 를 묶었습니다. 종목을 누르면 같은 묶음끼리 1년 성과·변동성·상관계수·편입 종목 중복을 비교합니다." />
      <div className="flex flex-col gap-5">
        <EtfMap data={data} />
        <Fold summary="연결·계산 기준">
          설정 파일의 기초지수·운용 전략·레버리지 배수로 묶었습니다. 성과는 분배금 재투자 총수익(최근 1년), 변동성·상관계수는 일간 수익률 기준이며 데이터 기준일은 {data.asOf ?? "-"}입니다. 편입 종목 중복은 제공처가 주는 상위 편입 종목(보통 10개)만으로 계산해 실제 전체 중복과 다를 수 있습니다.
        </Fold>
      </div>
    </div>
  );
}
