import { describe, expect, it } from 'vitest'
import { ApiError, FeatureNotSupportedError, QuotaExceededError, QuotaInsufficientError, SessionNotConnectedError, ValidationFailedError, errorFromResponse } from '../src/errors'

describe('errorFromResponse', () => {
  it('maps a known code to its own class', () => {
    const error = errorFromResponse(429, { error: { code: 'quota_exceeded', message: 'No.' } })

    expect(error).toBeInstanceOf(QuotaExceededError)
    expect(error.code).toBe('quota_exceeded')
    expect(error.status).toBe(429)
    expect(error.message).toBe('No.')
  })

  it('falls back to ApiError for a code it has never heard of', () => {
    const error = errorFromResponse(422, { error: { code: 'invented_tomorrow', message: 'New.' } })

    expect(error.constructor).toBe(ApiError)
    expect(error.code).toBe('invented_tomorrow')
  })

  it('survives a body that is not the documented envelope', () => {
    const error = errorFromResponse(502, 'gateway exploded', 'req-1')

    expect(error.code).toBe('http_error')
    expect(error.requestId).toBe('req-1')
  })

  it('exposes validation errors as a field map', () => {
    const error = errorFromResponse(422, {
      error: { code: 'validation_failed', message: 'Bad.', details: { to: ['required'] } },
    })

    expect(error).toBeInstanceOf(ValidationFailedError)
    expect((error as ValidationFailedError).errors).toEqual({ to: ['required'] })
  })

  it('exposes quota shortfall numbers', () => {
    const error = errorFromResponse(422, {
      error: {
        code: 'quota_insufficient',
        message: 'Not enough.',
        details: { requested: 500, remaining_daily: 10, remaining_monthly: 200 },
      },
    }) as QuotaInsufficientError

    expect(error.requested).toBe(500)
    expect(error.remainingDaily).toBe(10)
    expect(error.remainingMonthly).toBe(200)
  })

  it('keeps instanceof ApiError working for every subclass', () => {
    expect(errorFromResponse(429, { error: { code: 'rate_limited', message: 'Slow down.' } })).toBeInstanceOf(ApiError)
  })

  it('preserves instanceof ApiError and Error through the prototype chain on direct construction', () => {
    const error = new SessionNotConnectedError('Not connected.', 'session_not_connected', 409)

    expect(error).toBeInstanceOf(SessionNotConnectedError)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
  })

  it.each(['toString', 'hasOwnProperty', 'constructor'])(
    'does not resolve inherited Object.prototype members for code %s',
    (code) => {
      const error = errorFromResponse(400, { error: { code, message: 'x' } })

      expect(error.constructor).toBe(ApiError)
      expect(error.code).toBe(code)
      expect(error).toBeInstanceOf(ApiError)
    },
  )
})

/**
 * The server sends well-typed details today, so everything below is hostile-server and
 * version-skew hardening: spec §11's second named risk. A typed property must never carry a
 * value its own declaration forbids — a `string[]` holding a string makes .join() throw, and a
 * `number` holding NaN poisons every arithmetic the caller does with it.
 */
