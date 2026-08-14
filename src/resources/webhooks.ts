import { Resource, rawUrlEncode } from './base'
import type { Paginator } from '../pagination'

export class Webhooks extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/webhooks', query)
  }

  create(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPost('v1/webhooks', payload)
  }

  get(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/webhooks/${rawUrlEncode(id)}`)
  }

  update(id: number | string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.httpPut(`v1/webhooks/${rawUrlEncode(id)}`, payload)
  }

  delete(id: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/webhooks/${rawUrlEncode(id)}`)
  }

  rotateSecret(id: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/webhooks/${rawUrlEncode(id)}/rotate-secret`)
  }

  deliveries(id: number | string, query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate(`v1/webhooks/${rawUrlEncode(id)}/deliveries`, query)
  }

  retryDelivery(id: number | string, deliveryId: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/webhooks/${rawUrlEncode(id)}/deliveries/${rawUrlEncode(deliveryId)}/retry`)
  }
}
