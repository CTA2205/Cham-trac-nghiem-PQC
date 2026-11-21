/**
 * Service Worker - Chấm Thi Trắc Nghiệm 2025+ GDPT (PWA Offline-First)
 * Tự động lưu cache toàn bộ ứng dụng để giáo viên mang máy vào phòng thi không có mạng vẫn chạy 100%.
 */

const CACHE_NAME = 'cham-thi-2025-pwa-v8';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './css/style.css',
  './js/omr-engine.js',
  './js/excel-handler.js',
  './js/export-zip.js',
  './js/app-pwa.js',
  './lib/xlsx.full.min.js',
  './lib/jszip.min.js',
  './MAU%20DAP%20AN.xlsx'
];

// Cài đặt Service Worker và nạp toàn bộ tài nguyên vào Cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Đang lưu trữ tài nguyên Offline...');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Kích hoạt và dọn dẹp các phiên bản cache cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Xóa bộ nhớ cache cũ:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Phản hồi yêu cầu mạng: Ưu tiên lấy từ Cache trước để chạy siêu nhanh & Offline
self.addEventListener('fetch', (event) => {
  // Chỉ xử lý các yêu cầu GET trong phạm vi
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Trả về ngay từ Cache
        return cachedResponse;
      }
      // Nếu chưa có trong Cache thì tải từ mạng và lưu bổ sung vào Cache
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Khi không có mạng và không có trong cache, trả về trang chính
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
