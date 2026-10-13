/** db-concurrency.test.ts 가 여러 프로세스로 동시에 실행: 같은 새 DB 파일을 열고 스키마·마이그레이션을 적용 */
import { getDb } from "../../src/lib/db";

getDb();
console.log("ok");
