/* SALIN-LAHI — Service Worker
   Strategy:
   - Static shell (HTML/CSS/JS/images/audio) → Cache-first, update in background
   - data.json → Network-first with cache fallback
   - Firebase/external → Network-only (pass-through)
   - Navigation → Always serve index.html from cache (SPA fallback)
*/

var CACHE = "salin-lahi-v1";

var SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/firebase.js",
  "/data.json",
  "/manifest.json",
  "/assets/icons/icon.svg",
  "/assets/icons/icon-maskable.svg",
  "/assets/bg.MP3",
  "/assets/qr-code.png",
  /* Homepage images */
  "/assets/homepage/3-krus.jpg",
  "/assets/homepage/aeta1.JPG",
  "/assets/homepage/aeta2.JPG",
  "/assets/homepage/aeta3.jpg",
  "/assets/homepage/barretto.jpg",
  "/assets/homepage/kalaklan-lighthouse.jpg",
  "/assets/homepage/kalapati.jpg",
  "/assets/homepage/marikit.jpg",
  "/assets/homepage/triangle.jpg",
  "/assets/homepage/ulo-ng-apo.jpg",
  /* Station images & audio */
  "/assets/stations/station-a/station-a1.jpg",
  "/assets/stations/station-a/station-a2.jpg",
  "/assets/stations/station-a/station-a3.jpg",
  "/assets/stations/station-a/station-a.mp3",
  "/assets/stations/station-b/station-b1.jpg",
  "/assets/stations/station-b/station-b2.jpg",
  "/assets/stations/station-b/station-b3.jpg",
  "/assets/stations/station-b/station-b.mp3",
  "/assets/stations/station-c/station-c1.jpg",
  "/assets/stations/station-c/station-c2.jpg",
  "/assets/stations/station-c/station-c3.jpg",
  "/assets/stations/station-c/station-c.mp3",
  "/assets/stations/station-d/station-d1.jpg",
  "/assets/stations/station-d/station-d2.jpg",
  "/assets/stations/station-d/station-d3.jpg",
  "/assets/stations/station-d/station-d.mp3",
  "/assets/stations/station-e/station-e1.jpg",
  "/assets/stations/station-e/station-e2.jpg",
  "/assets/stations/station-e/station-e3.jpg",
  "/assets/stations/station-e/station-e.mp3",
  "/assets/stations/station-f/station-f1.jpg",
  "/assets/stations/station-f/station-f2.jpg",
  "/assets/stations/station-f/station-f3.jpg",
  "/assets/stations/station-f/station-f.mp3",
  "/assets/stations/station-g/station-g1.jpg",
  "/assets/stations/station-g/station-g2.jpg",
  "/assets/stations/station-g/station-g3.webp",
  "/assets/stations/station-g/station-g.mp3",
  "/assets/stations/station-h/station-h1.jpg",
  "/assets/stations/station-h/station-h2.jpg",
  "/assets/stations/station-h/station-h3.jpg",
  "/assets/stations/station-h/station-h.mp3",
  /* Timeline images */
  "/assets/timeline/timeline-1.png",
  "/assets/timeline/timeline-2.jpg",
  "/assets/timeline/timeline-3.jpg",
  "/assets/timeline/timeline-4.jpg",
  "/assets/timeline/timeline-5.jpg",
  "/assets/timeline/timeline-6.jpg",
  "/assets/timeline/timeline-7.png"
];

/* ── Install: pre-cache the shell ── */
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* Add individually so one bad URL doesn't block the whole install */
      return Promise.allSettled(
        SHELL.map(function (url) { return cache.add(url).catch(function () {}); })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ── Activate: remove old caches ── */
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k)   { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ── Fetch ── */
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);

  /* Pass through non-GET, cross-origin (Firebase, fonts, CDN), and chrome-extension */
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  /* data.json → Network-first (leaderboard & content must stay fresh) */
  if (url.pathname === "/data.json") {
    e.respondWith(networkFirst(e.request));
    return;
  }

  /* Navigation → SPA fallback: serve index.html from cache */
  if (e.request.mode === "navigate") {
    e.respondWith(
      caches.match("/index.html").then(function (cached) {
        return cached || fetch(e.request);
      })
    );
    return;
  }

  /* Everything else → Cache-first, update in background (stale-while-revalidate) */
  e.respondWith(staleWhileRevalidate(e.request));
});

/* ── Strategies ── */

function networkFirst(request) {
  return fetch(request).then(function (response) {
    if (response && response.status === 200) {
      var clone = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(request, clone); });
    }
    return response;
  }).catch(function () {
    return caches.match(request);
  });
}

function staleWhileRevalidate(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () { return cached; });

      return cached || network;
    });
  });
}
