import { defineConfig } from "vite";

export default defineConfig({
  test: {
    include: ["server/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    globals: true,
    environment: "node",
  },
});
