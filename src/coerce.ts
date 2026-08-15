/**
 * Defensive typing for the `details` map: a value that cannot be coerced is dropped from the typed
 * view and stays readable on .details. Coercion stays narrow because String(true) is "true" where
 * PHP's (string) true is "1", and allowing scalars would put the two packages back out of step.
 */

// Not Number(): that reads '0x1A' as 26 and ' ' as 0, where PHP's is_numeric() reads neither.
const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

export function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }

  // is_numeric() tolerates surrounding whitespace; the regex itself must not.
  return typeof value === 'string' && NUMERIC.test(value.trim())
}

// Truncates toward zero, mirroring PHP's (int) cast: a remaining-count is a whole number.
export function toInteger(value: unknown): number {
  return Math.trunc(Number(value))
}

export function detailInt(details: Record<string, unknown>, key: string): number {
  return detailNullableInt(details, key) ?? 0
}

export function detailNullableInt(details: Record<string, unknown>, key: string): number | null {
  const value = details[key]

  if (value === undefined || value === null) {
    return null
  }

  return isNumeric(value) ? toInteger(value) : 0
}

export function detailList(details: Record<string, unknown>, key: string): unknown[] {
  const value = details[key]

  if (Array.isArray(value)) {
    return value as unknown[]
  }

  return isScalar(value) ? [value] : []
}

/**
 * A non-string member is dropped rather than stringified, so join() never meets what it cannot join.
 */
export function detailStringList(details: Record<string, unknown>, key: string): string[] {
  return detailList(details, key).filter((item): item is string => typeof item === 'string')
}

export function detailNullableString(details: Record<string, unknown>, key: string): string | null {
  const value = details[key]

  if (value === undefined || value === null) {
    return null
  }

  return typeof value === 'string' ? value : ''
}

function isScalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
}
