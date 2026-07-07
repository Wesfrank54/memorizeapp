import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    // Installable, offline-capable PWA. Precaches the app shell so it runs with
    // no network after the first visit; autoUpdate ships a new version whenever
    // the site is re-published. Kept host-agnostic (deploy at a domain root).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32x32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Memorize',
        short_name: 'Memorize',
        description: 'Spaced-repetition study — memorize anything, offline.',
        theme_color: '#3b6cf6',
        background_color: '#f6f7f9',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  // Support for PowerSync path dynamic imports (schema lives in root/db/ outside src/
  // to keep it excluded from tsconfig "include"/typecheck, per original design).
  // Alias provides clean non-fragile import + explicit resolve config for build.
  // Also fixes .js-on-.ts and outside-src resolution issues during `vite build`.
  resolve: {
    alias: {
      // @db maps to the excluded db/ (used only in powersync dynamic import path)
      '@db': resolve(__dirname, 'db'),
    },
    // Ensure TS extensions are considered for dynamic imports of .ts sources
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
  },
  server: {
    // Preview tooling assigns a port via PORT; the desktop launcher stays on 5173.
    port: Number(process.env.PORT) || 5173,
  },
  // Fix for @powersync/web worker bundling under Vite 6 (IIFE not allowed in code-splitting builds).
  // This was surfaced after the dynamic import resolution fix allowed deeper PS module processing.
  // See similar reports for powersync + vite; 'es' format for workers avoids the iife error.
  worker: {
    format: 'es',
  },
})
