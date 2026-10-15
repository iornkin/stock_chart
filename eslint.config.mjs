import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler 용 규칙 — 이 프로젝트는 컴파일러를 쓰지 않는다.
      // 데이터 불러오기 effect 안의 setState, 화면 시각(Date.now) 표시는 의도한 동작이라 경고로만 둔다.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "data/**", "public/sw.js"]),
]);

export default eslintConfig;
