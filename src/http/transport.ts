import { randomUUID } from 'node:crypto'
import type { ResolvedConfig } from '../config'
import { ConnectionError, errorFromResponse } from '../errors'
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
}

export function uuidv4(): string {
  return randomUUID()
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const RETRY_STATUSES = new Set([429, 502, 503, 504])

export class Transport {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const upperMethod = method.toUpperCase()
    const headers = this.buildHeaders(upperMethod, options)
    const url = this.buildUrl(path, options.query)
    const attempts = 1 + Math.max(0, this.config.maxRetries)
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
        signal: AbortSignal.timeout(this.config.timeout),
      })
    } catch (err) {
      throw new ConnectionError(err instanceof Error ? err.message : 'The request could not be completed.')
    }

    let text: string

    try {
      text = await response.text()
    } catch (err) {
      throw new ConnectionError(err instanceof Error ? err.message : 'The response body could not be read.')
    }

    // A non-JSON body (e.g. an empty 204) decodes to undefined rather than throwing.
    let body_: unknown
    try {
      body_ = text === '' ? undefined : JSON.parse(text)
    } catch {
      body_ = undefined
    }

    return { status: response.status, headers: response.headers, body: body_ }
  }

  private buildHeaders(method: string, options: RequestOptions): Record<string, string> {
    const defaults: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `whatsdev-node/${VERSION} node/${process.version}`,
      ...this.config.headers,
    }

    if (options.body !== undefined) {
      defaults['Content-Type'] = 'application/json'
    }

    const headers = { ...defaults }

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    // Caller-set headers win: an explicit Idempotency-Key or a per-call override must survive.
    return { ...headers, ...options.headers }
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const url = `${base}/${path.replace(/^\/+/, '')}`

    if (!query) {
      return url
    }

    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) {
        continue
      }
      params.append(key, String(value))
    }

    const qs = params.toString()

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
    const numeric = retryAfter !== null && retryAfter !== '' && !Number.isNaN(Number(retryAfter)) ? Number(retryAfter) : null
    const seconds = numeric ?? Math.min(2 ** attempt, 8)

    await this.sleep(seconds * 1000 + Math.random() * 250)
  }
}
