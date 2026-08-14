import { Resource } from './base'
import type { Paginator } from '../pagination'

// Mirrors PHP's rawurlencode(): encodeURIComponent leaves !'()* unescaped, rawurlencode does not.
function rawUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export class Suppressions extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/suppressions', query)
  }

  create(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPost('v1/suppressions', payload)
  }

  delete(phone: string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/suppressions/${rawUrlEncode(phone)}`)
  }
}
