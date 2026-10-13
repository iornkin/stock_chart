/** 서버 컴포넌트 페이지용: 서버 모드에서는 요청마다, 정적 모드에서는 빌드 때 한 번 렌더링한다 */
import { connection } from "next/server";
import { IS_STATIC } from "./static-mode";

export async function perRequest(): Promise<void> {
  if (!IS_STATIC) await connection();
}

/** 정적 모드에는 요청이 없으므로 쿼리 문자열을 읽지 않는다 (화면에서 브라우저가 처리) */
export async function readSearchParams<T extends object>(sp: Promise<T>): Promise<Partial<T>> {
  return IS_STATIC ? {} : await sp;
}
