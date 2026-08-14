import { isNumeric, toInteger } from './coerce'
import { emptyWhenAbsent } from './http/transport'
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
    data: emptyWhenAbsent(response.body),
    quotaDailyRemaining: quota(daily),
    quotaMonthlyRemaining: quota(monthly),
    requestId: response.headers.get('X-Request-Id'),
  }
}

// A remaining-count is a whole number. Number() alone read '12.7' as 12.7 and '0x10' as 16,
// where the sibling package's is_numeric() gate plus (int) cast reads 12 and nothing at all.
function quota(header: string | null): number | null {
  return header !== null && isNumeric(header) ? toInteger(header) : null
}
