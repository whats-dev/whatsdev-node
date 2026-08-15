import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'
import { VERSION } from '../src/version'
import { stubFetch } from './support/stubFetch'

// Hand-maintained here, in package.json and in the sibling's Version::VALUE; only the User-Agent shows a drift.
it('declares the version npm publishes', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

  expect(VERSION, 'Bump src/version.ts, package.json and sdks/php/src/Version.php together.').toBe(manifest.version)
})

it('sends exactly the declared version in its User-Agent', async () => {
  const { fetch, calls } = stubFetch([{ status: 200, body: { data: {} } }])

  await new WhatsDevClient({ apiKey: 'k', fetch }).account.me()

  expect(calls[0]!.headers['User-Agent']).toBe(`whatsdev-node/${VERSION} node/${process.version}`)
})
