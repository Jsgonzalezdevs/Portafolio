import { resolve } from 'node:path'
import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    sourcemap: false,
    // chrome106: techo de Chrome/WebView en Android 6 (tablet del asistente, /app).
    target: ['es2020', 'chrome106'],
    cssTarget: ['chrome106'],
    cssMinify: true,
    rollupOptions: {
      // /app es una página aparte (dashboard de la tablet): no carga nada del portafolio.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // mac-agent usa node:test y corre aparte (npm test dentro de mac-agent/).
    exclude: [...configDefaults.exclude, 'mac-agent/**'],
  },
})
