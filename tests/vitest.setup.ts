/**
 * Standalone-toolchain shim: the published @deepseek-ai/dsh-client-runtime
 * /client entry is a browser module registered through the harness
 * __ModuleLoader__ table. Under plain vitest (no harness) we install a loader
 * that answers its bare requires from this repo's node_modules, so importing
 * createSnapshotStore works without the private registry.
 */
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)

;(globalThis as Record<string, unknown>).window ??= {}
;(window as Record<string, unknown>).__ModuleLoader__ ??= {
  load: ({ factory }: { factory: (req: (id: string) => unknown) => unknown }) =>
    factory((id: string) => req(id)),
}
