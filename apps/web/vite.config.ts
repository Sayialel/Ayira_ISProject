import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Vite loads .env from its own root (apps/web) by default. This monorepo
  // keeps a single .env at the top level, so point Vite there — otherwise no
  // VITE_* variable is defined and the Supabase client throws on import.
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
});
