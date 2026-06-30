const CACHE = "terminal-nr-v2";
const ARQUIVOS = ["./", "./index.html", "./style.css", "./app.js", "./config.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // não intercepta chamadas à API do Supabase - sempre rede
  if (e.request.url.includes("supabase.co")) return;
  // HTML/JS/CSS sempre busca da rede primeiro, cai pro cache só se offline
  // (evita servir versão antiga depois de uma atualização do site)
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
