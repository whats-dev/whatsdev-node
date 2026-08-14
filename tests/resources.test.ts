import { describe, expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'
import { MediaNotAvailableError } from '../src/errors'
import { stubFetch, type StubResponse } from './support/stubFetch'

const BASE = 'https://whats.youdev.online'
const page = (data: unknown[] = []): StubResponse => ({ status: 200, body: { data, links: { next: null }, meta: {} } })

function setup(response: StubResponse = { status: 200, body: {} }) {
  const { fetch, calls } = stubFetch([response])
  const client = new WhatsDevClient({ apiKey: 'k', fetch })
  return { client, calls }
}

describe('account', () => {
  it('reads the account and its usage', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 1 } })

    await client.account.me()
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/me`)

    await client.account.usage()
    expect(calls[1]!.method).toBe('GET')
    expect(calls[1]!.url).toBe(`${BASE}/v1/usage`)
  })
})

describe('sessions', () => {
  it('lists sessions with the query passed through', async () => {
    const { client, calls } = setup(page([{ id: 4 }]))

    const items = await client.sessions.list({ status: 'active' }).all()

    expect(items).toEqual([{ id: 4 }])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions?status=active`)
  })

  it('gets a session by id', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 4 } })

    await client.sessions.get(4)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4`)
  })

  it('creates a session', async () => {
    const { client, calls } = setup({ status: 201, body: { id: 4 } })

    const body = await client.sessions.create({ label: 'Sales' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions`)
    expect(calls[0]!.body).toEqual({ label: 'Sales' })
    expect(body).toEqual({ id: 4 })
  })

  it('passes a wrapped single-resource response through unchanged', async () => {
    const { client } = setup({ status: 201, body: { data: { id: 4, status: 'stopped' } } })

    const body = await client.sessions.create()

    expect(body).toEqual({ data: { id: 4, status: 'stopped' } })
  })

  it('deletes a session', async () => {
    const { client, calls } = setup()

    await client.sessions.delete(4)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4`)
  })

  it('fetches the qr for a session', async () => {
    const { client, calls } = setup({ status: 200, body: { qr: 'data:image/png;base64,x' } })

    await client.sessions.qr(4)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4/qr`)
  })

  it('requests a pairing code for a phone', async () => {
    const { client, calls } = setup({ status: 200, body: { code: '123-456' } })

    await client.sessions.pairingCode(4, '967700000000')

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4/pairing-code`)
    expect(calls[0]!.body).toEqual({ phone: '967700000000' })
  })

  it('restarts a session', async () => {
    const { client, calls } = setup()

    await client.sessions.restart(4)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4/restart`)
  })

  it('sets the typing indicator for a chat, mapping chatId to chat_id', async () => {
    const { client, calls } = setup()

    await client.sessions.typing(4, '967700000000@c.us', false)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4/typing`)
    expect(calls[0]!.body).toEqual({ chat_id: '967700000000@c.us', on: false })
  })

  it('defaults typing on to true', async () => {
    const { client, calls } = setup()

    await client.sessions.typing(4, '967700000000@c.us')

    expect(calls[0]!.body).toEqual({ chat_id: '967700000000@c.us', on: true })
  })

  it('marks a chat as seen, mapping chatId to chat_id', async () => {
    const { client, calls } = setup()

    await client.sessions.seen(4, '967700000000@c.us')

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4/seen`)
    expect(calls[0]!.body).toEqual({ chat_id: '967700000000@c.us' })
  })

  it('checks whether a phone exists on whatsapp', async () => {
    const { client, calls } = setup({ status: 200, body: { exists: true } })

    await client.sessions.checkExists(4, '967700000000')

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/4/check-exists?phone=967700000000`)
  })
})

describe('messages', () => {
  it('sends text with the right verb, path and body', async () => {
    const { client, calls } = setup({ status: 202, body: { id: 9 } })

    const result = await client.messages.sendText(3, '967700000000', 'hi')

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/3/messages`)
    expect(calls[0]!.body).toEqual({ to: '967700000000', type: 'text', text: 'hi' })
    expect(result.data).toEqual({ id: 9 })
  })

  it('puts an auto-generated idempotency key on every send', async () => {
    const { client, calls } = setup({ status: 202, body: { id: 9 } })

    await client.messages.sendText(3, '1', 'hi')

    expect(calls[0]!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('honours a caller-supplied idempotency key so a resumed workflow replays', async () => {
    const { client, calls } = setup({ status: 202, body: { id: 9 } })

    await client.messages.send(3, { to: '1', type: 'text', text: 'hi' }, 'my-key')

    expect(calls[0]!.headers['Idempotency-Key']).toBe('my-key')
  })

  it('serialises camelCase options to the snake_case wire format', async () => {
    const { client, calls } = setup({ status: 202, body: {} })

    await client.messages.sendText(3, '1', 'hi', { replyTo: 'abc', sendAt: '2026-09-01T10:00:00Z' })

    expect(calls[0]!.body).toMatchObject({ reply_to: 'abc', send_at: '2026-09-01T10:00:00Z' })
    expect(calls[0]!.body).not.toHaveProperty('replyTo')
    expect(calls[0]!.body).not.toHaveProperty('sendAt')
  })

  it('builds the poll payload the server validates', async () => {
    const { client, calls } = setup({ status: 202, body: {} })

    await client.messages.sendPoll(3, '1', 'Lunch?', ['A', 'B'], true)

    expect(calls[0]!.body).toEqual({
      to: '1',
      type: 'poll',
      poll: { name: 'Lunch?', options: ['A', 'B'], multiple: true },
    })
  })

  it('builds the location payload with numeric coordinates', async () => {
    const { client, calls } = setup({ status: 202, body: {} })

    await client.messages.sendLocation(3, '1', 15.35, 44.2, 'Sanaa')

    expect(calls[0]!.body).toEqual({
      to: '1',
      type: 'location',
      location: { latitude: 15.35, longitude: 44.2, title: 'Sanaa' },
    })
  })

  it('omits a null location title rather than sending it as null', async () => {
    const { client, calls } = setup({ status: 202, body: {} })

    await client.messages.sendLocation(3, '1', 15.35, 44.2)

    expect(calls[0]!.body).toEqual({ to: '1', type: 'location', location: { latitude: 15.35, longitude: 44.2 } })
  })

  it('sends a templated message with variables and no text', async () => {
    const { client, calls } = setup({ status: 202, body: {} })

    await client.messages.sendTemplate(3, '1', 12, { name: 'Ali' })

    expect(calls[0]!.body).toEqual({ to: '1', template_id: 12, variables: { name: 'Ali' } })
    expect(calls[0]!.body).not.toHaveProperty('text')
    expect(calls[0]!.body).not.toHaveProperty('type')
  })

  it('paginates a session message list', async () => {
    const { client, calls } = setup(page([{ id: 1 }]))

    const items = await client.messages.list(3, { type: 'text' }).all()

    expect(items).toEqual([{ id: 1 }])
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/3/messages?type=text`)
  })

  it('gets a single message by id, not to be confused with its media', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 9 } })

    await client.messages.get(9)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/9`)
  })

  it('gets media for a message by id, not to be confused with the message itself', async () => {
    const { client, calls } = setup({ status: 200, body: { url: 'https://example.com/f.jpg' } })

    await client.messages.media(9)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/media/9`)
  })

  // The endpoint streams the stored file, so JSON decoding it discards the only thing the caller
  // asked for. These pin that media() hands back the bytes themselves.
  it('hands back the raw bytes and the content type of a downloaded file', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xc3, 0x28])
    const fetchImpl = (async () =>
      new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png' } })) as typeof fetch
    const client = new WhatsDevClient({ apiKey: 'k', fetch: fetchImpl })

    const file = await client.messages.media(9)

    // 0xC3 0x28 is invalid UTF-8: decoding to text would replace it and the bytes would not survive.
    expect(file.bytes).toEqual(bytes)
    expect(file.bytes.byteLength).toBe(bytes.byteLength)
    expect(file.contentType).toBe('image/png')
  })

  it('leaves the content type null when the server does not name one', async () => {
    const fetchImpl = (async () => new Response(new Uint8Array([1, 2]), { status: 200 })) as typeof fetch
    const client = new WhatsDevClient({ apiKey: 'k', fetch: fetchImpl })

    expect((await client.messages.media(9)).contentType).toBeNull()
  })

  it('does not lose bytes that happen to parse as json', async () => {
    const { client } = setup({ status: 200, body: { a: 1 } })

    expect(new TextDecoder().decode((await client.messages.media(9)).bytes)).toBe('{"a":1}')
  })

  it('still raises the typed error when the media has expired', async () => {
    const { client } = setup({ status: 410, body: { error: { code: 'media_not_available', message: 'gone' } } })

    await expect(client.messages.media(9)).rejects.toBeInstanceOf(MediaNotAvailableError)
  })

  it.each([
    ['sendImage', 'image'],
    ['sendVideo', 'video'],
    ['sendVoice', 'voice'],
    ['sendDocument', 'document'],
  ] as const)('sends media messages via %s with caption and asNote mapped to as_note', async (method, type) => {
    const { client, calls } = setup({ status: 202, body: {} })
    const media = { url: 'https://example.com/f.jpg', mimetype: 'image/jpeg', filename: 'f.jpg' }

    await client.messages[method](3, '1', media, { caption: 'Look', asNote: true })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/3/messages`)
    expect(calls[0]!.body).toEqual({ to: '1', type, media, caption: 'Look', as_note: true })
  })

  it('sends a contact payload as a non-empty list', async () => {
    const { client, calls } = setup({ status: 202, body: {} })
    const contacts = [{ name: 'Ali', phone: '967700000000' }]

    await client.messages.sendContact(3, '1', contacts)

    expect(calls[0]!.body).toEqual({ to: '1', type: 'contact', contacts })
  })

  it('builds the buttons payload the server validates', async () => {
    const { client, calls } = setup({ status: 202, body: {} })
    const buttons = [{ id: '1', title: 'Yes' }, { id: '2', title: 'No' }]

    await client.messages.sendButtons(3, '1', buttons, 'Confirm?')

    expect(calls[0]!.body).toEqual({ to: '1', type: 'buttons', buttons, text: 'Confirm?' })
  })

  it('builds the list payload the server validates', async () => {
    const { client, calls } = setup({ status: 202, body: {} })
    const list = { title: 'Menu', sections: [{ title: 'Drinks', rows: [{ id: '1', title: 'Tea' }] }] }

    await client.messages.sendList(3, '1', list, 'Choose one')

    expect(calls[0]!.body).toEqual({ to: '1', type: 'list', list, text: 'Choose one' })
  })

  it('builds the link preview payload with the required preview data', async () => {
    const { client, calls } = setup({ status: 202, body: {} })
    const preview = { url: 'https://example.com', title: 'Example' }

    await client.messages.sendLinkPreview(3, '1', 'Check this out', preview)

    expect(calls[0]!.body).toEqual({ to: '1', type: 'link_preview', text: 'Check this out', preview })
  })
})

