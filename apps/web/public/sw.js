/* Service worker del sitio: guarda lo mínimo para que la entrada de QR dinámico abra SIN internet.
 *
 * - /entrada/*  → red primero; si no hay internet, la última copia guardada (la página solo describe la entrada;
 *   la llave y el QR los maneja el celular, no se guardan aquí).
 * - /_next/static/* → archivos de la aplicación, de caché primero (cambian de nombre en cada versión).
 * Nada más se intercepta: la API, el login y las compras siempre van a la red.
 */
const CACHE = "impacta-entradas-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Solo se guarda una respuesta buena y de esta misma página (no una redirección al login).
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/entrada/")) event.respondWith(networkFirst(request));
  else if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
});

// Al cerrar sesión la página pide borrar todo lo guardado.
self.addEventListener("message", (event) => {
  if (event.data === "purge") event.waitUntil(caches.delete(CACHE));
});
