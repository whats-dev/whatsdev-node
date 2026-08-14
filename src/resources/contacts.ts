import { Resource, rawUrlEncode } from './base'
import type { Paginator } from '../pagination'

export class Contacts extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/contacts', query)
  }

  create(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPost('v1/contacts', payload)
  }

  batch(contacts: Array<Record<string, unknown>>, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.httpPost('v1/contacts/batch', { contacts: [...contacts], ...options })
  }

  get(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/contacts/${rawUrlEncode(id)}`)
  }

  update(id: number | string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPatch(`v1/contacts/${rawUrlEncode(id)}`, payload)
  }

  delete(id: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/contacts/${rawUrlEncode(id)}`)
  }
}
