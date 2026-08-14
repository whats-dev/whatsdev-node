import { describe, expect, it } from 'vitest'
import { Transport } from '../src/http/transport'
import { resolveConfig } from '../src/config'
import { resultFromResponse } from '../src/result'
import { stubFetch } from './support/stubFetch'

const makeTransport = (fetchImpl: typeof fetch) => new Transport(resolveConfig({ apiKey: 'k' }), fetchImpl, async () => {})

describe('resultFromResponse', () => {
  it('reads quota headers off a result', async () => {
    const { fetch } = stubFetch([
      {
        status: 202,
        body: { id: 5 },
        headers: { 'X-Quota-Daily-Remaining': '17', 'X-Quota-Monthly-Remaining': '900', 'X-Request-Id': 'req-3' },
      },
    ])

    const response = await makeTransport(fetch).request<{ id: number }>('GET', 'v1/me')
    const result = resultFromResponse(response)

    expect(result.data.id).toBe(5)
    expect(result.quotaDailyRemaining).toBe(17)
    expect(result.quotaMonthlyRemaining).toBe(900)
    expect(result.requestId).toBe('req-3')
  })

  it('leaves quota null when the endpoint does not report it', async () => {
    const { fetch } = stubFetch([{ status: 200, body: { id: 5 } }])

    const response = await makeTransport(fetch).request<{ id: number }>('GET', 'v1/me')
    const result = resultFromResponse(response)

    expect(result.quotaDailyRemaining).toBeNull()
    expect(result.quotaMonthlyRemaining).toBeNull()
  })

  // Pins contract 9: the API wraps single-resource bodies in {"data": ...} and this must pass it through raw.
  it('does not unwrap a data envelope on the response body', async () => {
    const { fetch } = stubFetch([{ status: 200, body: { data: { id: 9 } } }])

    const response = await makeTransport(fetch).request<{ data: { id: number } }>('GET', 'v1/contacts/9')
    const result = resultFromResponse(response)

    expect(result.data).toEqual({ data: { id: 9 } })
  })
})
