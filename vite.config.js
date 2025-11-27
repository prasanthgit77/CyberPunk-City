import { defineConfig } from "vite";

export default defineConfig({
  base: "/",         // important so assets load properly on Vercel
  build: {
    outDir: "dist",
  },
});
