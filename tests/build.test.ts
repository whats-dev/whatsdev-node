import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

describe('build output', () => {
  it('emits esm, cjs and type declarations that are each genuinely importable', async () => {
    execSync('npm run build', { cwd: packageRoot, stdio: 'pipe' })

    for (const file of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']) {
      expect(existsSync(new URL(`../${file}`, import.meta.url))).toBe(true)
    }

    // A real dynamic import through Node's ESM loader, not just a file-existence check.
    const esm = await import(new URL('../dist/index.js', import.meta.url).href)
    expect(typeof esm.WhatsDevClient).toBe('function')
    expect(typeof esm.verifyWebhookSignature).toBe('function')
    expect(typeof esm.ApiError).toBe('function')

    // A real require() through Node's CJS loader — the other module system the package claims to support.
    const require = createRequire(import.meta.url)
    const cjs = require(fileURLToPath(new URL('../dist/index.cjs', import.meta.url)))
    expect(typeof cjs.WhatsDevClient).toBe('function')
    expect(typeof cjs.verifyWebhookSignature).toBe('function')
    expect(typeof cjs.ApiError).toBe('function')

    // A consumer round-trip from each entry point, not merely the presence of a symbol.
    expect(new esm.WhatsDevClient('k')).toBeInstanceOf(esm.WhatsDevClient)
    expect(new cjs.WhatsDevClient('k')).toBeInstanceOf(cjs.WhatsDevClient)
    expect(esm.verifyWebhookSignature('{}', null, 's')).toBe(false)
    expect(cjs.verifyWebhookSignature('{}', null, 's')).toBe(false)

    // The declaration file actually declares the public surface, not an empty stub.
    const dts = readFileSync(new URL('../dist/index.d.ts', import.meta.url), 'utf8')
    expect(dts).toContain('WhatsDevClient')
    expect(dts).toContain('verifyWebhookSignature')
  })

  // Both READMEs promise no @types package is needed, so a Node global here fails tsc inside
  // node_modules for a consumer who has none — with skipLibCheck off, which is the default.
  it('keeps node globals off the published type surface', () => {
    for (const file of ['dist/index.d.ts', 'dist/index.d.cts']) {
      // Only tsup's copied JSDoc is stripped; a declaration naming the type would still be scanned.
      const dts = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

      expect(dts, `${file} names a type only @types/node declares.`).not.toMatch(/\b(Buffer|NodeJS|__dirname|process)\b/)
    }
  })

  // dist/ is gitignored, so npm publish without a build first ships a package whose entry points 404.
  it('binds the published artifact to the reviewed source with prepublishOnly', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      main: string
      module: string
      types: string
      scripts: Record<string, string | undefined>
    }

    expect(manifest.scripts.prepublishOnly, 'npm publish would ship an unbuilt dist/.').toBeDefined()
    expect(manifest.scripts.prepublishOnly).toContain('build')

    for (const entry of [manifest.main, manifest.module, manifest.types]) {
      expect(entry.startsWith('./dist/')).toBe(true)
    }
  })

  // A single top-level "types" answers require too, so a CJS consumer under moduleResolution
  // node16 read the ESM declarations and failed with TS1479 against a .d.cts that was always built.
  it('points each module system at its own declarations', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, Record<string, Record<string, string>>>
    }

    expect(manifest.exports['.']!.require!.types).toBe('./dist/index.d.cts')
    expect(manifest.exports['.']!.import!.types).toBe('./dist/index.d.ts')
    expect(existsSync(new URL('../dist/index.d.cts', import.meta.url))).toBe(true)
  })
})
