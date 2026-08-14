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

/**
 * The twin of the PHP package's quota-header table. A remaining-count is a whole number, and
 * is_numeric() is the gate over there: '0x10' is not a number to that parser and 12.7 truncates.
 * Number() read '12.7' as 12.7 and '0x10' as 16.
 */
describe('quota header parsing', () => {
  it.each([
    ['a plain count', '12', 12],
    ['a fractional count truncates', '12.7', 12],
    ['a negative count', '-5', -5],
    ['leading zeroes', '00012', 12],
    ['an exponent', '1e3', 1000],
    ['a leading plus', '+7', 7],
    ['surrounding whitespace', ' 12 ', 12],
    ['a fraction below one', '.5', 0],
    ['hexadecimal is not a number', '0x10', null],
    ['a word', 'abc', null],
    ['digits with a suffix', '12abc', null],
    ['an underscore separator', '1_0', null],
    ['empty', '', null],
  ])('parses %s', async (_name, header, expected) => {
    const { fetch } = stubFetch([{ status: 200, body: { id: 1 }, headers: { 'X-Quota-Daily-Remaining': header } }])

    const result = resultFromResponse(await makeTransport(fetch).request('GET', 'v1/me'))

    expect(result.quotaDailyRemaining).toBe(expected)
  })
})
