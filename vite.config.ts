import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const base = env.VITE_APP_BASE ?? "/";
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
    throw new Error("VITE_APP_BASE tarvitsee muodon / tai /ravintopolku/.");
  const apiPrefix = base + "api";
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        scope: base,
        includeAssets: ["icon-192.png", "icon-512.png"],
        manifest: {
          name: "Ravintopolku",
          short_name: "Ravintopolku",
          description: "Oma ruokailun ja hyvinvoinnin päiväkirja",
          lang: "fi",
          start_url: base,
          scope: base,
          display: "standalone",
          background_color: "#f5f7f2",
          theme_color: "#315b43",
          icons: [
            {
              src: base + "icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: base + "icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: base + "icon-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          navigateFallbackDenylist: [new RegExp("^" + apiPrefix + "/")],
        },
      }),
    ],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      proxy: {
        [apiPrefix]: { target: "http://127.0.0.1:3001", changeOrigin: true },
      },
    },
    preview: { host: "0.0.0.0", port: 4173, strictPort: true },
  };
});
