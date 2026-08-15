import { emptyWhenAbsent, uuidv4 } from '../http/transport'
import type { Transport } from '../http/transport'
import { mediaFileFromResponse } from '../media'
import type { MediaFile } from '../media'
import { Paginator } from '../pagination'
import { resultFromResponse } from '../result'
import type { Result } from '../result'

/**
 * Unencoded, a forwarded route parameter retargets the request: messageOps.delete('../../v1/sessions/9')
 * would reach the server as DELETE /v1/sessions/9. Mirrors rawurlencode(), which escapes !'()* too.
 */
export function rawUrlEncode(value: string | number): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

// Prefixed http*: several resources define get(id)/delete(id), which TypeScript cannot override incompatibly.
export abstract class Resource {
  constructor(protected readonly transport: Transport) {}

  protected async httpGet<T = Record<string, unknown>>(path: string, query?: Record<string, unknown>): Promise<T> {
    const response = await this.transport.request<T>('GET', path, { query })
    return emptyWhenAbsent(response.body)
  }

  // A binary endpoint: the bytes are the answer, so nothing here goes through JSON decoding.
  protected async download(path: string, query?: Record<string, unknown>): Promise<MediaFile> {
    const response = await this.transport.request<unknown>('GET', path, { query })
    return mediaFileFromResponse(response)
  }

  protected async httpPost<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.transport.request<T>('POST', path, { body, headers, query })
    return emptyWhenAbsent(response.body)
  }

  protected async httpPut<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    const response = await this.transport.request<T>('PUT', path, { body })
    return emptyWhenAbsent(response.body)
  }

  protected async httpPatch<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
    const response = await this.transport.request<T>('PATCH', path, { body })
    return emptyWhenAbsent(response.body)
  }

  protected async httpDelete<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.transport.request<T>('DELETE', path, { body, query })
    return emptyWhenAbsent(response.body)
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

  // The server deduplicates on this key, so a retried write never sends twice; a caller resuming
  // its own workflow passes the original back.
  protected withIdempotency(key?: string): Record<string, string> {
    return { 'Idempotency-Key': key ?? uuidv4() }
  }
}
