/* Ask Tr. David service worker
   - Required by Chrome/Edge/Samsung Internet before they allow a real install.
   - Keeps a copy of the app so it opens with no signal, and always loads the newest version when online.
   - Shows phone alerts for announcements and updates ({ id, title, body } payload), also when the app is closed.
   - Never touches Supabase or any other site. */

const CACHE_PREFIX = "ask-tr-david-";
const CACHE = CACHE_PREFIX + "v6";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        // Only touch our own caches; other sites on the same host share Cache Storage.
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Database calls, other CDNs, fonts, etc. go straight to the network, never cached here.
  if (url.origin !== self.location.origin) return;

  // Opening the app: network first (always the latest version), cached copy if offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Icons, manifest and other same-site files: cached copy first, refreshed in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Phone alert for an announcement or update (sent by the ann_push function).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Ask Tr. David", body: event.data ? event.data.text() : "" };
  }
  const id = data.id != null ? String(data.id) : String(Date.now());
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || "Ask Tr. David", {
      body: String(data.body || "").slice(0, 180),
      tag: "ann-" + id,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      timestamp: Date.now(),
      data: { id: data.id != null ? data.id : null }
    });
    // If the app is open, let it refresh What's new right away.
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    list.forEach((c) => { try { c.postMessage({ annSync: 1 }); } catch (e) {} });
  })());
});

// Tapping the alert opens the app on What's new.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      try { await c.focus(); c.postMessage({ openWN: 1 }); return; } catch (e) {}
    }
    await self.clients.openWindow(new URL("./#wn", self.registration.scope).href);
  })());
});

// The phone's push address changed or expired: ask the app to subscribe again and save the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      list.forEach((c) => { try { c.postMessage({ resub: 1 }); } catch (e) {} });
    })
  );
});
