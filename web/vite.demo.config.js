import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Preview build: everything runs in the browser with sample data (src/demo/mockApi.js),
// images inlined, one JS chunk, so scripts/inline-demo.mjs can make a single HTML file.
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  build: {
    outDir: 'dist-demo',
    assetsInlineLimit: 10_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
