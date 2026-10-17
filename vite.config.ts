import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(({mode}) => { const base = loadEnv(mode, '.', '').BASE_PATH || '/'; return {
 base,
 plugins: [react(), VitePWA({ registerType: 'prompt', injectRegister: 'auto', includeAssets: ['apple-touch-icon.png'], manifest: { name: 'Fairshare — shared expenses', short_name: 'Fairshare', description: 'Good times. Fair shares. Private expenses with your people.', theme_color: '#183e35', background_color: '#f7f8f2', display: 'standalone', start_url: base, scope: base, icons: [{src:'icon-192.png',sizes:'192x192',type:'image/png'},{src:'icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}] }, workbox: { navigateFallback: base + 'index.html', globPatterns: ['**/*.{js,css,html,png,svg,woff2}'], cleanupOutdatedCaches: true } })],
 server: {host: '0.0.0.0'},
};});
