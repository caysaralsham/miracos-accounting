// Service worker مبسّط — الغرض الأساسي منه إنه يفعّل خاصية "تثبيت التطبيق" على سطح المكتب.
// ما بيعمل تخزين مؤقت (cache) للبيانات المالية، وكل طلب بيروح للشبكة مباشرة كالمعتاد.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
