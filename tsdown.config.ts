/**
 * tsdown config for the merged dual-face package. `pnpm run build` runs
 * `tsc -b` first, so every entry here reads the compiled `lib/types/**` and
 * the `clean` flag stays off across the three configs (one would wipe the
 * others' output).
 *
 * Three artifacts:
 * - `lib/index.js`, `lib/invariant.js` — the node half (host plugin). ESM,
 *   platform node; the runtime peers stay imports, everything else inlines.
 * - `lib/client.js` — the browser half. CJS wrapped in the
 *   `window.__ModuleLoader__.load({ id, factory })` closure the harness
 *   `dsh-client-modules` registry serves verbatim at
 *   `/plugins/model-health/client.js`. The module-table rows stay
 *   `require(...)` (the runtime/locale/UI edges named by `dsh.client.inject`,
 *   plus the React baseline); everything else inlines, and the component's
 *   CSS Module is compiled to a hashed class map plus an injected style tag.
 */
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

const ID = 'dsh-model-health'

/** Repo root: the css tag id must stay machine-independent, so the injected
 *  stylesheet key is anchored to the repo-relative source path instead of the
 *  build machine's absolute one (which would leak username and layout). */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

/** Node-half runtime peers that must stay imports in a real profile install. */
const NODE_EXTERNAL = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-home-paths',
])

const isNodeExternal = (specifier: string): boolean =>
  NODE_EXTERNAL.has(specifier) || specifier.startsWith('node:')

/**
 * Browser-half specifiers resolved from the loader module table at runtime:
 * the `dsh.client.inject` runtime edges plus the React baseline externals.
 * Every other import must inline (a `require` the table cannot answer is a
 * guaranteed runtime throw).
 */
const CLIENT_EXTERNAL = new Set([
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  'react',
  'react-dom',
  'react/jsx-runtime',
])

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Compile one `.module.css` import (already rewritten by the loader to a
 * `\0dsh-css:` virtual id) into a hashed class map plus a style-tag injector,
 * mirroring the harness client preset's CSS Modules output. The `.mjs` suffix
 * keeps tsdown's own css-guard from claiming the id before this loader runs.
 */
function cssModulesPlugin(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      if (!importer.includes('lib/types')) return null
      // tsc does not copy assets next to its output, so re-anchor the import to
      // the physical source tree (lib/types/client/X.js -> src/client/X).
      const cssPath = resolve(dirname(importer.replace('lib/types', 'src')), source)
      return CSS_VIRTUAL_PREFIX + relative(PROJECT_ROOT, cssPath) + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const cssPath = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(cssPath)
      const code = readFileSync(cssPath)
      const { code: css, exports: cssExports } = transform({
        filename: cssPath,
        code,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      const entries = Object.entries(cssExports ?? {}).sort(([l], [r]) => (l < r ? -1 : l > r ? 1 : 0))
      for (const [local, exported] of entries) classMap[local] = exported.name
      const tagId = JSON.stringify(`${ID}/${relative(PROJECT_ROOT, cssPath)}`)
      const inject = [
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(${tagId}) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = ' + tagId + ';',
        '  tag.textContent = ' + JSON.stringify(css.toString()) + ';',
        '  document.head.appendChild(tag);',
        '}',
      ].join('\n')
      return `${inject}\nexport default ${JSON.stringify(classMap)};\n`
    },
  }
}

/** Node-half library config, shared shape for index and invariant. */
function nodeHalf(entryName: string, entryFile: string): UserConfig {
  return {
    name: ID,
    entry: { [entryName]: entryFile },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: isNodeExternal,
      alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !isNodeExternal(specifier),
    },
  }
}

const clientHalf: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: (specifier: string) => CLIENT_EXTERNAL.has(specifier),
    alwaysBundle: (specifier: string) => !CLIENT_EXTERNAL.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [
  nodeHalf('index', 'lib/types/index.js'),
  nodeHalf('invariant', 'lib/types/invariant.js'),
  clientHalf,
]