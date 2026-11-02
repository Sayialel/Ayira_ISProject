import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite loads .env from its own root (apps/web) by default. This monorepo
// keeps a single .env at the top level, so point Vite there — otherwise no
// VITE_* variable is defined and the Supabase client throws on import.
const envDir = path.resolve(__dirname, '../..');

export default defineConfig(({ command, mode }) => {
  // A production build with no VITE_API_URL is a silent outage, so it is
  // made a loud one.
  //
  // lib/api.ts falls back to the relative '/api' when the variable is unset,
  // which is correct in development: the dev server proxies it to port 3001.
  // Shipped, it points the site at itself, and Cloudflare Pages answers
  // /api/anything with index.html and a 200. So every request succeeds and
  // returns HTML where the caller expected JSON, the whole application reads
  // as "cannot fetch data", and no server log shows anything wrong — the
  // gateway never sees the request at all.
  //
  // This happened. The bundle is built here and uploaded by hand, because the
  // Pages project is direct-upload rather than Git-connected, so the variable
  // has to be present in whichever shell runs the build and nothing was
  // checking that it was.
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, envDir, 'VITE_');
    if (!env.VITE_API_URL) {
      throw new Error(
        [
          'VITE_API_URL is not set, so this build would call its own origin',
          'for /api and receive index.html instead of JSON.',
          '',
          'Run "npm run pages" from deploy/, which sets it, or pass it:',
          '  VITE_API_URL=https://ayira-api-t8wf.onrender.com',
          '  npm run build --workspace=apps/web',
        ].join('\n')
      );
    }
  }

  return {
    plugins: [react()],
    envDir,
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
    build: {
      rollupOptions: {
        output: {
          // Vendor code changes far less often than ours, so splitting it lets
          // a returning visitor re-download only what actually changed.
          // Supabase is separated again because it is large and only the auth
          // flow needs it on first paint.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
  };
});
