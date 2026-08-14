import { Resource } from './base'
import type { Paginator } from '../pagination'

export class Sessions extends Resource {
  list(query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate('v1/sessions', query)
  }

  get(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/sessions/${id}`)
  }

  create(options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.httpPost('v1/sessions', options)
  }

  delete(id: number | string): Promise<Record<string, unknown>> {
    return this.httpDelete(`v1/sessions/${id}`)
  }

  qr(id: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/sessions/${id}/qr`)
  }

  pairingCode(id: number | string, phone: string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/sessions/${id}/pairing-code`, { phone })
  }

  restart(id: number | string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/sessions/${id}/restart`)
  }

  typing(id: number | string, chatId: string, on = true): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/sessions/${id}/typing`, { chat_id: chatId, on })
  }

  seen(id: number | string, chatId: string): Promise<Record<string, unknown>> {
    return this.httpPost(`v1/sessions/${id}/seen`, { chat_id: chatId })
  }

  checkExists(id: number | string, phone: string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/sessions/${id}/check-exists`, { phone })
  }
}
