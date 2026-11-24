import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Exact origin for the future backend CORS allow-list. localStorage is per-origin,
  // so ALWAYS open http://127.0.0.1:5173 (NOT localhost).
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false },
});
