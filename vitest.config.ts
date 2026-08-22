import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Standalone-toolchain shim: the published client-runtime /client entry
    // registers through the harness __ModuleLoader__ table; under plain vitest
    // we answer its bare requires from this repo's node_modules.
    setupFiles: ['./tests/vitest.setup.ts'],
    css: false,
    server: {
      deps: {
        // The published ui-primitives/runtime ESM leaves peer imports that
        // node cannot answer on its own; transform them like source.
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
  },
})
