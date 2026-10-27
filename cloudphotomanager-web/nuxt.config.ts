// https://nuxt.com/docs/api/configuration/nuxt-config
// The runtime data-cache names below are shared with services/ClientDataCleanup.ts
// (logout / user-switch cleanup); the module is dependency-free so the jiti
// config loader can import it safely.
import { SW_DATA_CACHE_NAMES } from "./services/ClientDataCleanup";

export default defineNuxtConfig({
  ssr: false,
  experimental: {
    viteEnvironmentApi: true,
  },
  app: {
    head: {
      charset: "utf-8",
      // Page pinch-zoom must stay available (WCAG 1.4.4); the photo viewer
      // handles its own pinch via hammer.js.
      viewport:
        "width=device-width, initial-scale=1.0, height=device-height, viewport-fit=cover",
      title: "CloudPhotoManager",
      meta: [
        { name: "description", content: "Manage your cloud photo albums" },
        { name: "theme-color", content: "#1e2a32" },
        // iOS PWA support
        { name: "apple-mobile-web-app-capable", content: "yes" },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "black-translucent",
        },
        { name: "apple-mobile-web-app-title", content: "CloudPhotoManager" },
      ],
      link: [
        { rel: "manifest", href: "/manifest.json" },
        { rel: "icon", href: "/icon.png" },
        { rel: "apple-touch-icon", href: "/images/icon-192.png" },
      ],
    },
  },
  css: ["~/assets/css/main.css", "~/assets/css/duplicate-badge.css"],
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt"],
  imports: {
    dirs: ["./stores"],
  },
  pinia: {
    autoImports: ["defineStore", "acceptHMRUpdate"],
  },
  // The service worker must never be cached by browsers or the CDN: a stale
  // sw.js keeps serving the previous app shell (and its old bundles), so PWA
  // clients never receive new releases until the cache entry expires.
  routeRules: {
    "/sw.js": {
      headers: {
        "cache-control": "no-cache, no-store, must-revalidate",
        "CDN-Cache-Control": "no-store",
      },
    },
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            // Isolate heavy vendor libs into their own lazy chunks
            if (id.includes("node_modules/hammerjs")) return "vendor-hammer";
            if (id.includes("node_modules/lodash")) return "vendor-lodash";
            if (id.includes("node_modules/axios")) return "vendor-axios";
            if (id.includes("node_modules/@picocss")) return "vendor-picocss";
            if (id.includes("node_modules/bootstrap-icons"))
              return "vendor-bootstrap-icons";
          },
        },
      },
    },
  },
  pwa: {
    registerType: "autoUpdate",
    // We manage our own manifest.json in /public
    manifest: false,
    workbox: {
      // Serve index.html for direct PWA navigation to /gallery, /settings, etc.
      navigateFallback: "/index.html",
      // Precache app shell bundles so repeat PWA launches are instant
      globPatterns: ["**/*.{js,css,html,woff2,woff,webp,png}"],
      maximumFileSizeToCacheInBytes: 500 * 1024, // 500 KB
      runtimeCaching: [
        // Static assets (JS, CSS, fonts from same origin) – Cache First
        {
          urlPattern: /\.(?:js|css|woff2?)$/,
          handler: "CacheFirst",
          options: {
            cacheName: "static-assets",
            expiration: {
              maxEntries: 80,
              maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        // Folder list API – Network First, fall back to cache
        {
          urlPattern: ({ url }) =>
            /\/api\/accounts\/[^/]+\/folders$/.test(url.pathname),
          handler: "NetworkFirst",
          options: {
            cacheName: SW_DATA_CACHE_NAMES.folders,
            networkTimeoutSeconds: 5,
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 24 * 60 * 60, // 1 day
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        // Folder counts API – Network First, fall back to cache
        {
          urlPattern: ({ url }) =>
            /\/api\/accounts\/[^/]+\/folders\/counts$/.test(url.pathname),
          handler: "NetworkFirst",
          options: {
            cacheName: SW_DATA_CACHE_NAMES.folderCounts,
            networkTimeoutSeconds: 5,
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 24 * 60 * 60, // 1 day
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        // Thumbnails (webp) – Cache First with LRU; short lifetime because
        // media URLs are signed and revocation is enforced server-side.
        {
          urlPattern: ({ url }) =>
            /\/api\/media\/.*\/thumbnail\.webp$/.test(url.pathname),
          handler: "CacheFirst",
          options: {
            cacheName: SW_DATA_CACHE_NAMES.thumbnails,
            expiration: {
              maxEntries: 2000,
              maxAgeSeconds: 300,
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        // Preview images (webp) – Cache First with tight LRU
        {
          urlPattern: ({ url }) =>
            /\/api\/media\/.*\/preview\.webp$/.test(url.pathname),
          handler: "CacheFirst",
          options: {
            cacheName: SW_DATA_CACHE_NAMES.previews,
            expiration: {
              maxEntries: 200,
              maxAgeSeconds: 300,
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
    // Client-side prompt when a new SW is available
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: false,
    },
  },
});
