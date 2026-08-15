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

// The same "log the resolved config at boot" line runs in a PHP service and a Node one. PHP's
// Config redacts under print_r and json_encode; these pin the sibling behaviour so the pair
// cannot drift into one team's aggregator holding a live key and the other's holding ***redacted***.
describe('the config object handed to the caller', () => {
  it('redacts the key under JSON.stringify while keeping the rest', () => {
    const config = new WhatsDevClient({ apiKey: KEY, baseUrl: 'https://example.test' }).config
    const encoded = JSON.stringify(config)

    expect(encoded).not.toContain(KEY)
    expect(encoded).toContain('***redacted***')
    expect(encoded).toContain('example.test')
  })

  it('redacts the key under util.inspect, which is what console.log prints', () => {
    const config = new WhatsDevClient({ apiKey: KEY, baseUrl: 'https://example.test' }).config

    expect(inspect(config)).not.toContain(KEY)
    expect(inspect(config)).toContain('***redacted***')
    expect(inspect({ config })).not.toContain(KEY)
  })

  // showHidden walks the prototype, so the config getter is resolved and printed in full.
  it('redacts the key when inspect reaches it through the getter', () => {
    const client = new WhatsDevClient(KEY)

    expect(inspect(client, { getters: true, showHidden: true, depth: 2 })).not.toContain(KEY)
  })

  it('reads the real key back through the property, which is the documented access', () => {
    const config = new WhatsDevClient(KEY).config

    expect(config.apiKey).toBe(KEY)
  })

  // Redaction must not change the shape: an enumerable toJSON would appear in Object.keys and a spread.
  it('leaves the enumerable shape untouched', () => {
    const config = new WhatsDevClient(KEY).config

    expect(Object.keys(config)).toEqual(['apiKey', 'baseUrl', 'timeout', 'maxRetries', 'headers'])
    expect({ ...config }.apiKey).toBe(KEY)
  })
})