describe('messageOps', () => {
  it('forwards with an idempotency key because a forward is a real send', async () => {
    const { client, calls } = setup({ status: 202, body: { id: 11 } })

    await client.messageOps.forward(5, '967700000000')

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/5/forward`)
    expect(calls[0]!.body).toEqual({ to: '967700000000' })
    expect(calls[0]!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('honours a caller-supplied forward idempotency key', async () => {
    const { client, calls } = setup({ status: 202, body: {} })

    await client.messageOps.forward(5, '1', 'fwd-key')

    expect(calls[0]!.headers['Idempotency-Key']).toBe('fwd-key')
  })

  it('reacts to a message with an emoji', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.messageOps.react(5, '👍')

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/5/reaction`)
    expect(calls[0]!.body).toEqual({ emoji: '👍' })
  })

  it.each([
    ['star', 'star'],
    ['unstar', 'unstar'],
  ] as const)('%s a message', async (method, suffix) => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.messageOps[method](5)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/5/${suffix}`)
  })

  it('edits a message with PUT', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.messageOps.edit(5, 'fixed typo')

    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/5`)
    expect(calls[0]!.body).toEqual({ text: 'fixed typo' })
  })

  it('deletes a message with DELETE', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.messageOps.delete(5)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/5`)
  })

  it('omits a null pin duration rather than sending null', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.messageOps.pin(5)

    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/5/pin`)
    expect(calls[0]!.body).toEqual({})
  })

  it('carries an explicit pin duration when given', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.messageOps.pin(5, 3600)

    expect(calls[0]!.body).toEqual({ duration: 3600 })
  })

  it('unpins a message', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.messageOps.unpin(5)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/5/unpin`)
  })
})

describe('scheduledMessages', () => {
  it('lists scheduled messages', async () => {
    const { client, calls } = setup(page([{ id: 77 }]))

    const items = await client.scheduledMessages.list({ status: 'pending' }).all()

    expect(items).toEqual([{ id: 77 }])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/scheduled-messages?status=pending`)
  })

  it('gets a single scheduled message by id', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 77 } })

    await client.scheduledMessages.get(77)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/scheduled-messages/77`)
  })

  it('cancels a scheduled message with DELETE', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.scheduledMessages.cancel(77)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/scheduled-messages/77`)
  })
})

