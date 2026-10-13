import SettingsClient from "@/components/SettingsClient";
import DataManagement from "@/components/DataManagement";
import { IS_STATIC } from "@/lib/static-mode";
import { PageHeader, Section } from "@/components/ui";
import { InstallApp } from "@/components/PwaRegister";

export const metadata = { title: "설정" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="설정·백업" description={`관심 종목·내 자산·전략 등 개인 데이터는 이 브라우저에만 저장됩니다. ${IS_STATIC ? "데이터 업데이트 일정은 GitHub 워크플로 설정에서 바꿉니다." : "서버 업데이트 일정은 관리자 토큰으로 바꿀 수 있습니다."}`} />
      <div className="flex flex-col gap-5">
        <DataManagement />
        <SettingsClient />
        <Section title="홈 화면에 설치" description="앱처럼 바로 열 수 있게 휴대폰·컴퓨터 홈 화면에 추가합니다">
          <InstallApp />
        </Section>
      </div>
    </div>
  );
}
