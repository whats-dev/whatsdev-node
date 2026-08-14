import { randomUUID } from 'node:crypto'
import type { ResolvedConfig } from '../config'
import { ConnectionError, errorFromResponse, InvalidIdempotencyKeyError, UnexpectedRedirectError } from '../errors'
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
  // The undecoded payload. GET /v1/media/{message} streams a stored file, so for that one endpoint
  // the bytes are the answer and the JSON decode above them has nothing to work with.
  bytes: Uint8Array
}

export function uuidv4(): string {
  return randomUUID()
}

/**
 * A 204 and a non-JSON payload both decode to undefined, while every resource method declares an
 * object return — so handing undefined back makes that declaration a lie TypeScript cannot warn
 * about, and Object.keys() on it throws. {} is the mirror of the sibling package's [].
 */
export function emptyWhenAbsent<T>(body: T | null | undefined): T {
  return body ?? ({} as T)
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const RETRY_STATUSES = new Set([429, 502, 503, 504])
const MAX_RETRY_AFTER_SECONDS = 60
// Deliberately not Number(): that reads '0x1A' as 26 and ' ' as 0, where PHP's is_numeric() —
// the sibling package's gate — reads neither as a number at all.
const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/
// Mirrors the sibling package's /[\x00-\x1F\x7F]/: C0 controls plus DEL, tab included.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/**
 * The sleeper is not reachable from the public client, so a server's Retry-After would be honoured
 * with no consumer override: 86400 freezes the caller for a day per retry, and a negative value
 * made setTimeout fire immediately rather than wait. Outside the ceiling means the backoff ladder.
 */
function honouredRetryAfter(retryAfter: string | null): number | null {
  if (retryAfter === null || !NUMERIC.test(retryAfter.trim())) {
    return null
  }

  const seconds = Number(retryAfter)

  return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null
}

/**
 * fetch rejects a header value carrying a control character, and the failure came back wrapped as
 * a ConnectionError — a misleading type for caller input, and only after the request was
 * attempted. PHP's cURL silently truncated the same key instead, leaving caller and server holding
 * different keys, which is precisely what deduplication cannot survive.
 */
function assertSendableIdempotencyKey(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'idempotency-key' && CONTROL_CHARACTERS.test(String(value))) {
      throw new InvalidIdempotencyKeyError(
        'The Idempotency-Key contains a control character, so it cannot be sent unchanged. Use printable characters only.',
      )
    }
  }
}

/**
 * Mirrors PHP's http_build_query(), which is the form the Laravel server on the other end parses
 * natively: an array as indexed brackets, a boolean as 1 or 0, a null dropped without renumbering
 * what surrounds it. URLSearchParams with String(value) turned ['a','b'] into the scalar 'a,b',
 * which that parser silently drops, and true into the string 'true', which it does not read as
 * a boolean. No tier-1 endpoint takes an array filter today; the escape hatch reaches ones that do.
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

// Mirrors PHP's urlencode(), not encodeURIComponent(): the latter leaves !'()*~ unescaped and
// writes a space as %20 where PHP writes +.
function urlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}

/**
 * The API never legitimately redirects, so a 3xx is an error like any other: catchable as an
 * ApiError, naming the status and the Location it pointed at.
 */
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
  // Every resource holds a transport, so a TypeScript-private (but runtime-enumerable) config
  // would put the API key in JSON.stringify(client) once per resource. #config is private for real.
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
        signal: AbortSignal.timeout(this.#config.timeout),
        // Left to itself, fetch follows a redirect and re-sends the whole POST body to the target.
        // Only three methods attach an Idempotency-Key, so every other write would be re-executed
        // with no dedup — the "sent twice" hazard, bypassed one layer below where the gate sits.
        redirect: 'manual',
      })
    } catch (err) {
      throw new ConnectionError(err instanceof Error ? err.message : 'The request could not be completed.')
    }

    // status 0 with type 'opaqueredirect' is what a browser or edge runtime returns under
    // redirect: 'manual'; Node hands back the real 3xx. Both mean the same thing here.
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw redirected(response)
    }

    // Read as bytes, not text: response.text() decodes UTF-8 and replaces every invalid sequence,
    // which is lossy for the one endpoint that streams a file rather than answering JSON.
    let bytes: Uint8Array

    try {
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch (err) {
      throw new ConnectionError(err instanceof Error ? err.message : 'The response body could not be read.')
    }

    // A non-JSON body (e.g. an empty 204) decodes to undefined rather than throwing.
    let body_: unknown
    try {
      body_ = bytes.byteLength === 0 ? undefined : JSON.parse(new TextDecoder().decode(bytes))
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

    assertSendableIdempotencyKey(merged)

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
