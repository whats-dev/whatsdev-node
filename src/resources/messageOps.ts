import { Resource } from './base'
import type { Result } from '../result'

export class MessageOps extends Resource {
  forward(messageId: number | string, to: string, idempotencyKey?: string): Promise<Result<Record<string, unknown>>> {
    return this.result('POST', `v1/messages/${messageId}/forward`, { to }, this.withIdempotency(idempotencyKey))
  }

  react(messageId: number | string, emoji: string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/messages/${messageId}/reaction`, { emoji })
  }

  star(messageId: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/messages/${messageId}/star`)
  }

  unstar(messageId: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/messages/${messageId}/unstar`)
  }

  edit(messageId: number | string, text: string): Promise<Record<string, unknown>> {
    return this.httpPut(`v1/messages/${messageId}`, { text })
  }

  delete(messageId: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/messages/${messageId}`)
  }

  pin(messageId: number | string, duration?: number): Promise<Record<string, unknown>> {
    // Omit duration rather than send it as null/undefined; the server rejects unrecognized nulls.
    const body = duration !== undefined ? { duration } : {}

    return this.httpPost(`v1/messages/${messageId}/pin`, body)
  }

  unpin(messageId: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/messages/${messageId}/unpin`)
  }
}
