import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/**/*.test.jsx"] },
});
