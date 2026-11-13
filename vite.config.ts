import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client', emptyOutDir: true, rollupOptions: { input: { main: 'index.html', vote: 'vote.html' } } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/v1': 'http://localhost:8790',
      '/auth': 'http://localhost:8790',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
