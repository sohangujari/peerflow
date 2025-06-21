import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      external: ['buffer'],
    },
  },
  resolve: {
    alias: {
      events: 'events',
      buffer: 'buffer',
      util: 'util'
    }
  }
})
