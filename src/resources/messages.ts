import { Resource, rawUrlEncode } from './base'
import type { Paginator } from '../pagination'
import type { Result } from '../result'
import type { LocationPayload, MediaPayload, PollPayload, SendOptions } from '../types'

// Maps SendOptions' known camelCase fields to the wire's snake_case; anything else passes through as-is.
function applyOptions(body: Record<string, unknown>, options: SendOptions): Record<string, unknown> {
  const { replyTo, sendAt, caption, asNote, ...rest } = options

  return {
    ...body,
    ...(replyTo !== undefined && { reply_to: replyTo }),
    ...(sendAt !== undefined && { send_at: sendAt }),
    ...(caption !== undefined && { caption }),
    ...(asNote !== undefined && { as_note: asNote }),
    ...rest,
  }
}

export class Messages extends Resource {
  list(sessionId: number | string, query: Record<string, unknown> = {}): Paginator<Record<string, unknown>> {
    return this.paginate(`v1/sessions/${rawUrlEncode(sessionId)}/messages`, query)
  }

  get(messageId: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/messages/${rawUrlEncode(messageId)}`)
  }

  media(messageId: number | string): Promise<Record<string, unknown>> {
    return this.httpGet(`v1/media/${rawUrlEncode(messageId)}`)
  }

  send(
    sessionId: number | string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Result<Record<string, unknown>>> {
    return this.result('POST', `v1/sessions/${rawUrlEncode(sessionId)}/messages`, payload, this.withIdempotency(idempotencyKey))
  }

  sendText(sessionId: number | string, to: string, text: string, options: SendOptions = {}): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'text', text }, options))
  }

  sendImage(
    sessionId: number | string,
    to: string,
    media: MediaPayload,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'image', media }, options))
  }

  sendVideo(
    sessionId: number | string,
    to: string,
    media: MediaPayload,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'video', media }, options))
  }

  sendVoice(
    sessionId: number | string,
    to: string,
    media: MediaPayload,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'voice', media }, options))
  }

  sendDocument(
    sessionId: number | string,
    to: string,
    media: MediaPayload,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'document', media }, options))
  }

  sendLocation(
    sessionId: number | string,
    to: string,
    latitude: number,
    longitude: number,
    title?: string,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    // Omit title rather than send it as null; the server rejects unrecognized nulls.
    const location: LocationPayload = { latitude, longitude, ...(title !== undefined && { title }) }

    return this.send(sessionId, applyOptions({ to, type: 'location', location }, options))
  }

  sendContact(
    sessionId: number | string,
    to: string,
    contacts: Array<Record<string, unknown>>,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'contact', contacts: [...contacts] }, options))
  }

  sendPoll(
    sessionId: number | string,
    to: string,
    name: string,
    pollOptions: string[],
    multiple = false,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    const poll: PollPayload = { name, options: [...pollOptions], multiple }

    return this.send(sessionId, applyOptions({ to, type: 'poll', poll }, options))
  }

  sendButtons(
    sessionId: number | string,
    to: string,
    buttons: Array<Record<string, unknown>>,
    text: string,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'buttons', buttons, text }, options))
  }

  sendList(
    sessionId: number | string,
    to: string,
    list: Record<string, unknown>,
    text: string,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'list', list, text }, options))
  }

  sendLinkPreview(
    sessionId: number | string,
    to: string,
    text: string,
    preview: Record<string, unknown>,
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, type: 'link_preview', text, preview }, options))
  }

  sendTemplate(
    sessionId: number | string,
    to: string,
    templateId: number,
    variables: Record<string, unknown> = {},
    options: SendOptions = {},
  ): Promise<Result<Record<string, unknown>>> {
    return this.send(sessionId, applyOptions({ to, template_id: templateId, variables }, options))
  }
}