describe('webhooks', () => {
  it('lists webhooks', async () => {
    const { client, calls } = setup(page([{ id: 2 }]))

    const items = await client.webhooks.list().all()

    expect(items).toEqual([{ id: 2 }])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks`)
  })

  it('creates a webhook', async () => {
    const { client, calls } = setup({ status: 200, body: { data: [] } })

    await client.webhooks.create({ url: 'https://hooks.test/wa', events: ['message'] })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks`)
    expect(calls[0]!.body).toEqual({ url: 'https://hooks.test/wa', events: ['message'] })
  })

  it('gets a webhook by id', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 2 } })

    await client.webhooks.get(2)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks/2`)
  })

  it('updates a webhook with PUT, not PATCH', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.webhooks.update(2, { events: ['message', 'message.status'] })

    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks/2`)
    expect(calls[0]!.body).toEqual({ events: ['message', 'message.status'] })
  })

  it('deletes a webhook', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.webhooks.delete(2)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks/2`)
  })

  it('rotates a webhook secret', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.webhooks.rotateSecret(2)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks/2/rotate-secret`)
  })

  it('paginates deliveries', async () => {
    const { client, calls } = setup(page([{ id: 1 }]))

    const items = await client.webhooks.deliveries(2).all()

    expect(items).toEqual([{ id: 1 }])
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks/2/deliveries`)
  })

  it('retries a delivery', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.webhooks.retryDelivery(2, 9)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/webhooks/2/deliveries/9/retry`)
  })
})

