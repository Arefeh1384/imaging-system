import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // With `npm run dev`, calls to /api go to the backend on port 8000 (hybrid or http mode).
  server: { proxy: { '/api': 'http://localhost:8000' } },
});
