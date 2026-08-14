/**
 * Defensive typing for the `details` map, shared by every error that exposes one, plus the
 * numeric gate the transport and the quota headers read through.
 *
 * The server sends well-typed details today; a newer or hostile one may not, and a typed
 * property must never carry a value its own declaration forbids. A value that cannot be coerced
 * is dropped from the typed view and stays readable on .details, which is the raw map.
 *
 * Coercion is deliberately narrow rather than permissive: String(5) and (string) 5 agree, but
 * String(true) is "true" where PHP's (string) true is "1", so allowing scalars through would put
 * the two packages back out of step on exactly the values this guards against.
 */

// Deliberately not Number(): that reads '0x1A' as 26 and ' ' as 0, where PHP's is_numeric() —
// the sibling package's gate — reads neither as a number at all.
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
 * The list behind a property declared as strings: a non-string member is dropped rather than
 * stringified, so join() on the typed view can never meet something it cannot join.
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
