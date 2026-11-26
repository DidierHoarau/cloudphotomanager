import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    // The existing specs are node-only; the update-prompt spec opts into jsdom
    // with its per-file environment docblock.
    server: {
      deps: {
        inline: ["@devopsplaybook.io/common-web"],
      },
    },
  },
});
