import { Resource } from './base'
import type { Paginator } from '../pagination'

export class ContactLists extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/contact-lists', query)
  }

  create(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPost('v1/contact-lists', payload)
  }

  get(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/contact-lists/${id}`)
  }

  update(id: number | string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPatch(`v1/contact-lists/${id}`, payload)
  }

  delete(id: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/contact-lists/${id}`)
  }

  contacts(id: number | string, query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate(`v1/contact-lists/${id}/contacts`, query)
  }

  attach(id: number | string, contactIds: Array<number | string>): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/contact-lists/${id}/contacts`, { contact_ids: [...contactIds] })
  }

  // A DELETE with a body, not query parameters — the server expects contact_ids there.
  detach(id: number | string, contactIds: Array<number | string>): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/contact-lists/${id}/contacts`, { contact_ids: [...contactIds] })
  }
}
