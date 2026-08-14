import { describe, expect, it } from 'vitest'
import { ApiError, QuotaExceededError, QuotaInsufficientError, SessionNotConnectedError, ValidationFailedError, errorFromResponse } from '../src/errors'

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
