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
})
