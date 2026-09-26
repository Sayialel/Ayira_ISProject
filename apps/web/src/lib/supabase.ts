import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// createClient throws on missing credentials, and because this module is
// imported before anything renders, that surfaces as a blank white page with
// only a console message. Fail with an explanation the developer can act on.
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
  ]
    .filter(Boolean)
    .join(' and ');

  const message =
    `Ayira cannot start: ${missing} is not set.\n\n` +
    'Add it to the .env file at the repository root, then restart the dev ' +
    'server — Vite only reads environment variables at startup.';

  // Painted directly, because React never gets to mount.
  document.body.innerHTML = `
    <div style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 15vh auto; padding: 0 1.5rem; line-height: 1.6;">
      <h1 style="font-size: 1.25rem; margin: 0 0 .75rem;">Configuration missing</h1>
      <p style="white-space: pre-wrap; color: #334155; margin: 0;">${message}</p>
    </div>`;

  throw new Error(message);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
