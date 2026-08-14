import { Resource, rawUrlEncode } from './base'
import type { Paginator } from '../pagination'
import type { Result } from '../result'

export class Bulk extends Resource {
  // Every other bulk method is at v1/bulk/...; only create hangs off the owning session.
  create(
    sessionId: number | string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Result<Record<string, unknown>>> {
    return this.result('POST', `v1/sessions/${rawUrlEncode(sessionId)}/bulk`, payload, this.withIdempotency(idempotencyKey))
  }

  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/bulk', query)
  }

  get(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/bulk/${rawUrlEncode(id)}`)
  }

  recipients(id: number | string, query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate(`v1/bulk/${rawUrlEncode(id)}/recipients`, query)
  }

  pause(id: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/bulk/${rawUrlEncode(id)}/pause`)
  }

  resume(id: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/bulk/${rawUrlEncode(id)}/resume`)
  }

  cancel(id: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/bulk/${rawUrlEncode(id)}/cancel`)
  }
}
