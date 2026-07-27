import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative paths so the built bundle also loads from file:// inside Electron.
  base: './',
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    watch: {
      // Packaging writes thousands of files into release/, which used to drown
      // the dev server in reload events.
      ignored: ['**/release/**', '**/dist/**', '**/build/**'],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
