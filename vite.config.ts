import { defineConfig } from 'vite';

export default defineConfig({
  // maplibre-gl сам по собі ~1 МБ (≈300 КБ gzip) — це очікувано.
  build: { chunkSizeWarningLimit: 1500 },
});
