import { uuidv4 } from '../http/transport'
import type { Transport } from '../http/transport'
import { Paginator } from '../pagination'
import { resultFromResponse } from '../result'
import type { Result } from '../result'

/**
 * Every caller-supplied path segment goes through this. Unencoded, a forwarded route parameter
 * retargets the request: `messageOps.delete('../../v1/sessions/9')` would otherwise reach the
 * server as DELETE /v1/sessions/9, authenticated with the account's own key.
 *
 * Mirrors PHP's rawurlencode(): encodeURIComponent leaves !'()* unescaped, rawurlencode does not.
 */
export function rawUrlEncode(value: string | number): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

// Prefixed http* (not get/post/delete): several resources define public get(id) and delete(id)
// methods, and TypeScript rejects an incompatible override of a same-named base member.
export abstract class Resource {
  constructor(protected readonly transport: Transport) {}

  protected async httpGet<T = Record<string, unknown>>(path: string, query?: Record<string, unknown>): Promise<T> {
    const response = await this.transport.request<T>('GET', path, { query })
    return response.body
  }

  protected async httpPost<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.transport.request<T>('POST', path, { body, headers, query })
    return response.body
  }

  protected async httpPut<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    const response = await this.transport.request<T>('PUT', path, { body })
    return response.body
  }

  protected async httpPatch<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    const response = await this.transport.request<T>('PATCH', path, { body })
    return response.body
  }

  protected async httpDelete<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.transport.request<T>('DELETE', path, { body, query })
    return response.body
  }

  protected async result<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Result<T>> {
    const response = await this.transport.request<T>(method, path, { body, headers })
    return resultFromResponse(response)
  }

  protected paginate<T = Record<string, unknown>>(path: string, query: Record<string, unknown> = {}): Paginator<T> {
    return new Paginator<T>(this.transport, 'GET', path, query)
  }

  // The server deduplicates on this key, so a retried write can never send twice. Generated per
  // call unless the caller supplies one — a caller resuming its own workflow wants to reuse the
  // original key, which is exactly when replay is the point.
  protected withIdempotency(key?: string): Record<string, string> {
    return { 'Idempotency-Key': key ?? uuidv4() }
  }
}
