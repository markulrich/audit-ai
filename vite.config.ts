import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    globals: true,
    environment: "jsdom",
    setupFiles: "./test/setup.ts",
    css: true,
    exclude: ["src/**/*.browser.test.{js,jsx,ts,tsx}"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
