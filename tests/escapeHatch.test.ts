import { describe, expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'
import { ServiceUnavailableError } from '../src/errors'
import { stubFetch, type StubResponse } from './support/stubFetch'

const BASE = 'https://whats.youdev.online'

function setup(responses: StubResponse[], options: Record<string, unknown> = {}) {
  const { fetch, calls } = stubFetch(responses)

  return { client: new WhatsDevClient({ apiKey: 'k', fetch, ...options }), calls }
}

/**
 * The twin of the PHP package's ClientEscapeHatchTest. Spec §7 writes the hatch as
 * request(method, path, options), and the options are the whole point: ~48 endpoints are
 * reachable only here, and a write is retried only when it carries an Idempotency-Key.
 */
describe('the escape hatch', () => {
  it('reaches an endpoint the package has no method for', async () => {
    const { client, calls } = setup([{ status: 200, body: { data: [{ id: 'g1' }] } }])

    const body = await client.request<{ data: Array<{ id: string }> }>('GET', 'v1/sessions/7/groups', {
      query: { limit: 10 },
    })

    expect(body.data[0]!.id).toBe('g1')
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/7/groups?limit=10`)
  })

  it('sends a body through the hatch', async () => {
    const { client, calls } = setup([{ status: 201, body: { id: 'g1' } }])

    await client.request('POST', 'v1/sessions/7/groups', { body: { name: 'Team' } })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toEqual({ name: 'Team' })
    expect(calls[0]!.headers['Content-Type']).toBe('application/json')
  })

  it('sends caller headers through the hatch', async () => {
    const { client, calls } = setup([{ status: 200, body: {} }])

    await client.request('GET', 'v1/sessions/7/groups', { headers: { 'X-Trace': 'abc' } })

    expect(calls[0]!.headers['X-Trace']).toBe('abc')
    expect(calls[0]!.headers.Authorization).toBe('Bearer k')
  })

  it('sends an idempotency key through the hatch', async () => {
    const { client, calls } = setup([{ status: 201, body: {} }])

    await client.request('POST', 'v1/sessions/7/groups', { body: { name: 'Team' }, idempotencyKey: 'order-42' })

    expect(calls[0]!.headers['Idempotency-Key']).toBe('order-42')
  })

  it('lets an explicit header win over the idempotencyKey option', async () => {
    const { client, calls } = setup([{ status: 201, body: {} }])

    await client.request('POST', 'v1/sessions/7/groups', {
      idempotencyKey: 'from-option',
      headers: { 'Idempotency-Key': 'from-header' },
    })

    expect(calls[0]!.headers['Idempotency-Key']).toBe('from-header')
  })

  it('retries a tier-two write that carries an idempotency key', async () => {
    const { client, calls } = setup(
      [
        { status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } }, headers: { 'Retry-After': '0' } },
        { status: 201, body: { id: 'g1' } },
      ],
      { maxRetries: 1 },
    )

    const body = await client.request<{ id: string }>('POST', 'v1/sessions/7/groups', {
      body: { name: 'Team' },
      idempotencyKey: 'order-42',
    })

    expect(calls).toHaveLength(2)
    expect(body.id).toBe('g1')
  })

  it('does not retry a tier-two write with no idempotency key, because replaying it could act twice', async () => {
    const { client, calls } = setup(
      [{ status: 503, body: { error: { code: 'service_unavailable', message: 'Down.' } }, headers: { 'Retry-After': '0' } }],
      { maxRetries: 1 },
    )

    await expect(client.request('POST', 'v1/sessions/7/groups', { body: { name: 'Team' } })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    )
    expect(calls).toHaveLength(1)
  })
})
