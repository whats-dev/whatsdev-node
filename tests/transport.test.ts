import { describe, expect, it } from 'vitest'
import { Transport } from '../src/http/transport'
import { resolveConfig } from '../src/config'
import { ConnectionError, QuotaExceededError, ValidationFailedError } from '../src/errors'
import { stubFetch } from './support/stubFetch'

const transport = (fetchImpl: typeof fetch, overrides = {}) =>
  new Transport(resolveConfig({ apiKey: 'k', ...overrides }), fetchImpl, async () => {})

describe('Transport', () => {
  it('sends the bearer key, accept header and a versioned user agent', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { ok: true } }])

    await transport(fetch).request('GET', 'v1/me')

    expect(calls[0]!.headers.Authorization).toBe('Bearer k')
    expect(calls[0]!.headers.Accept).toBe('application/json')
    expect(calls[0]!.headers['User-Agent']).toMatch(/^whatsdev-node\//)
  })

  it('sets a json content type only when there is a body', async () => {
    const withoutBody = stubFetch([{ status: 200 }])
    await transport(withoutBody.fetch).request('GET', 'v1/me')
    expect(withoutBody.calls[0]!.headers['Content-Type']).toBeUndefined()

    const withBody = stubFetch([{ status: 201 }])
    await transport(withBody.fetch).request('POST', 'v1/contacts', { body: { phone: '1' } })
    expect(withBody.calls[0]!.headers['Content-Type']).toBe('application/json')
  })

  it('builds the url with the query string, dropping nullish values', async () => {
    const { fetch, calls } = stubFetch([{ status: 200 }])

    await transport(fetch).request('GET', 'v1/messages', { query: { type: 'text', status: null } })

    expect(calls[0]!.url).toBe('https://whats.youdev.online/v1/messages?type=text')
  })

  it('raises the typed error for the error code', async () => {
    const { fetch } = stubFetch([{ status: 429, body: { error: { code: 'quota_exceeded', message: 'No.' } } }])

    await expect(transport(fetch).request('GET', 'v1/me')).rejects.toBeInstanceOf(QuotaExceededError)
  })

  it('does not retry a 422', async () => {
    const { fetch, calls } = stubFetch([{ status: 422, body: { error: { code: 'validation_failed', message: 'Bad.' } } }])

    await expect(transport(fetch).request('POST', 'v1/contacts', { body: {} })).rejects.toBeInstanceOf(ValidationFailedError)
    expect(calls).toHaveLength(1)
  })

  it('retries a 503 and returns the eventual success', async () => {
    const { fetch, calls } = stubFetch([
      { status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } },
      { status: 200, body: { ok: true } },
    ])

    const response = await transport(fetch).request('GET', 'v1/me')

    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('retries a write that carries an idempotency key', async () => {
    const { fetch, calls } = stubFetch([
      { status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } },
      { status: 202, body: { id: 1 } },
    ])

    await transport(fetch).request('POST', 'v1/sessions/1/messages', { body: { to: '1' }, idempotencyKey: 'fixed' })

    expect(calls).toHaveLength(2)
    expect(calls[1]!.headers['Idempotency-Key']).toBe('fixed')
  })

  it('refuses to retry a write with no idempotency key', async () => {
    const { fetch, calls } = stubFetch([{ status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } }])

    await expect(transport(fetch).request('POST', 'v1/sessions/1/typing', { body: {} })).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  it('stops after maxRetries attempts', async () => {
    const { fetch, calls } = stubFetch([{ status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } }])

    await expect(transport(fetch, { maxRetries: 3 }).request('GET', 'v1/me')).rejects.toThrow()
    expect(calls).toHaveLength(4)
  })

  it('retries a network failure and carries the request id onto the error', async () => {
    let attempts = 0
    const failing: typeof fetch = async () => {
      attempts++
      if (attempts === 1) throw new TypeError('fetch failed')
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Gone.' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-9' },
      })
    }

    await expect(transport(failing).request('GET', 'v1/messages/1')).rejects.toMatchObject({ requestId: 'req-9' })
    expect(attempts).toBe(2)
  })
})