describe('contacts', () => {
  it('lists contacts with the query passed through', async () => {
    const { client, calls } = setup(page([{ id: 4 }]))

    const items = await client.contacts.list({ q: 'ali' }).all()

    expect(items).toEqual([{ id: 4 }])
    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts?q=ali`)
  })

  it('creates a contact', async () => {
    const { client, calls } = setup({ status: 201, body: { id: 4 } })

    await client.contacts.create({ phone: '967700000000', name: 'Ali' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts`)
    expect(calls[0]!.body).toEqual({ phone: '967700000000', name: 'Ali' })
  })

  it('sends batch contacts under a contacts key', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contacts.batch([{ phone: '1' }, { phone: '2' }])

    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts/batch`)
    expect(calls[0]!.body).toEqual({ contacts: [{ phone: '1' }, { phone: '2' }] })
  })

  it('merges batch options alongside the contacts key', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contacts.batch([{ phone: '1' }], { list_id: 9 })

    expect(calls[0]!.body).toEqual({ contacts: [{ phone: '1' }], list_id: 9 })
  })

  it('gets a contact by id', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 4 } })

    await client.contacts.get(4)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts/4`)
  })

  it('updates a contact with PATCH, not PUT', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contacts.update(4, { name: 'Ali' })

    expect(calls[0]!.method).toBe('PATCH')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts/4`)
    expect(calls[0]!.body).toEqual({ name: 'Ali' })
  })

  it('deletes a contact', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contacts.delete(4)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts/4`)
  })
})

