import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'

// Precache all Vite-built assets
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA navigation — always serve index.html
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Cache Google Fonts locally so they work offline
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({ cacheName: 'google-fonts-cache' })
)
registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({ cacheName: 'gstatic-fonts-cache' })
)

// Let the React app trigger the update when the user approves
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// Notify users who have the app closed that an update is waiting
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      if (!self.registration.active) return
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (clients.length === 0 && Notification.permission === 'granted') {
        self.registration.showNotification('Leavs update ready', {
          body: 'A new version is available — open the app to apply it.',
          icon: '/icon-192.png',
        })
      }
    })()
  )
})
