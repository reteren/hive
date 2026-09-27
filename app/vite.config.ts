import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The port is fixed because it is also the devUrl in tauri.conf.json.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    watch: {
      // src-tauri rebuilds Cargo; Vite must not watch it.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome105", // WebView2 on supported Windows 10 versions
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "index.html",
        quickInput: "quick-input.html",
      },
    },
  },
});
