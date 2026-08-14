import { Resource, rawUrlEncode } from './base'
import type { Paginator } from '../pagination'

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
