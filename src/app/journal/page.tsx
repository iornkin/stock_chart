import JournalClient from "@/components/JournalClient";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "투자 기록" };

export default function JournalPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="투자 판단 기록" description="사고팔 때의 판단 근거를 적어 두고, 다시 볼 날에 실제 결과와 비교합니다. 처음 적은 판단은 고치지 않고 사후 평가를 따로 쌓습니다. 이 브라우저에만 저장됩니다." />
      <JournalClient />
    </div>
  );
}
