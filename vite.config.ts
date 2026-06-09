import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard is served under /app by the Fastify server in production.
// In dev, Vite serves it at http://localhost:5173/app and proxies API calls
// to the Fastify server on :8787 so cookies stay same-origin.
export default defineConfig({
  root: 'src/web',
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/webhooks': 'http://localhost:8787',
      '/media': 'http://localhost:8787',
      '/healthz': 'http://localhost:8787',
    },
  },
});
