/* Service Worker Ghostinator.
   - Network-first sur le document HTML (sinon les utilisateurs restent coincés
     sur d'anciennes versions du bundle après un déploiement).
   - Cache-first sur les assets versionnés (hash dans le nom, immutables).
   - Bypass total pour /api : toujours réseau, jamais caché. */

const CACHE_NAME = "ghostinator-pwa-v3";
const APP_SHELL = ["/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api") || request.method !== "GET") {
    return; // jamais de cache pour les requêtes API ou non-GET
  }

  // Network-first pour le document HTML : on évite que l'utilisateur reste
  // coincé sur une ancienne version du bundle après un déploiement.
  const isDocument =
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname === "/" ||
    url.pathname.endsWith(".html");

  if (isDocument) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  // Cache-first pour les assets versionnés (hash dans le nom -> immutables).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("/"));
    }),
  );
});
