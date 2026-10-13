/**
 * 정적 사이트(GitHub Pages) 빌드 여부와 경로.
 * next.config 의 env 로 서버·클라이언트 코드에 함께 주입된다. (export-static 스크립트는 STATIC_EXPORT=1 로 판단)
 */
export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1" || process.env.STATIC_EXPORT === "1";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";

/** 정적 빌드에서 out/data 아래에 저장한 JSON 의 주소 */
export function staticDataUrl(path: string): string {
  return `${BASE_PATH}/data/${path}`;
}
