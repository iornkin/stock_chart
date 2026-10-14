/*
 * US Stock Insight 서비스 워커 — 홈 화면 설치용 최소 구성.
 * 시세·데이터·화면은 저장하지 않는다 (오래된 데이터를 현재처럼 보여 주지 않기 위해).
 * 인터넷이 끊겼을 때 화면 이동 요청에만 '연결 안 됨' 안내 페이지를 보여 준다.
 */
const CACHE = "usi-offline-v1";
const OFFLINE = new URL("offline.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(OFFLINE, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // 화면 이동(문서 요청)만 다룬다. 데이터·스크립트 요청은 브라우저가 평소대로 처리.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
});

// 알림(이 사이트가 열려 있을 때 띄운 브라우저 알림)을 누르면 알림 화면으로
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const c = list.find((w) => "focus" in w);
      return c ? c.focus() : self.clients.openWindow(url);
    }),
  );
});
