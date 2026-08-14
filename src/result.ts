import type { ApiResponse } from './http/transport'

export interface Result<T> {
  data: T
  quotaDailyRemaining: number | null
  quotaMonthlyRemaining: number | null
  requestId: string | null
}

// The API wraps every single-resource response in {"data": ...}; deliberately not unwrapped here.
export function resultFromResponse<T>(response: ApiResponse<T>): Result<T> {
  const daily = response.headers.get('X-Quota-Daily-Remaining')
  const monthly = response.headers.get('X-Quota-Monthly-Remaining')

  return {
    data: response.body,
    quotaDailyRemaining: isNumeric(daily) ? Number(daily) : null,
    quotaMonthlyRemaining: isNumeric(monthly) ? Number(monthly) : null,
    requestId: response.headers.get('X-Request-Id'),
  }
}

function isNumeric(value: string | null): value is string {
  return value !== null && value !== '' && !Number.isNaN(Number(value))
}
