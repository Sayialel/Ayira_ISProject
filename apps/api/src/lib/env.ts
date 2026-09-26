import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

/**
 * Loads environment variables before any other module reads process.env.
 *
 * This module must be imported first in src/index.ts: lib/supabase.ts reads its
 * keys at module scope, and CommonJS resolves every import before the first
 * statement in the entry file runs. Calling dotenv.config() there would be too
 * late and the Supabase clients would be constructed with undefined keys.
 */

// Running via `npm run dev --workspace=apps/api` puts cwd at apps/api, so the
// monorepo .env is two levels up. Deployed builds get real environment
// variables instead and simply find no file here.
const candidates = [
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../../.env'),
];

for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

const missing = REQUIRED_VARS.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(
    `\nMissing required environment variable(s): ${missing.join(', ')}\n` +
      'Copy .env.example to .env at the repository root and fill in your Supabase credentials.\n'
  );
  process.exit(1);
}

export const env = {
  supabaseUrl: process.env.SUPABASE_URL as string,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY as string,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  apiPort: Number(process.env.API_PORT || 3001),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  aiEngineUrl: process.env.AI_ENGINE_URL || 'http://localhost:8001',
  // Shared secret presented to the AI engine on every call. Not in
  // REQUIRED_VARS because the gateway is useful without matching; the match
  // route reports a clear error when it is missing.
  aiEngineSecret: process.env.AI_ENGINE_SECRET || '',
  nodeEnv: process.env.NODE_ENV || 'development',
};