describe('contactLists', () => {
  it('lists contact lists', async () => {
    const { client, calls } = setup(page([{ id: 2 }]))

    const items = await client.contactLists.list().all()

    expect(items).toEqual([{ id: 2 }])
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists`)
  })

  it('creates a contact list', async () => {
    const { client, calls } = setup({ status: 201, body: { id: 2 } })

    await client.contactLists.create({ name: 'VIP' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists`)
    expect(calls[0]!.body).toEqual({ name: 'VIP' })
  })

  it('gets a contact list by id', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 2 } })

    await client.contactLists.get(2)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists/2`)
  })

  it('updates a contact list with PATCH, not PUT', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contactLists.update(2, { name: 'VIP+' })

    expect(calls[0]!.method).toBe('PATCH')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists/2`)
    expect(calls[0]!.body).toEqual({ name: 'VIP+' })
  })

  it('deletes a contact list', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contactLists.delete(2)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists/2`)
  })

  it('lists the contacts on a list', async () => {
    const { client, calls } = setup(page([{ id: 7 }]))

    const items = await client.contactLists.contacts(2).all()

    expect(items).toEqual([{ id: 7 }])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists/2/contacts`)
  })

  it('attaches contacts to a list through the body, mapping contactIds to contact_ids', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contactLists.attach(2, [7, 8])

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists/2/contacts`)
    expect(calls[0]!.body).toEqual({ contact_ids: [7, 8] })
  })

  it('detaches list members through the body, not the query string', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contactLists.detach(2, [7, 8])

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-lists/2/contacts`)
    expect(calls[0]!.body).toEqual({ contact_ids: [7, 8] })
  })
})

describe('contactFields', () => {
  it('lists contact fields', async () => {
    const { client, calls } = setup(page([{ id: 5 }]))

    const items = await client.contactFields.list().all()

    expect(items).toEqual([{ id: 5 }])
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-fields`)
  })

  it('creates a contact field', async () => {
    const { client, calls } = setup({ status: 201, body: { id: 5 } })

    await client.contactFields.create({ key: 'birthday', type: 'date' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-fields`)
    expect(calls[0]!.body).toEqual({ key: 'birthday', type: 'date' })
  })

  it('updates a contact field with PATCH, not PUT', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contactFields.update(5, { type: 'text' })

    expect(calls[0]!.method).toBe('PATCH')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-fields/5`)
    expect(calls[0]!.body).toEqual({ type: 'text' })
  })

  it('deletes a contact field', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.contactFields.delete(5)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/contact-fields/5`)
  })
})

describe('bulk', () => {
  it('creates a campaign against the session and carries an idempotency key', async () => {
    const { client, calls } = setup({ status: 202, body: { id: 3 } })

    const result = await client.bulk.create(6, { type: 'text', text: 'hi', list_ids: [1] })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sessions/6/bulk`)
    expect(calls[0]!.body).toEqual({ type: 'text', text: 'hi', list_ids: [1] })
    expect(calls[0]!.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.data).toEqual({ id: 3 })
  })

  it('reuses a caller key so a retried campaign replays instead of duplicating', async () => {
    const { client, calls } = setup({ status: 202, body: { id: 3 } })

    await client.bulk.create(6, { type: 'text' }, 'campaign-42')

    expect(calls[0]!.headers['Idempotency-Key']).toBe('campaign-42')
  })

  it('lists bulk campaigns', async () => {
    const { client, calls } = setup(page([{ id: 3 }]))

    const items = await client.bulk.list().all()

    expect(items).toEqual([{ id: 3 }])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/bulk`)
  })

  it('gets a bulk campaign by id', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 3 } })

    await client.bulk.get(3)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/bulk/3`)
  })

  it('lists recipients for a bulk campaign', async () => {
    const { client, calls } = setup(page([{ id: 1 }]))

    const items = await client.bulk.recipients(3).all()

    expect(items).toEqual([{ id: 1 }])
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/bulk/3/recipients`)
  })

  it('pauses a campaign', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.bulk.pause(3)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/bulk/3/pause`)
  })

  it('resumes a campaign', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.bulk.resume(3)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/bulk/3/resume`)
  })

  it('cancels a campaign', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.bulk.cancel(3)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/bulk/3/cancel`)
  })
})

describe('templates', () => {
  it('lists templates', async () => {
    const { client, calls } = setup(page([{ id: 3 }]))

    const items = await client.templates.list().all()

    expect(items).toEqual([{ id: 3 }])
    expect(calls[0]!.url).toBe(`${BASE}/v1/templates`)
  })

  it('creates a template', async () => {
    const { client, calls } = setup({ status: 201, body: { id: 3 } })

    await client.templates.create({ name: 'welcome', body: 'Hi {{name}}' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/templates`)
    expect(calls[0]!.body).toEqual({ name: 'welcome', body: 'Hi {{name}}' })
  })

  it('gets a template by id', async () => {
    const { client, calls } = setup({ status: 200, body: { id: 3 } })

    await client.templates.get(3)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe(`${BASE}/v1/templates/3`)
  })

  it('updates a template with PATCH, not PUT', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.templates.update(3, { body: 'Hello {{name}}' })

    expect(calls[0]!.method).toBe('PATCH')
    expect(calls[0]!.url).toBe(`${BASE}/v1/templates/3`)
    expect(calls[0]!.body).toEqual({ body: 'Hello {{name}}' })
  })

  it('deletes a template', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.templates.delete(3)

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/templates/3`)
  })

  it('previews a template with variables', async () => {
    const { client, calls } = setup({ status: 200, body: { body: 'Hello Ali' } })

    await client.templates.preview(3, { name: 'Ali' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/templates/3/preview`)
    expect(calls[0]!.body).toEqual({ variables: { name: 'Ali' } })
  })
})

