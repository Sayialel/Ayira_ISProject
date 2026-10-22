// vite.config.ts
import { defineConfig } from "file:///C:/Users/lenin/Documents/IS%20Project%20Files/ayira/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/lenin/Documents/IS%20Project%20Files/ayira/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "C:\\Users\\lenin\\Documents\\IS Project Files\\ayira\\apps\\web";
var vite_config_default = defineConfig({
  plugins: [react()],
  // Vite loads .env from its own root (apps/web) by default. This monorepo
  // keeps a single .env at the top level, so point Vite there — otherwise no
  // VITE_* variable is defined and the Supabase client throws on import.
  envDir: path.resolve(__vite_injected_original_dirname, "../.."),
  resolve: {
    alias: { "@": path.resolve(__vite_injected_original_dirname, "./src") }
  },
  server: { port: 5173, proxy: { "/api": "http://localhost:3001" } },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes far less often than ours, so splitting it lets a
        // returning visitor re-download only what actually changed. Supabase
        // is separated again because it is large and only the auth flow needs
        // it on first paint.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"]
        }
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxsZW5pblxcXFxEb2N1bWVudHNcXFxcSVMgUHJvamVjdCBGaWxlc1xcXFxheWlyYVxcXFxhcHBzXFxcXHdlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcbGVuaW5cXFxcRG9jdW1lbnRzXFxcXElTIFByb2plY3QgRmlsZXNcXFxcYXlpcmFcXFxcYXBwc1xcXFx3ZWJcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL2xlbmluL0RvY3VtZW50cy9JUyUyMFByb2plY3QlMjBGaWxlcy9heWlyYS9hcHBzL3dlYi92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0JztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIC8vIFZpdGUgbG9hZHMgLmVudiBmcm9tIGl0cyBvd24gcm9vdCAoYXBwcy93ZWIpIGJ5IGRlZmF1bHQuIFRoaXMgbW9ub3JlcG9cbiAgLy8ga2VlcHMgYSBzaW5nbGUgLmVudiBhdCB0aGUgdG9wIGxldmVsLCBzbyBwb2ludCBWaXRlIHRoZXJlIFx1MjAxNCBvdGhlcndpc2Ugbm9cbiAgLy8gVklURV8qIHZhcmlhYmxlIGlzIGRlZmluZWQgYW5kIHRoZSBTdXBhYmFzZSBjbGllbnQgdGhyb3dzIG9uIGltcG9ydC5cbiAgZW52RGlyOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4nKSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7ICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJykgfSxcbiAgfSxcbiAgc2VydmVyOiB7IHBvcnQ6IDUxNzMsIHByb3h5OiB7ICcvYXBpJzogJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMScgfSB9LFxuICBidWlsZDoge1xuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICAvLyBWZW5kb3IgY29kZSBjaGFuZ2VzIGZhciBsZXNzIG9mdGVuIHRoYW4gb3Vycywgc28gc3BsaXR0aW5nIGl0IGxldHMgYVxuICAgICAgICAvLyByZXR1cm5pbmcgdmlzaXRvciByZS1kb3dubG9hZCBvbmx5IHdoYXQgYWN0dWFsbHkgY2hhbmdlZC4gU3VwYWJhc2VcbiAgICAgICAgLy8gaXMgc2VwYXJhdGVkIGFnYWluIGJlY2F1c2UgaXQgaXMgbGFyZ2UgYW5kIG9ubHkgdGhlIGF1dGggZmxvdyBuZWVkc1xuICAgICAgICAvLyBpdCBvbiBmaXJzdCBwYWludC5cbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgcmVhY3Q6IFsncmVhY3QnLCAncmVhY3QtZG9tJywgJ3JlYWN0LXJvdXRlci1kb20nXSxcbiAgICAgICAgICBzdXBhYmFzZTogWydAc3VwYWJhc2Uvc3VwYWJhc2UtanMnXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUE4VyxTQUFTLG9CQUFvQjtBQUMzWSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBSXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUlqQixRQUFRLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsRUFDdkMsU0FBUztBQUFBLElBQ1AsT0FBTyxFQUFFLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU8sRUFBRTtBQUFBLEVBQ2pEO0FBQUEsRUFDQSxRQUFRLEVBQUUsTUFBTSxNQUFNLE9BQU8sRUFBRSxRQUFRLHdCQUF3QixFQUFFO0FBQUEsRUFDakUsT0FBTztBQUFBLElBQ0wsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsUUFLTixjQUFjO0FBQUEsVUFDWixPQUFPLENBQUMsU0FBUyxhQUFhLGtCQUFrQjtBQUFBLFVBQ2hELFVBQVUsQ0FBQyx1QkFBdUI7QUFBQSxRQUNwQztBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
