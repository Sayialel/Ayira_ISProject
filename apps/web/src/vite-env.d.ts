/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Gateway origin in production; unset in dev, where Vite proxies /api. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * mammoth ships types for its Node entry point but not for the browser
 * bundle, which is the one this app loads — the Node build pulls in fs and
 * will not bundle. Only extractRawText is used.
 */
declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string; messages: unknown[] }>;
}

/** pdf.js ships its worker as an asset; Vite resolves `?url` to its path. */
declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const src: string;
  export default src;
}
