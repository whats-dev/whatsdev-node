import { describe, expect, it } from 'vitest'
import { Transport } from '../src/http/transport'
import { resolveConfig } from '../src/config'
import {
  ConnectionError,
  InvalidHeaderError,
  InvalidIdempotencyKeyError,
  QuotaExceededError,
  ValidationFailedError,
  WhatsDevError,
} from '../src/errors'
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

  // The server is Laravel, so its own parser is the reference for what a query string means, and
  // the sibling package's http_build_query() is the form it parses natively. A comma-joined array
  // is silently dropped by that parser and a literal "true" is not the boolean it looks like.
  it.each([
    ['an array filter as indexed brackets', { status: ['sent', 'failed'] }, 'status%5B0%5D=sent&status%5B1%5D=failed'],
    ['a boolean as 1 and 0', { starred: true, unread: false }, 'starred=1&unread=0'],
    ['a nested map with bracket keys', { filter: { type: 'text', n: 3 } }, 'filter%5Btype%5D=text&filter%5Bn%5D=3'],
    ['a null nested inside an array, without renumbering', { tag: ['x', null, 'y'] }, 'tag%5B0%5D=x&tag%5B2%5D=y'],
    ['an empty array as nothing at all', { tag: [], type: 'text' }, 'type=text'],
    ['reserved characters in keys and values', { 'q a': 'a b&c=d', tilde: '~!*()' }, 'q+a=a+b%26c%3Dd&tilde=%7E%21%2A%28%29'],
    ['a float without dropping its fraction', { lat: 15.35 }, 'lat=15.35'],
  ])('serialises %s', async (_name, query, expected) => {
    const { fetch, calls } = stubFetch([{ status: 200 }])

    await transport(fetch).request('GET', 'v1/messages', { query })

    expect(calls[0]!.url).toBe(`https://whats.youdev.online/v1/messages?${expected}`)
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

  // Node rejects the header at the fetch layer and the failure came back wrapped as a
  // ConnectionError — a misleading type for what is plainly caller input, and only after the
  // request had been attempted. PHP's cURL silently truncated the same key instead, leaving caller
  // and server disagreeing about what the key was, which deduplication cannot survive.
  it.each([
    ['the header-injection shape', 'order-42\r\nX-Injected: yes'],
    ['a bare newline', 'order-42\n'],
    ['a null byte', 'order-42\u0000'],
    ['a tab', 'order\t42'],
  ])('rejects an Idempotency-Key carrying control characters (%s)', async (_label, key) => {
    const viaOption = stubFetch([{ status: 201, body: { id: 1 } }])
    const viaHeader = stubFetch([{ status: 201, body: { id: 1 } }])

    await expect(
      transport(viaOption.fetch).request('POST', 'v1/sessions/1/messages', { body: { to: '1' }, idempotencyKey: key }),
    ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError)

    await expect(
      transport(viaHeader.fetch).request('POST', 'v1/sessions/1/messages', {
        body: { to: '1' },
        headers: { 'Idempotency-Key': key },
      }),
    ).rejects.toBeInstanceOf(WhatsDevError)

    expect(viaOption.calls, 'The request went out before the key was checked.').toHaveLength(0)
    expect(viaHeader.calls).toHaveLength(0)
  })

  it('still accepts an ordinary idempotency key', async () => {
    const { fetch, calls } = stubFetch([{ status: 201, body: { id: 1 } }])

    await transport(fetch).request('POST', 'v1/sessions/1/messages', { body: { to: '1' }, idempotencyKey: 'order-42_a.b~c' })

    expect(calls[0]!.headers['Idempotency-Key']).toBe('order-42_a.b~c')
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

/**
 * AbortSignal.timeout(0) aborts on the next tick, so `timeout: 0` failed every request in about
 * 30ms. The sibling package reads the same 0 as CURLOPT_TIMEOUT => 0, which is cURL's documented
 * "no timeout". These prove the behaviour rather than inspecting the signal, through a fetch that
 * honours abortion the way a real one does.
 */
describe('Transport timeouts', () => {
  const abortAware = (async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    await new Promise((resolve) => setTimeout(resolve, 5))

    if (init?.signal?.aborted) {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('disables the deadline entirely for a %s timeout', async (_label, timeout) => {
    const response = await transport(abortAware, { timeout }).request<{ ok: boolean }>('GET', 'v1/me')

    expect(response.body.ok).toBe(true)
  })

  it('still aborts a request that outruns a positive timeout', async () => {
    await expect(transport(abortAware, { timeout: 1 }).request('GET', 'v1/me')).rejects.toBeInstanceOf(ConnectionError)
  })

  it('leaves a generous timeout alone', async () => {
    const response = await transport(abortAware, { timeout: 30_000 }).request<{ ok: boolean }>('GET', 'v1/me')

    expect(response.body.ok).toBe(true)
  })
})

/**
 * The idempotency key was only the first caller-supplied header value to be checked. Every other
 * one runs the same hazard: undici rejects a non-ASCII value with a ByteString TypeError, which
 * the catch around fetch wrapped as a ConnectionError — a network fault, retried with backoff,
 * for what is caller input. The sibling package's cURL truncates the same value instead, so the
 * server reads a header the caller never wrote. Both now refuse before anything is sent.
 */
describe('Transport header validation', () => {
  it.each([
    ['a bare newline', 'abc\n'],
    ['the header-injection shape', 'abc\r\nX-Injected: yes'],
    ['a null byte', 'abc\u0000'],
    ['a tab', 'a\tb'],
    ['a delete character', 'abc\u007F'],
    ['a non-ascii letter', 'café'],
    ['an emoji', '✅'],
  ])('rejects a header value the wire cannot carry unchanged (%s)', async (_label, value) => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { ok: true } }])

    await expect(transport(fetch).request('GET', 'v1/me', { headers: { 'X-Trace': value } })).rejects.toBeInstanceOf(
      InvalidHeaderError,
    )
    expect(calls, 'The request went out before the header was checked.').toHaveLength(0)
  })

  it('names the header but never echoes its value, which may be a credential', async () => {
    const { fetch } = stubFetch([{ status: 200, body: { ok: true } }])
    const failing = () => transport(fetch).request('GET', 'v1/me', { headers: { 'X-Trace': 'sk_live_secret\n' } })

    await expect(failing()).rejects.toThrow(/X-Trace/)
    await expect(failing()).rejects.not.toThrow(/sk_live_secret/)
  })

  it.each([
    ['a control character', 'order-42\n'],
    ['a non-ascii letter', 'order-42-café'],
  ])('rejects a bad idempotency key with its own error, which is an InvalidHeaderError too (%s)', async (_label, key) => {
    const { fetch, calls } = stubFetch([{ status: 201, body: { id: 1 } }])
    const failing = () =>
      transport(fetch).request('POST', 'v1/sessions/1/messages', { body: { to: '1' }, idempotencyKey: key })

    await expect(failing()).rejects.toBeInstanceOf(InvalidIdempotencyKeyError)
    await expect(failing()).rejects.toBeInstanceOf(InvalidHeaderError)
    expect(calls).toHaveLength(0)
  })

  it('never retries a rejected header, because it is not a network fault', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { ok: true } }])

    await expect(
      transport(fetch, { maxRetries: 3 }).request('GET', 'v1/me', { headers: { 'X-Trace': 'café' } }),
    ).rejects.toBeInstanceOf(InvalidHeaderError)
    expect(calls).toHaveLength(0)
  })

  it('still accepts every printable ascii header value', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { ok: true } }])

    await transport(fetch).request('GET', 'v1/me', {
      headers: { 'X-Trace': ' !"#$%&\'()*+,-./0-9:;<=>?@A-Z[\\]^_`a-z{|}~' },
    })

    expect(calls).toHaveLength(1)
  })
})
