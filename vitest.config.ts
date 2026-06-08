/// <reference types="vitest" />
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 60000,
    globalSetup: path.resolve(__dirname, 'test/globalSetup.ts'),
  },
})
