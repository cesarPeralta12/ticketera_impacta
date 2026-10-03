/*
 * Service worker de la app de puerta. Solo guarda lo necesario para que /puerta abra sin
 * internet (las páginas ya visitadas y los archivos estáticos). Las entradas no pasan por
 * aquí: la app las guarda en IndexedDB y las lecturas se suben cuando vuelve la conexión.
 * El resto del panel no se toca (sin respondWith, va directo a la red).
 */
const CACHE = "impacta-puerta-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Archivos con hash en el nombre: nunca cambian, primero la caché.
  if (url.pathname.startsWith("/_next/static/") || /^\/icon[\w-]*\.(png|svg)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Páginas de la app de puerta: primero la red (datos al día); sin red, la última copia.
  const isDoorPage = url.pathname === "/puerta" || url.pathname.startsWith("/puerta/");
  if (isDoorPage && request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/puerta")) || Response.error()),
    );
  }
});
