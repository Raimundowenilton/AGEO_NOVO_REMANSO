const CACHE = "terminal-nr-v1";
const ARQUIVOS = ["./", "./index.html", "./style.css", "./app.js", "./config.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c)))
    )
  );
});

self.addEventListener("fetch", (e) => {
  // não intercepta chamadas à API do Supabase - sempre rede
  if (e.request.url.includes("supabase.co")) return;
  e.respondWith(
    caches.match(e.request).then((resp) => resp || fetch(e.request))
  );
});
