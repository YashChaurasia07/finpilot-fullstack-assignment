import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The browser only ever talks to ONE origin (this server). /api is forwarded to the backend, so the session
// cookie is first-party and no CORS setup is needed. In Docker, nginx does the same job.
const api = { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:8000' } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000, strictPort: true, proxy: api },
  preview: { port: 3000, strictPort: true, proxy: api },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
