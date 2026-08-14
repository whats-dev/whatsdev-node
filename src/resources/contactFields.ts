import { Resource, rawUrlEncode } from './base'
import type { Paginator } from '../pagination'

export class ContactFields extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/contact-fields', query)
  }

  create(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPost('v1/contact-fields', payload)
  }

  update(id: number | string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPatch(`v1/contact-fields/${rawUrlEncode(id)}`, payload)
  }

  delete(id: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/contact-fields/${rawUrlEncode(id)}`)
  }
}
