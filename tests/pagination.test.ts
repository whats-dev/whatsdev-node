import { describe, expect, it } from 'vitest'
import { Transport } from '../src/http/transport'
import { resolveConfig } from '../src/config'
import { pageFromResponse, Paginator } from '../src/pagination'
import { WhatsDevClient } from '../src/client'
import { stubFetch } from './support/stubFetch'

const makeTransport = (fetchImpl: typeof fetch) => new Transport(resolveConfig({ apiKey: 'k' }), fetchImpl, async () => {})

describe('pageFromResponse', () => {
  it('reads a page-mode envelope', async () => {
    const { fetch } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }, { id: 2 }],
          links: { next: 'https://api.test/v1/contacts?page=2' },
          meta: { current_page: 1, last_page: 3, per_page: 2, total: 5 },
        },
      },
    ])

    const response = await makeTransport(fetch).request('GET', 'v1/contacts')
    const page = pageFromResponse<{ id: number }>(response)

    expect(page.data).toHaveLength(2)
    expect(page.meta.total).toBe(5)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBeNull()
  })

  it('reads a cursor-mode envelope', async () => {
    const { fetch } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }],
          links: { next: 'https://api.test/v1/contacts?cursor=eyJ9' },
          meta: { per_page: 1, next_cursor: 'eyJ9', prev_cursor: null },
        },
      },
    ])

    const response = await makeTransport(fetch).request('GET', 'v1/contacts')
    const page = pageFromResponse<{ id: number }>(response)

    expect(page.nextCursor).toBe('eyJ9')
    expect(page.hasMore).toBe(true)
  })

  it('reports no more pages when next is null', async () => {
    const { fetch } = stubFetch([
      { status: 200, body: { data: [], links: { next: null }, meta: { next_cursor: null } } },
    ])

    const response = await makeTransport(fetch).request('GET', 'v1/contacts')
    const page = pageFromResponse(response)

    expect(page.hasMore).toBe(false)
  })

  // A data envelope that arrives as a JSON object rather than a list still yields its members,
  // rather than reading as an empty page. Pinned on both sides so they cannot drift apart.
  it('yields the values of a data envelope that is a map', async () => {
    const { fetch } = stubFetch([
      { status: 200, body: { data: { first: { id: 1 }, second: { id: 2 } }, links: { next: null }, meta: {} } },
    ])

    const page = pageFromResponse<{ id: number }>(await makeTransport(fetch).request('GET', 'v1/contacts'))

    expect(page.data).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('reads a data envelope that is a scalar as an empty page', async () => {
    const { fetch } = stubFetch([{ status: 200, body: { data: 'oops', links: { next: null }, meta: {} } }])

    const page = pageFromResponse(await makeTransport(fetch).request('GET', 'v1/contacts'))

    expect(page.data).toEqual([])
  })
})

describe('Paginator', () => {
  it('walks every page and yields every item', async () => {
    const { fetch, calls } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }, { id: 2 }],
          links: { next: 'https://api.test/v1/contacts?cursor=p2&status=active' },
          meta: { next_cursor: 'p2' },
        },
      },
      { status: 200, body: { data: [{ id: 3 }], links: { next: null }, meta: { next_cursor: null } } },
    ])

    const transport = makeTransport(fetch)
    const ids: number[] = []

    for await (const item of new Paginator<{ id: number }>(transport, 'GET', 'v1/contacts', { status: 'active' })) {
      ids.push(item.id)
    }

    expect(ids).toEqual([1, 2, 3])
    expect(calls).toHaveLength(2)
  })

  it('follows links.next verbatim so the caller filters are never dropped', async () => {
    const { fetch, calls } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }],
          links: { next: 'https://api.test/v1/contacts?cursor=p2&status=active&per_page=1' },
          meta: { next_cursor: 'p2' },
        },
      },
      { status: 200, body: { data: [], links: { next: null }, meta: {} } },
    ])

    const transport = makeTransport(fetch)
    await new Paginator(transport, 'GET', 'v1/contacts', { status: 'active', per_page: 1 }).all()

    expect(new URL(calls[1]!.url).search).toBe('?cursor=p2&status=active&per_page=1')
  })

  // The API encodes the caller's filters into links.next, so page two is only correct if every
  // repeated bracket parameter survives the round trip out of that URL and back onto the wire.
  it('keeps every value of a repeated bracket parameter carried by links.next', async () => {
    const { fetch, calls } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }],
          links: { next: 'https://api.test/v1/contacts?tag[]=x&tag[]=y&cursor=c2' },
          meta: { next_cursor: 'c2' },
        },
      },
      { status: 200, body: { data: [], links: { next: null }, meta: {} } },
    ])

    await new Paginator(makeTransport(fetch), 'GET', 'v1/contacts', { tag: ['x', 'y'] }).all()

    expect(new URL(calls[1]!.url).search).toBe('?tag%5B0%5D=x&tag%5B1%5D=y&cursor=c2')
  })

  it('reads a nested bracket parameter out of links.next as a map', async () => {
    const { fetch, calls } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }],
          links: { next: 'https://api.test/v1/contacts?filter[type]=text&cursor=c2' },
          meta: { next_cursor: 'c2' },
        },
      },
      { status: 200, body: { data: [], links: { next: null }, meta: {} } },
    ])

    await new Paginator(makeTransport(fetch), 'GET', 'v1/contacts', {}).all()

    expect(new URL(calls[1]!.url).search).toBe('?filter%5Btype%5D=text&cursor=c2')
  })

  it('stops rather than looping forever when the server repeats a cursor', async () => {
    const { fetch, calls } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }],
          links: { next: 'https://api.test/v1/contacts?cursor=same' },
          meta: { next_cursor: 'same' },
        },
      },
    ])

    const transport = makeTransport(fetch)
    const items = await new Paginator(transport, 'GET', 'v1/contacts', {}).all()

    // Pins termination, not a count: each page yields before the repeat is detected, so 2 requests happen first.
    expect(items).toHaveLength(2)
    expect(calls).toHaveLength(2)
  })

  it('issues no request until the caller iterates', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { data: [{ id: 1 }], links: { next: null }, meta: {} } }])

    const transport = makeTransport(fetch)
    const paginator = new Paginator(transport, 'GET', 'v1/contacts', {})

    expect(calls).toHaveLength(0)

    await paginator.all()

    expect(calls).toHaveLength(1)
  })

  it('reaches an endpoint the package has no method for', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: { data: [{ id: 'g1' }] } }])
    const client = new WhatsDevClient({ apiKey: 'k', fetch })

    const body = await client.request<{ data: Array<{ id: string }> }>('GET', 'v1/sessions/7/groups', { query: { limit: 10 } })

    expect(body.data[0]!.id).toBe('g1')
    expect(calls[0]!.url).toBe('https://whats.youdev.online/v1/sessions/7/groups?limit=10')
  })
})