// Beyond the brief's ten: pins the remaining mirrored contracts (backoff shape, header
// precedence, casing/emptiness of the idempotency gate, non-JSON decode, and abort handling).
describe('Transport additional coverage', () => {
  const withSleep = (fetchImpl: typeof fetch, overrides = {}) => {
    const slept: number[] = []
    const client = new Transport(resolveConfig({ apiKey: 'k', ...overrides }), fetchImpl, async (ms) => {
      slept.push(ms)
    })
    return { client, slept }
  }

  it('honours Retry-After on a 429, sleeping that long plus at most the jitter ceiling', async () => {
    const { fetch } = stubFetch([
      { status: 429, body: { error: { code: 'quota_exceeded', message: 'No.' } }, headers: { 'Retry-After': '2' } },
      { status: 200, body: { ok: true } },
    ])
    const { client, slept } = withSleep(fetch)

    await client.request('GET', 'v1/me')

    expect(slept).toHaveLength(1)
    expect(slept[0]!).toBeGreaterThanOrEqual(2_000)
    expect(slept[0]!).toBeLessThanOrEqual(2_250)
  })

  // The sleeper is a private constructor argument, so a consumer has no override: one misbehaving
  // proxy in front of the API would otherwise freeze every integration, and a negative value made
  // setTimeout fire immediately rather than wait at all.
  it.each([
    ['a full day', '86400'],
    ['one second past the ceiling', '61'],
    ['negative', '-1'],
    ['an absurd exponent', '1e30'],
    ['an HTTP-date rather than a delay', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['not a number at all', 'soon'],
  ])('falls back to the backoff ladder rather than honour an out-of-range Retry-After (%s)', async (_label, retryAfter) => {
    const { fetch } = stubFetch([
      { status: 429, body: { error: { code: 'quota_exceeded', message: 'No.' } }, headers: { 'Retry-After': retryAfter } },
      { status: 200, body: { ok: true } },
    ])
    const { client, slept } = withSleep(fetch)

    await client.request('GET', 'v1/me')

    expect(slept).toHaveLength(1)
    expect(slept[0]!).toBeGreaterThanOrEqual(1_000)
    expect(slept[0]!).toBeLessThanOrEqual(1_250)
  })

  it.each([
    ['zero', '0', 0, 250],
    ['a plain delay', '5', 5_000, 5_250],
    ['the ceiling itself', '60', 60_000, 60_250],
  ])('honours a Retry-After inside the ceiling (%s)', async (_label, retryAfter, least, most) => {
    const { fetch } = stubFetch([
      { status: 429, body: { error: { code: 'quota_exceeded', message: 'No.' } }, headers: { 'Retry-After': String(retryAfter) } },
      { status: 200, body: { ok: true } },
    ])
    const { client, slept } = withSleep(fetch)

    await client.request('GET', 'v1/me')

    expect(slept).toHaveLength(1)
    expect(slept[0]!).toBeGreaterThanOrEqual(Number(least))
    expect(slept[0]!).toBeLessThanOrEqual(Number(most))
  })

  it('backs off exponentially rather than at a constant delay when there is no Retry-After', async () => {
    const { fetch } = stubFetch([{ status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } }])
    const { client, slept } = withSleep(fetch, { maxRetries: 2 })

    await expect(client.request('GET', 'v1/me')).rejects.toThrow()

    expect(slept).toHaveLength(2)
    expect(slept[0]!).toBeGreaterThanOrEqual(1_000)
    expect(slept[0]!).toBeLessThanOrEqual(1_250)
    expect(slept[1]!).toBeGreaterThanOrEqual(2_000)
    expect(slept[1]!).toBeLessThanOrEqual(2_250)
    expect(slept[1]!).toBeGreaterThan(slept[0]!)
  })

  it('caps the backoff at 8 seconds plus jitter no matter how many attempts run', async () => {
    const { fetch } = stubFetch([{ status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } }])
    const { client, slept } = withSleep(fetch, { maxRetries: 6 })

    await expect(client.request('GET', 'v1/me')).rejects.toThrow()

    expect(slept).toHaveLength(6)
    for (const ms of slept) {
      expect(ms).toBeLessThanOrEqual(8_250)
    }
    expect(slept[3]!).toBeGreaterThanOrEqual(8_000)
    expect(slept[4]!).toBeGreaterThanOrEqual(8_000)
    expect(slept[5]!).toBeGreaterThanOrEqual(8_000)
  })

  it('recognises an idempotency key regardless of header casing', async () => {
    const { fetch, calls } = stubFetch([
      { status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } },
      { status: 201, body: { id: 1 } },
    ])

    await transport(fetch).request('POST', 'v1/sessions/1/messages', {
      body: { to: '1' },
      headers: { 'idempotency-key': 'fixed' },
    })

    expect(calls).toHaveLength(2)
  })

  it('does not treat an empty idempotencyKey option as present', async () => {
    const { fetch, calls } = stubFetch([{ status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } }])

    await expect(
      transport(fetch).request('POST', 'v1/sessions/1/messages', { body: { to: '1' }, idempotencyKey: '' }),
    ).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  it('does not treat an empty Idempotency-Key header as present', async () => {
    const { fetch, calls } = stubFetch([{ status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } } }])

    await expect(
      transport(fetch).request('POST', 'v1/sessions/1/messages', { body: { to: '1' }, headers: { 'Idempotency-Key': '' } }),
    ).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  it('lets a caller-set header override both the transport default and the config header', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { ok: true } }])

    await transport(fetch, { headers: { Authorization: 'Bearer configured' } }).request('GET', 'v1/me', {
      headers: { Authorization: 'Bearer explicit' },
    })

    expect(calls[0]!.headers.Authorization).toBe('Bearer explicit')
  })

  it('decodes a non-JSON body (e.g. an empty 204) to undefined instead of throwing', async () => {
    const { fetch } = stubFetch([{ status: 204 }])

    const response = await transport(fetch).request('GET', 'v1/me')

    expect(response.body).toBeUndefined()
  })

  it('surfaces a fetch AbortError as a ConnectionError', async () => {
    const aborting: typeof fetch = async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    await expect(transport(aborting).request('GET', 'v1/me')).rejects.toBeInstanceOf(ConnectionError)
  })
})
