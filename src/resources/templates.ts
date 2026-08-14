import { Resource } from './base'
import type { Paginator } from '../pagination'

export class Templates extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/templates', query)
  }

  create(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPost('v1/templates', payload)
  }

  get(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/templates/${id}`)
  }

  update(id: number | string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPatch(`v1/templates/${id}`, payload)
  }

  delete(id: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/templates/${id}`)
  }

  preview(id: number | string, variables: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/templates/${id}/preview`, { variables })
  }
}