// Beyond the brief's six pagination cases: pins the unparseable/query-less next-link guard,
// which the PHP side only added after review — a regression here silently drops caller filters.
describe('Paginator additional coverage', () => {
  it('stops rather than dropping filters when links.next has no query string', async () => {
    const { fetch, calls } = stubFetch([
      { status: 200, body: { data: [{ id: 1 }], links: { next: 'https://api.test/v1/contacts' }, meta: {} } },
    ])

    const transport = makeTransport(fetch)
    const items = await new Paginator(transport, 'GET', 'v1/contacts', { status: 'active' }).all()

    expect(items).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('stops rather than dropping filters when links.next is unparseable', async () => {
    const { fetch, calls } = stubFetch([
      {
        status: 200,
        body: {
          data: [{ id: 1 }],
          links: { next: 'https://api.test:99999/v1/contacts?cursor=p2&status=active' },
          meta: { next_cursor: 'p2' },
        },
      },
    ])

    const transport = makeTransport(fetch)
    const items = await new Paginator(transport, 'GET', 'v1/contacts', { status: 'active' }).all()

    expect(items).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('accumulates every seen cursor, not just the last, so an alternating server still terminates', async () => {
    const { fetch, calls } = stubFetch([
      { status: 200, body: { data: [{ id: 1 }], links: { next: 'https://api.test/v1/contacts?cursor=B' }, meta: { next_cursor: 'B' } } },
      { status: 200, body: { data: [{ id: 2 }], links: { next: 'https://api.test/v1/contacts?cursor=A' }, meta: { next_cursor: 'A' } } },
      { status: 200, body: { data: [{ id: 3 }], links: { next: 'https://api.test/v1/contacts?cursor=B' }, meta: { next_cursor: 'B' } } },
    ])

    const transport = makeTransport(fetch)
    const items = await new Paginator<{ id: number }>(transport, 'GET', 'v1/contacts', {}).all()

    // A guard comparing only against the immediately-previous cursor would never see B repeat
    // (B -> A -> B alternates every step) and would loop forever; a full-history set catches it.
    expect(items.map((item) => item.id)).toEqual([1, 2, 3])
    expect(calls).toHaveLength(3)
  })

  it('follows a relative query-only links.next ("?cursor=...") so the traversal continues', async () => {
    const { fetch, calls } = stubFetch([
      { status: 200, body: { data: [{ id: 1 }], links: { next: '?cursor=p2&status=active' }, meta: { next_cursor: 'p2' } } },
      { status: 200, body: { data: [{ id: 2 }], links: { next: null }, meta: {} } },
    ])

    const transport = makeTransport(fetch)
    const items = await new Paginator(transport, 'GET', 'v1/contacts', { status: 'active' }).all()

    expect(items).toHaveLength(2)
    expect(calls).toHaveLength(2)
    expect(new URL(calls[1]!.url).search).toBe('?cursor=p2&status=active')
  })

  it('follows a relative path+query links.next ("/v1/contacts?cursor=...") so the traversal continues', async () => {
    const { fetch, calls } = stubFetch([
      {
        status: 200,
        body: { data: [{ id: 1 }], links: { next: '/v1/contacts?cursor=p2&status=active' }, meta: { next_cursor: 'p2' } },
      },
      { status: 200, body: { data: [{ id: 2 }], links: { next: null }, meta: {} } },
    ])

    const transport = makeTransport(fetch)
    const items = await new Paginator(transport, 'GET', 'v1/contacts', { status: 'active' }).all()

    expect(items).toHaveLength(2)
    expect(calls).toHaveLength(2)
    expect(new URL(calls[1]!.url).search).toBe('?cursor=p2&status=active')
  })

  it('terminates on a next link that is malformed even resolved against the base url', async () => {
    const { fetch, calls } = stubFetch([
      { status: 200, body: { data: [{ id: 1 }], links: { next: 'http://[::1' }, meta: { next_cursor: 'p2' } } },
    ])

    const transport = makeTransport(fetch)
    const items = await new Paginator(transport, 'GET', 'v1/contacts', { status: 'active' }).all()

    expect(items).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })
})
