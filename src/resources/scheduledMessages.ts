import { Resource, rawUrlEncode } from './base'
import type { Paginator } from '../pagination'

export class ScheduledMessages extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/scheduled-messages', query)
  }

  get(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/scheduled-messages/${rawUrlEncode(id)}`)
  }

  cancel(id: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/scheduled-messages/${rawUrlEncode(id)}`)
  }
}