describe('suppressions', () => {
  it('lists suppressions', async () => {
    const { client, calls } = setup(page([{ phone: '1' }]))

    const items = await client.suppressions.list().all()

    expect(items).toEqual([{ phone: '1' }])
    expect(calls[0]!.url).toBe(`${BASE}/v1/suppressions`)
  })

  it('creates a suppression', async () => {
    const { client, calls } = setup({ status: 201, body: { phone: '967700000000' } })

    await client.suppressions.create({ phone: '967700000000', reason: 'opt_out' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/suppressions`)
    expect(calls[0]!.body).toEqual({ phone: '967700000000', reason: 'opt_out' })
  })

  it('escapes a phone number in the suppression path', async () => {
    const { client, calls } = setup({ status: 200, body: {} })

    await client.suppressions.delete('+967 700000000')

    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(`${BASE}/v1/suppressions/%2B967%20700000000`)
  })
})

describe('sandbox', () => {
  it('simulates an inbound message in the sandbox', async () => {
    const { client, calls } = setup({ status: 202, body: { id: 1 } })

    await client.sandbox.simulateInbound({ sessionId: 3, from: '967700000000', text: 'hello' })

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe(`${BASE}/v1/sandbox/inbound`)
    expect(calls[0]!.body).toEqual({ session_id: 3, from: '967700000000', text: 'hello' })
  })
})

// Five endpoints answer 204 with no body at all, and the declared return type of every resource
// method is Record<string, unknown>. Handing back undefined makes that type a lie TypeScript
// cannot warn about: Object.keys(await client.contacts.delete(1)) throws at runtime instead.
describe('no content', () => {
  const noContent = (): StubResponse => ({ status: 204 })

  it.each([
    ['suppressions.delete', (client: WhatsDevClient) => client.suppressions.delete('967700000000')],
    ['templates.delete', (client: WhatsDevClient) => client.templates.delete(1)],
    ['contactLists.delete', (client: WhatsDevClient) => client.contactLists.delete(1)],
    ['contacts.delete', (client: WhatsDevClient) => client.contacts.delete(1)],
    ['contactFields.delete', (client: WhatsDevClient) => client.contactFields.delete(1)],
  ])('returns an empty object from %s on a 204', async (_name, call) => {
    const { client, calls } = setup(noContent())

    const body = await call(client)

    expect(body).toEqual({})
    expect(Object.keys(body)).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('returns an empty object from the escape hatch on a 204', async () => {
    const { client } = setup(noContent())

    expect(await client.request('DELETE', 'v1/sessions/7/groups/g1')).toEqual({})
  })

  it('returns an empty object from a body that is not json at all', async () => {
    const fetchImpl = (async () =>
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } })) as typeof fetch
    const client = new WhatsDevClient({ apiKey: 'k', fetch: fetchImpl })

    expect(await client.account.me()).toEqual({})
  })

  it('carries an empty object as a Result data on a 204', async () => {
    const { client } = setup({ status: 204, headers: { 'X-Request-Id': 'req-9' } })

    const result = await client.messages.send(3, { to: '1' })

    expect(result.data).toEqual({})
    expect(result.requestId).toBe('req-9')
  })
})
