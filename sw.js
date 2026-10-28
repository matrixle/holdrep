/* Service Worker：离线缓存。发布前运行 ./bump.sh 递增版本（读取 js/version.js）。 */
importScripts('js/version.js');
const VERSION = 'holdrep-' + HR_BUILD.version;
// 模型等 vendor 大文件（约 22MB）放在独立缓存，不随版本号清空：更新 App 不必重新下载模型。
// 更换 vendor 文件时改这个名字即可。
const VENDOR = 'hrvendor-mediapipe-1';
// 核心资源：安装时一次性缓存
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'js/version.js', 'js/config.js', 'js/detectors.js', 'js/report.js', 'js/db.js', 'js/models.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
// BlazePose 模型不在安装时下载，避免与首次加载抢带宽；首次进入训练页时由下面的 fetch 逻辑自动缓存，之后离线可用。

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== VENDOR).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isVendor = req.url.includes('/vendor/');
  e.respondWith(
    caches.open(isVendor ? VENDOR : VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      // vendor 大文件：缓存优先；其余：先用缓存、后台更新
      const net = () => fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; });
      if (hit) { if (!isVendor) net().catch(() => {}); return hit; }
      try { return await net(); }
      catch (err) {
        if (req.mode === 'navigate') return cache.match('index.html');
        throw err;
      }
    })
  );
});
