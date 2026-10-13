import SettingsClient from "@/components/SettingsClient";
import DataManagement from "@/components/DataManagement";
import { IS_STATIC } from "@/lib/static-mode";

export const metadata = { title: "설정" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">설정 · 데이터 관리</h1>
        <p className="text-sm text-muted">
          화면 설정·관심 종목·내 자산·전략 등 개인 데이터는 이 브라우저에만 저장됩니다.{" "}
          {IS_STATIC ? "데이터 업데이트 일정은 GitHub 저장소의 워크플로 설정에서 바꿉니다." : "서버 데이터 업데이트 일정은 관리자 토큰으로 변경할 수 있습니다."}
        </p>
      </div>
      <SettingsClient />
      <DataManagement />
    </div>
  );
}
