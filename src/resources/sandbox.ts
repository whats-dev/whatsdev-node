import { Resource } from './base'

export interface SimulateInboundPayload {
  sessionId: number | string
  from: string
  text?: string
  [key: string]: unknown
}

export class Sandbox extends Resource {
  simulateInbound(payload: SimulateInboundPayload): Promise<Record<string, unknown>> {
    const { sessionId, ...rest } = payload

    return this.httpPost('v1/sandbox/inbound', { session_id: sessionId, ...rest })
  }
}
