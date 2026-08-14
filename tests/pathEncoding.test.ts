import { describe, expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'
import { Paginator } from '../src/pagination'
import { Resource } from '../src/resources/base'
import { stubFetch, type RecordedCall, type StubResponse } from './support/stubFetch'

// A consumer forwarding an untrusted route parameter is the shape this guards: a caller-supplied
// value must stay inside the path segment it was interpolated into, or a message-scoped delete
// becomes a session delete, authenticated with the account's own key.
const TRAVERSAL = '../../v1/sessions/9?admin=1'
const BASE = 'https://whats.youdev.online'
const OK: StubResponse = { status: 200, body: { data: [], links: { next: null }, meta: {} } }

function setup(): { client: WhatsDevClient; calls: RecordedCall[] } {
  const { fetch, calls } = stubFetch([OK])

  return { client: new WhatsDevClient({ apiKey: 'k', fetch }), calls }
}

describe('path encoding', () => {
  it('keeps a traversal attempt inside the segment it was interpolated into', async () => {
    const { client, calls } = setup()

    await client.messageOps.delete(TRAVERSAL)

    expect(calls[0]!.url).toBe(`${BASE}/v1/messages/..%2F..%2Fv1%2Fsessions%2F9%3Fadmin%3D1`)
  })

  it('keeps an injected query parameter out of the query string', async () => {
    const { client, calls } = setup()

    await client.contacts.get('1?admin=1')

    expect(calls[0]!.url).toBe(`${BASE}/v1/contacts/1%3Fadmin%3D1`)
    expect([...new URL(calls[0]!.url).searchParams.keys()]).toEqual([])
  })

  it('encodes a phone number that carries a plus', async () => {
    const { client, calls } = setup()

    await client.suppressions.delete('+967 700000000')

    expect(calls[0]!.url).toBe(`${BASE}/v1/suppressions/%2B967%20700000000`)
  })

  // The sweep. Every public resource method is invoked twice — once with an ordinary value, once
  // with a traversal payload — and the two URLs must have the same shape: same number of path
  // segments, same set of query keys. A single unencoded interpolation anywhere in src/resources/
  // fails this, which is what makes it a completeness proof rather than a spot check.
  it('encodes every caller-supplied path segment in every resource method', async () => {
    const walk = async (sentinel: string): Promise<Map<string, URL>> => {
      const { client, calls } = setup()
      const urls = new Map<string, URL>()
      const names = Object.getOwnPropertyNames(client).filter(
        (name) => (client as unknown as Record<string, unknown>)[name] instanceof Resource,
      )

      for (const name of names) {
        const resource = (client as unknown as Record<string, Record<string, unknown>>)[name]!

        for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(resource) as object)) {
          if (method === 'constructor') {
            continue
          }

          const fn = resource[method] as (...args: unknown[]) => unknown
          // A string wherever one is accepted: that is the shape a forwarded route parameter takes.
          const returned = fn.apply(
            resource,
            Array.from({ length: fn.length }, () => sentinel),
          )

          // The paginator is lazy by design and issues nothing until a page is pulled.
          if (returned instanceof Paginator) {
            await returned.pages().next()
          } else {
            await returned
          }

          urls.set(`${name}.${method}`, new URL(calls[calls.length - 1]!.url))
        }
      }

      return urls
    }

    const ordinary = await walk('ordinary')
    const hostile = await walk(TRAVERSAL)
    const escaped: string[] = []

    for (const [where, url] of hostile) {
      const benign = ordinary.get(where)!
      const sameDepth = url.pathname.split('/').length === benign.pathname.split('/').length
      const sameQueryKeys =
        [...url.searchParams.keys()].sort().join(',') === [...benign.searchParams.keys()].sort().join(',')

      if (!sameDepth || !sameQueryKeys) {
        escaped.push(`${where} issues ${url.pathname}${url.search}`)
      }
    }

    expect(hostile.size, 'The sweep walked almost nothing, so silence would have read as safety.').toBeGreaterThan(50)
    expect(escaped, `These methods let a caller-supplied value escape its path segment: ${escaped.join('; ')}`).toEqual([])
  })
})
