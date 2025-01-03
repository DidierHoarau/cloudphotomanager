// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  app: {
    head: {
      charset: "utf-16",
      viewport:
        "width=device-width, initial-scale=1, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      title: "CloudPhotoManager",
      meta: [
        { name: "description", content: "CloudPhotoManager" },
        { name: "theme-color", content: "#212121" },
      ],
      link: [
        { rel: "manifest", href: "/manifest.json" },
        { rel: "icon", href: "/icon.png" },
        { rel: "stylesheet", href: "/styles.css" },
        { rel: "stylesheet", href: "https://unpkg.com/@picocss/pico@latest/css/pico.min.css" },
        { rel: "stylesheet", href: "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" },
      ],
    },
  },
  css: ["~/assets/css/main.css"],
  modules: ["@pinia/nuxt"],
  imports: {
    dirs: ["./stores"],
  },
  pinia: {
    autoImports: ["defineStore", "acceptHMRUpdate"],
  },
});
