import SettingsClient from "@/components/SettingsClient";
import { IS_STATIC } from "@/lib/static-mode";

export const metadata = { title: "설정" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">설정</h1>
        <p className="text-sm text-muted">
          화면 설정과 관심 종목은 이 브라우저에 저장됩니다.{" "}
          {IS_STATIC ? "데이터 업데이트 일정은 GitHub 저장소의 워크플로 설정에서 바꿉니다." : "서버 데이터 업데이트 일정은 관리자 토큰으로 변경할 수 있습니다."}
        </p>
      </div>
      <SettingsClient />
    </div>
  );
}
