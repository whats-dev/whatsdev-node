import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'

// A logged client reaches a log file, an error tracker or a shared terminal, and the key it carries
// is a live credential. Reading it back through client.config must still work — this is about
// accidental output, not about hiding it from the caller who set it.
const KEY = 'sk_live_secret'

describe('api key exposure', () => {
  it('keeps the api key out of JSON.stringify, resources and transport included', () => {
    const client = new WhatsDevClient(KEY)

    expect(JSON.stringify(client)).not.toContain(KEY)
    expect(JSON.stringify(client.messages)).not.toContain(KEY)
    expect(JSON.stringify({ client })).not.toContain(KEY)
  })

  it('keeps the api key out of console.log', () => {
    const client = new WhatsDevClient(KEY)

    expect(inspect(client, { depth: null })).not.toContain(KEY)
  })

  it('still exposes the config through normal access', () => {
    const client = new WhatsDevClient({ apiKey: KEY, baseUrl: 'https://example.test' })

    expect(client.config.apiKey).toBe(KEY)
    expect(client.config.baseUrl).toBe('https://example.test')
    expect(client.config.maxRetries).toBe(2)
  })
})
