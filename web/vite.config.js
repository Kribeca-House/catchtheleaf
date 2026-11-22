import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :8080 (server/), Vite proxies to it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8080', '/media': 'http://localhost:8080' } },
});
