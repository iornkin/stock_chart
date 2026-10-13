"use client";
/** 설정 → 데이터 관리: 내보내기·불러오기·암호화 백업·초기화·저장소 상태, 개인정보 처리 안내 */
import { useEffect, useRef, useState } from "react";
import { collectBundle, decryptBackup, downloadJson, encryptBundle, passwordProblem, readJsonFile, resetAll, restoreBundle, validateBundle, ENCRYPTED_FORMAT, type UserBundle } from "@/lib/client/backup";
import { requestPersist, storageBackend, storageInfo, type Backend } from "@/lib/client/local-store";
import { etToday } from "@/lib/client/user-data";

const BACKEND_KO: Record<Backend, string> = {
  indexeddb: "IndexedDB (브라우저 내부 데이터베이스)",
  localstorage: "localStorage (IndexedDB 를 쓸 수 없어 대체 저장)",
  memory: "현재 탭 메모리 (브라우저가 저장을 막아 새로고침하면 사라짐)",
};

export default function DataManagement() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [info, setInfo] = useState<{ persisted: boolean | null; usage: number | null; quota: number | null } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ bundle: UserBundle; summary: string[]; encrypted: boolean } | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [restorePw, setRestorePw] = useState("");
  const [encFile, setEncFile] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    storageBackend().then(setBackend);
    storageInfo().then(setInfo);
  };
  useEffect(refresh, []);

  const exportPlain = async () => {
    const b = await collectBundle();
    downloadJson(`stock-insight-data-${etToday()}.json`, b);
    setMsg({ ok: true, text: "데이터 파일을 내려받았습니다. 이 파일은 암호화되지 않았으니 안전한 곳에 보관하세요." });
  };

  const exportEncrypted = async () => {
    const p = passwordProblem(pw);
    if (p) return setMsg({ ok: false, text: p });
    if (pw !== pw2) return setMsg({ ok: false, text: "비밀번호 확인이 일치하지 않습니다." });
    setBusy(true);
    try {
      const enc = await encryptBundle(await collectBundle(), pw);
      downloadJson(`stock-insight-backup-${etToday()}.encrypted.json`, enc);
      setMsg({ ok: true, text: "암호화 백업 파일을 내려받았습니다. 비밀번호는 어디에도 저장되지 않으므로 잊으면 복구할 수 없습니다." });
      setPw("");
      setPw2("");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setMsg(null);
    setPending(null);
    setEncFile(null);
    try {
      const j = await readJsonFile(file);
      if ((j as { format?: string })?.format === ENCRYPTED_FORMAT) {
        setEncFile(j);
        setMsg({ ok: true, text: "암호화된 백업입니다. 백업할 때 쓴 비밀번호를 입력하세요." });
        return;
      }
      const v = validateBundle(j);
      if (!v.ok) return setMsg({ ok: false, text: v.error });
      setPending({ bundle: v.bundle, summary: v.summary, encrypted: false });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const decrypt = async () => {
    setBusy(true);
    try {
      const j = await decryptBackup(encFile, restorePw);
      const v = validateBundle(j);
      if (!v.ok) return setMsg({ ok: false, text: v.error });
      setPending({ bundle: v.bundle, summary: v.summary, encrypted: true });
      setEncFile(null);
      setRestorePw("");
      setMsg(null);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const applyRestore = async () => {
    if (!pending) return;
    if (!window.confirm("지금 이 브라우저에 저장된 개인 데이터를 모두 지우고 파일 내용으로 바꿉니다. 계속할까요?")) return;
    await restoreBundle(pending.bundle);
    setMsg({ ok: true, text: "복원했습니다. 화면을 새로 불러옵니다…" });
    setTimeout(() => location.reload(), 600);
  };

  const reset = async () => {
    if (!window.confirm("내 자산·거래 내역·전략·계산 결과·관심 종목·화면 설정을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    if (!window.confirm("정말 모두 지울까요? 필요하면 먼저 백업 파일을 내려받으세요.")) return;
    await resetAll();
    setMsg({ ok: true, text: "모든 개인 데이터를 지웠습니다. 화면을 새로 불러옵니다…" });
    setTimeout(() => location.reload(), 600);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section id="data" className="card flex scroll-mt-20 flex-col gap-4 p-5">
        <h2 className="font-semibold">데이터 관리 (내보내기·불러오기·백업)</h2>
        <p className="text-sm text-ink-2">
          내 자산, 거래 내역, 전략, 계산 결과, 관심 종목과 화면 설정은 <b>이 브라우저에만</b> 저장됩니다. 브라우저의 사이트 데이터(쿠키·저장소)를 지우거나 다른 기기·브라우저로 옮기면 보이지 않으니 백업 파일로 옮기세요.
        </p>
        <dl className="text-xs text-ink-2">
          <div>
            <dt className="inline text-muted">저장 방식: </dt>
            <dd className="inline">{backend ? BACKEND_KO[backend] : "확인 중"}</dd>
          </div>
          <div>
            <dt className="inline text-muted">사용량: </dt>
            <dd className="inline">{info?.usage != null ? `${(info.usage / 1024).toFixed(0)}KB` : "확인 불가"}</dd>
          </div>
          <div>
            <dt className="inline text-muted">보존 요청: </dt>
            <dd className="inline">
              {info?.persisted === true ? "허용됨 (저장 공간이 부족해도 브라우저가 임의로 지우지 않음)" : info?.persisted === false ? "허용되지 않음" : "이 브라우저는 지원하지 않음"}
              {info?.persisted === false && (
                <button type="button" className="btn btn-sm ml-2" onClick={() => requestPersist().then(refresh)}>
                  보존 요청하기
                </button>
              )}
            </dd>
          </div>
        </dl>
        {backend === "memory" && <p className="text-sm text-critical">이 브라우저가 저장을 막고 있어(사생활 보호 모드 등) 새로고침하면 입력한 내용이 사라집니다.</p>}

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">1) 내보내기 (암호화 안 함)</p>
          <button type="button" className="btn self-start" onClick={exportPlain}>
            JSON 파일로 내보내기
          </button>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">2) 비밀번호로 암호화한 백업</p>
          <p className="text-xs text-muted">브라우저 안에서 PBKDF2(60만 회)로 만든 키와 AES-256-GCM 으로 암호화합니다. 비밀번호와 키는 서버나 브라우저 어디에도 저장하지 않습니다. 비밀번호를 잊으면 백업 파일을 복구하기 어렵습니다(사실상 불가능).</p>
          <div className="flex flex-wrap gap-2">
            <input type="password" className="input" placeholder="비밀번호 (8자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="백업 비밀번호" autoComplete="new-password" />
            <input type="password" className="input" placeholder="비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="백업 비밀번호 확인" autoComplete="new-password" />
            <button type="button" className="btn" onClick={exportEncrypted} disabled={busy}>
              {busy ? "암호화 중…" : "암호화 백업 내려받기"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">3) 불러오기·복원</p>
          <p className="text-xs text-muted">이 사이트에서 내보낸 파일(일반 또는 암호화)을 고르세요. 내용을 확인한 뒤 적용하면 현재 데이터를 모두 바꿉니다.</p>
          <button type="button" className="btn self-start" onClick={() => fileRef.current?.click()}>
            파일 고르기
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="복원할 데이터 파일" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0]).finally(() => (e.target.value = ""))} />
          {encFile !== null && (
            <div className="flex flex-wrap gap-2">
              <input type="password" className="input" placeholder="백업 비밀번호" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} aria-label="복원 비밀번호" autoComplete="current-password" />
              <button type="button" className="btn" onClick={decrypt} disabled={busy}>
                {busy ? "복호화 중…" : "복호화"}
              </button>
            </div>
          )}
          {pending && (
            <div className="rounded-lg border border-accent/40 p-3 text-sm">
              <p className="font-semibold">{pending.encrypted ? "복호화한 백업" : "불러온 파일"} 내용 ({pending.bundle.exportedAt ? new Date(pending.bundle.exportedAt).toLocaleString("ko-KR") : "시각 미상"} 내보냄)</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {pending.summary.length ? pending.summary.map((s) => <li key={s}>{s}</li>) : <li>저장된 항목이 없는 파일입니다.</li>}
              </ul>
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn btn-primary btn-sm" onClick={applyRestore}>
                  현재 데이터를 지우고 복원
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setPending(null)}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">4) 모든 개인 데이터 초기화</p>
          <button type="button" className="btn btn-danger self-start" onClick={reset}>
            전체 초기화
          </button>
        </div>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-good" : "text-critical"}`} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        )}
      </section>

      <section id="privacy" className="card flex scroll-mt-20 flex-col gap-3 p-5">
        <h2 className="font-semibold">개인정보 처리 안내</h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed text-ink-2">
          <li>회원가입, 이름·이메일·전화번호·계좌번호 입력, 증권사 로그인이나 계좌 연결을 요구하지 않습니다.</li>
          <li>입력한 보유 자산·거래 내역·현금·메모·전략·설정은 이 브라우저 저장소(IndexedDB 등)에만 저장되고, 이 사이트의 서버로 보내지 않습니다.</li>
          <li>개인 포트폴리오 데이터를 외부 분석 서비스나 AI API 로 보내지 않습니다. 백테스트·시뮬레이션·스트레스 테스트 계산은 브라우저 안에서 합니다.</li>
          <li>방문 분석 도구(추적 쿠키·광고 스크립트)를 쓰지 않습니다.</li>
          <li>
            <b>그래도 접속 기록은 생길 수 있습니다.</b> 사이트를 호스팅하는 서비스(예: GitHub Pages)는 일반적인 웹 서버처럼 접속 IP·시각·요청 주소 같은 기록을 남길 수 있고, 뉴스 썸네일 이미지는 해당 언론사·이미지 서버에서 직접 불러오므로 그쪽에도 접속 기록이 남을 수 있습니다. 계정이 없다고 해서 완전한 익명 서비스는 아닙니다.
          </li>
          <li>시장 데이터(시세·분배금·뉴스)는 사이트 운영 측이 데이터 제공처에서 미리 수집해 둔 것을 읽어 오며, 이 과정에 개인 데이터는 포함되지 않습니다.</li>
          <li>브라우저 데이터를 지우면 저장된 기록이 사라질 수 있습니다. 왼쪽 &apos;데이터 관리&apos;에서 백업하세요.</li>
        </ul>
      </section>
    </div>
  );
}
