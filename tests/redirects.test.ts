import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'
import { ApiError, UnexpectedRedirectError } from '../src/errors'
import { stubFetch } from './support/stubFetch'

interface Hit {
  url: string
  body: string
}

// A real loopback server, because the hazard is what fetch does on its own: with no redirect
// option it follows a 307 and re-sends the entire POST body to the target. Only three methods
// attach an Idempotency-Key, so every other write would be re-executed with no dedup — the
// "sent twice" hazard the idempotency gate exists to prevent, bypassed one layer below it.
async function redirectingServer(): Promise<{ baseUrl: string; hits: Hit[]; close: () => Promise<void> }> {
  const hits: Hit[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      hits.push({ url: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') })

      if (request.url === '/v1/sessions/1/messages') {
        response.writeHead(307, { Location: '/v1/elsewhere' })
        response.end()

        return
      }

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"id":1}')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('redirect policy', () => {
  it.each([301, 302, 307])('raises a typed error for a %i instead of following it', async (status) => {
    const { fetch, calls } = stubFetch([
      { status, headers: { Location: 'https://elsewhere.test/v1/sessions/9' } },
      { status: 200, body: { ok: true } },
    ])
    const client = new WhatsDevClient({ apiKey: 'k', fetch })

    const failure = await client.messages.send(1, { to: '1' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(UnexpectedRedirectError)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as UnexpectedRedirectError).status).toBe(status)
    expect((failure as UnexpectedRedirectError).code).toBe('unexpected_redirect')
    expect((failure as UnexpectedRedirectError).message).toContain('https://elsewhere.test/v1/sessions/9')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.redirect).toBe('manual')
  })

  it('does not re-send a POST body to the redirect target', async () => {
    const server = await redirectingServer()

    try {
      const client = new WhatsDevClient({ apiKey: 'k', baseUrl: server.baseUrl })
      const failure = await client.messages.sendText(1, '967700000000', 'hello').catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(UnexpectedRedirectError)
      expect(server.hits).toHaveLength(1)
      expect(server.hits[0]!.url).toBe('/v1/sessions/1/messages')
      expect(server.hits.filter((hit) => hit.body.includes('hello'))).toHaveLength(1)
    } finally {
      await server.close()
    }
  })
})
