import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.browser.test.{js,jsx,ts,tsx}"],
    setupFiles: "./test/setup.ts",
    browser: {
      enabled: true,
      ui: false,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
