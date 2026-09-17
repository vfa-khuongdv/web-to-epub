import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Builds directly into ../public, which the Express backend already serves
// statically — no change needed on the server side. In dev mode, requests
// to /api are proxied to the backend running on :3100.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
});
