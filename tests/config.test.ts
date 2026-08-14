import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE_URL, resolveConfig } from '../src/config'
import { WhatsDevClient } from '../src/client'

describe('resolveConfig', () => {
  it('defaults base url, timeout and retries', () => {
    expect(resolveConfig({ apiKey: 'k' })).toEqual({
      apiKey: 'k',
      baseUrl: DEFAULT_BASE_URL,
      timeout: 30_000,
      maxRetries: 2,
      headers: {},
    })
  })

  it('trims a trailing slash so paths never double up', () => {
    expect(resolveConfig({ apiKey: 'k', baseUrl: 'https://example.test/' }).baseUrl).toBe('https://example.test')
  })

  it('refuses an empty api key', () => {
    expect(() => resolveConfig({ apiKey: '' })).toThrow('apiKey is required')
  })

  it('accepts a bare key string', () => {
    expect(new WhatsDevClient('k').config.apiKey).toBe('k')
  })
})
