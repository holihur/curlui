import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The PDF preview (pdf.js) is only shipped in the full build. Building the
// core frontend with CURLUI_PDF=0 makes __PDF_PREVIEW__ a literal false, which
// lets Rollup drop the pdf.js chunk entirely.
const pdfPreview = process.env.CURLUI_PDF !== "0";

export default defineConfig({
  define: {
    __PDF_PREVIEW__: JSON.stringify(pdfPreview),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: process.env.CURLUI_DIST || "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // One vendor chunk keeps React/Radix init order correct while still
        // separating dependencies from app code (better caching). Heavy libs
        // that only serve lazy dialogs stay out of the first-paint bundle.
        manualChunks(id) {
          if (/node_modules\/(pdfjs-dist|marked)/.test(id)) return undefined;
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
});
