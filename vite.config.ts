import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// BASE_PATH lets the same build run at the domain root (Vercel) or under
// /<repo>/ (GitHub Pages).
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  // NEXT_PUBLIC_ too, so Vercel's Supabase integration variables reach the app.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'BARISTA — Bar review companion',
        short_name: 'BARISTA',
        description: 'Syllabus, cards, digests and essay practice for the 2027 Bar.',
        theme_color: '#1D2130',
        background_color: '#F5F6F8',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Latin font subsets only; the app's text is English and Filipino.
        globIgnores: ['**/*-cyrillic*', '**/*-greek*', '**/*-vietnamese*'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1500 },
});