describe('detail coercion', () => {
  const detailed = (code: string, details: unknown): Record<string, unknown> =>
    errorFromResponse(422, { error: { code, message: 'x', details } }) as unknown as Record<string, unknown>

  it.each([
    ['missing_count given a word', 'template_variables_missing', { missing_count: 'x' }, 'missingCount', 0],
    ['missing_count given a numeric string', 'template_variables_missing', { missing_count: '12' }, 'missingCount', 12],
    ['missing_count given a float', 'template_variables_missing', { missing_count: 12.7 }, 'missingCount', 12],
    ['missing_count given a list', 'template_variables_missing', { missing_count: ['x'] }, 'missingCount', 0],
    ['missing_count absent', 'template_variables_missing', {}, 'missingCount', 0],
    ['missing_variables given a scalar', 'template_variables_missing', { missing_variables: 'name' }, 'missingVariables', ['name']],
    ['missing_variables given a map', 'template_variables_missing', { missing_variables: { a: 'b' } }, 'missingVariables', []],
    ['missing_variables given a list', 'template_variables_missing', { missing_variables: ['a', 'b'] }, 'missingVariables', ['a', 'b']],
    ['missing_variables given a mixed list', 'template_variables_missing', { missing_variables: ['a', 5] }, 'missingVariables', ['a']],
    ['missing_variables absent', 'template_variables_missing', {}, 'missingVariables', []],
    ['sample given a list', 'template_variables_missing', { sample: ['a'] }, 'sample', ''],
    ['sample given a string', 'template_variables_missing', { sample: 'Hi {{name}}' }, 'sample', 'Hi {{name}}'],
    ['sample absent', 'template_variables_missing', {}, 'sample', null],
    ['retry_after given a word', 'daily_cap_reached', { retry_after: 'soon' }, 'retryAfter', 0],
    ['retry_after given a numeric string', 'daily_cap_reached', { retry_after: '30' }, 'retryAfter', 30],
    ['retry_after absent', 'daily_cap_reached', {}, 'retryAfter', null],
    ['requested given a word', 'quota_insufficient', { requested: 'lots' }, 'requested', 0],
    ['remaining_daily given a bool', 'quota_insufficient', { remaining_daily: true }, 'remainingDaily', 0],
    ['remaining_monthly given a float string', 'quota_insufficient', { remaining_monthly: '9.9' }, 'remainingMonthly', 9],
    ['list_ids given a scalar', 'list_not_found', { list_ids: 5 }, 'listIds', [5]],
    ['list_ids given a map', 'list_not_found', { list_ids: { a: 1 } }, 'listIds', []],
    ['list_ids absent', 'list_not_found', {}, 'listIds', []],
    ['feature given a list', 'feature_not_supported', { feature: ['a'] }, 'feature', ''],
    ['feature given a number', 'feature_not_supported', { feature: 5 }, 'feature', ''],
    ['feature given a string', 'feature_not_supported', { feature: 'polls' }, 'feature', 'polls'],
    ['feature absent', 'feature_not_supported', {}, 'feature', null],
  ] as const)('coerces %s', (_name, code, details, property, expected) => {
    expect(detailed(code, details)[property]).toEqual(expected)
  })

  it('leaves the raw detail readable even when the typed view had to drop it', () => {
    const error = errorFromResponse(422, {
      error: { code: 'feature_not_supported', message: 'x', details: { feature: ['a', 'b'] } },
    }) as FeatureNotSupportedError

    expect(error.feature).toBe('')
    expect(error.details.feature).toEqual(['a', 'b'])
  })

  it.each([
    ['a string', 'oops'],
    ['a number', 7],
    ['a bool', true],
    ['null', null],
  ])('ignores a details payload that is %s', (_name, details) => {
    const error = errorFromResponse(422, {
      error: { code: 'validation_failed', message: 'm', details },
    }) as ValidationFailedError

    expect(error).toBeInstanceOf(ValidationFailedError)
    expect(error.details).toEqual({})
    expect(error.errors).toEqual({})
    // The typed map is what a caller iterates; a string here yields character-index pairs.
    expect(Object.entries(error.errors)).toEqual([])
  })

  // A JSON list decodes to an array in PHP and to an Array in JavaScript, and both packages let it
  // through their map guard. Pinned so the two never drift apart on the shape they disagree least about.
  it('lets a details payload that is a json list through unchanged', () => {
    const error = errorFromResponse(422, {
      error: { code: 'validation_failed', message: 'm', details: ['a', 'b'] },
    }) as ValidationFailedError

    expect(error.details).toEqual(['a', 'b'])
    expect(error.errors).toEqual(['a', 'b'])
  })
})
