import { randomUUID } from 'node:crypto'
import { isNumeric } from '../coerce'
import type { ResolvedConfig } from '../config'
import { ConnectionError, errorFromResponse, InvalidHeaderError, InvalidIdempotencyKeyError, UnexpectedRedirectError } from '../errors'
import { VERSION } from '../version'

export interface RequestOptions {
  query?: Record<string, unknown>
  body?: unknown
  headers?: Record<string, string>
  idempotencyKey?: string
}

export interface ApiResponse<T = unknown> {
  status: number
  headers: Headers
  body: T
  // GET /v1/media/{message} streams a stored file, so for that one endpoint the bytes are the answer.
  bytes: Uint8Array
}

export function uuidv4(): string {
  return randomUUID()
}

/** Every resource method declares an object return, so undefined would be a lie TypeScript cannot warn about. */
export function emptyWhenAbsent<T>(body: T | null | undefined): T {
  return body ?? ({} as T)
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const RETRY_STATUSES = new Set([429, 502, 503, 504])
const MAX_RETRY_AFTER_SECONDS = 60
// undici rejects a value above U+00FF outright, and cURL truncates one at a control character.
const UNSENDABLE = /[^\u0020-\u007E]/

/**
 * A server's Retry-After is honoured with no consumer override, so 86400 froze the caller for a day
 * per retry and a negative value made setTimeout fire immediately rather than wait.
 */
function honouredRetryAfter(retryAfter: string | null): number | null {
  if (retryAfter === null || !isNumeric(retryAfter)) {
    return null
  }

  const seconds = Number(retryAfter)

  return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null
}

/**
 * fetch rejects such a value with a TypeError that used to surface as a retryable ConnectionError,
 * where cURL truncates it instead. The message names the header, never its value: Authorization is
 * a header too.
 */
function assertSendableHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!UNSENDABLE.test(String(value))) {
      continue
    }

    if (name.toLowerCase() === 'idempotency-key') {
      throw new InvalidIdempotencyKeyError(
        'The Idempotency-Key contains a character that cannot be sent unchanged in an HTTP header. Use printable ASCII only.',
      )
    }

    throw new InvalidHeaderError(
      `The ${name} header contains a character that cannot be sent unchanged in an HTTP header. Use printable ASCII only.`,
    )
  }
}

/**
 * Mirrors PHP's http_build_query(), the form the Laravel server parses natively: URLSearchParams
 * turned ['a','b'] into 'a,b', which that parser silently drops, and true into the string 'true'.
 */
function buildQuery(query: Record<string, unknown>): string {
  const pairs: string[] = []

  for (const [key, value] of Object.entries(query)) {
    appendQuery(pairs, value, key)
  }

  return pairs.join('&')
}

function appendQuery(pairs: string[], value: unknown, key: string): void {
  if (value === null || value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendQuery(pairs, item, `${key}[${index}]`))

    return
  }

  if (typeof value === 'object') {
    for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
      appendQuery(pairs, item, `${key}[${name}]`)
    }

    return
  }

  pairs.push(`${urlencode(key)}=${urlencode(typeof value === 'boolean' ? (value ? '1' : '0') : String(value))}`)
}

// Mirrors PHP's urlencode(): encodeURIComponent leaves !'()*~ unescaped and writes a space as %20.
function urlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

/** The API never legitimately redirects, so a 3xx is an ApiError like any other. */
function redirected(response: Response): UnexpectedRedirectError {
  const location = response.headers.get('Location')

  return new UnexpectedRedirectError(
    `The API answered HTTP ${response.status} redirecting to ${location ?? 'an unnamed location'}. `
      + 'This client does not follow redirects; check the base URL and anything proxying it.',
    'unexpected_redirect',
    response.status,
    { location },
    response.headers.get('X-Request-Id') ?? undefined,
  )
}

export class Transport {
  // TypeScript's `private` is erased, so each of the 13 resources would carry the key into JSON.stringify.
  readonly #config: ResolvedConfig

  constructor(
    config: ResolvedConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.#config = config
  }

