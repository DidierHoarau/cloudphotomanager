// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  experimental: {
    viteEnvironmentApi: true,
  },
  app: {
    head: {
      charset: "utf-16",
      viewport:
        "width=device-width, initial-scale=1.0, height=device-height, maximum-scale=1.0, user-scalable=no",
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
  pwa: {
    registerType: "autoUpdate",
    // We manage our own manifest.json in /public
    manifest: false,
    workbox: {
      navigateFallback: undefined,
      // Do not glob any pre-cached assets; Nuxt SPA handles its own bundles.
      globPatterns: [],
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
            cacheName: "api-folders",
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
            cacheName: "api-folder-counts",
            networkTimeoutSeconds: 5,
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 24 * 60 * 60, // 1 day
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        // Thumbnails (webp) – Cache First with LRU; huge UX win for scrolling
        {
          urlPattern: ({ url }) =>
            /\/static\/.*\/thumbnail\.webp$/.test(url.pathname),
          handler: "CacheFirst",
          options: {
            cacheName: "thumbnails",
            expiration: {
              maxEntries: 2000,
              maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        // Preview images (webp) – Cache First with tight LRU
        {
          urlPattern: ({ url }) =>
            /\/static\/.*\/preview\.webp$/.test(url.pathname),
          handler: "CacheFirst",
          options: {
            cacheName: "preview-images",
            expiration: {
              maxEntries: 200,
              maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
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
