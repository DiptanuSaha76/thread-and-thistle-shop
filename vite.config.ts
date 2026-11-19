import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [tanstackStart(), react(), tailwindcss()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 3000,
    allowedHosts: [
      "accept-steve-wave-edt.trycloudflare.com",
      "trademarks-driver-independently-retail.trycloudflare.com",
    ],
  },
  
});