  get baseUrl(): string {
    return this.#config.baseUrl
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const upperMethod = method.toUpperCase()
    const headers = this.buildHeaders(upperMethod, options)
    const url = this.buildUrl(path, options.query)
    const attempts = 1 + Math.max(0, this.#config.maxRetries)
    let lastError: unknown = null

    for (let attempt = 0; attempt < attempts; attempt++) {
      const retryable = this.isRetryable(upperMethod, headers)

      try {
        const response = await this.send(url, upperMethod, headers, options.body)

        if (response.status < 400) {
          return response as ApiResponse<T>
        }

        const error = errorFromResponse(response.status, response.body, response.headers.get('X-Request-Id') ?? undefined)

        if (!retryable || !RETRY_STATUSES.has(response.status) || attempt === attempts - 1) {
          throw error
        }

        lastError = error
        await this.pause(attempt, response.headers.get('Retry-After'))
      } catch (err) {
        if (!(err instanceof ConnectionError)) {
          throw err
        }

        if (!retryable || attempt === attempts - 1) {
          throw err
        }

        lastError = err
        await this.pause(attempt, null)
      }
    }

    throw lastError ?? new ConnectionError('The request could not be completed.')
  }

  private async send(url: string, method: string, headers: Record<string, string>, body: unknown): Promise<ApiResponse> {
    let response: Response

    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        // AbortSignal.timeout(0) aborts on the next tick, where cURL reads the same 0 as no timeout.
        signal: this.#config.timeout > 0 ? AbortSignal.timeout(this.#config.timeout) : undefined,
        // Left to itself, fetch re-sends the whole POST body to the target, below the dedup gate.
        redirect: 'manual',
      })
    } catch (err) {
      throw new ConnectionError(err instanceof Error ? err.message : 'The request could not be completed.')
    }

    // A browser or edge runtime returns status 0 / 'opaqueredirect' where Node hands back the real 3xx.
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw redirected(response)
    }

    // response.text() replaces every invalid UTF-8 sequence, which is lossy for the one file endpoint.
    let bytes: Uint8Array

    try {
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch (err) {
      throw new ConnectionError(err instanceof Error ? err.message : 'The response body could not be read.')
    }

    // `0` and `"text"` are valid JSON but not the object every return type promises, so both null out.
    let body_: unknown
    try {
      const parsed: unknown = bytes.byteLength === 0 ? undefined : JSON.parse(new TextDecoder().decode(bytes))
      body_ = typeof parsed === 'object' && parsed !== null ? parsed : undefined
    } catch {
      body_ = undefined
    }

    return { status: response.status, headers: response.headers, body: body_, bytes }
  }

  private buildHeaders(method: string, options: RequestOptions): Record<string, string> {
    const defaults: Record<string, string> = {
      Authorization: `Bearer ${this.#config.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `whatsdev-node/${VERSION} node/${process.version}`,
      ...this.#config.headers,
    }

    if (options.body !== undefined) {
      defaults['Content-Type'] = 'application/json'
    }

    const headers = { ...defaults }

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    // Caller-set headers win: an explicit Idempotency-Key or a per-call override must survive.
    const merged = { ...headers, ...options.headers }

    assertSendableHeaders(merged)

    return merged
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const base = this.#config.baseUrl.replace(/\/+$/, '')
    const url = `${base}/${path.replace(/^\/+/, '')}`

    const qs = query ? buildQuery(query) : ''

    return qs === '' ? url : `${url}?${qs}`
  }

  // A write without an Idempotency-Key is not retried: replaying it could deliver a second real message.
  private isRetryable(method: string, headers: Record<string, string>): boolean {
    if (!WRITE_METHODS.has(method)) {
      return true
    }

    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'idempotency-key' && value !== '') {
        return true
      }
    }

    return false
  }

  private async pause(attempt: number, retryAfter: string | null): Promise<void> {
    const seconds = honouredRetryAfter(retryAfter) ?? Math.min(2 ** attempt, 8)

    await this.sleep(seconds * 1000 + Math.random() * 250)
  }
}
