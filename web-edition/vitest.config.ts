import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
      '@app': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/main/**/__tests__/**/*.test.ts'],
  },
})
