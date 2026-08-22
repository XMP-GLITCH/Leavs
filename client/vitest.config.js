import { defineConfig } from 'vite'

// Deliberately NOT reusing vite.config.js: that one loads vite-plugin-pwa,
// which would try to generate a service worker on every test run.
export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify('test'),
    __BUILD_TIME__:   JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}', 'test/**/*.test.js'],
  },
})
