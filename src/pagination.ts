import type { ApiResponse, Transport } from './http/transport'

export interface Page<T> {
  data: T[]
  meta: Record<string, unknown>
  links: Record<string, string | null>
  nextCursor: string | null
  hasMore: boolean
}

export function pageFromResponse<T>(response: ApiResponse<unknown>): Page<T> {
  const body = isRecord(response.body) ? response.body : {}
  const meta = isRecord(body.meta) ? body.meta : {}
  const links = isRecord(body.links) ? (body.links as Record<string, string | null>) : {}
  const cursor = meta.next_cursor

  return {
    // An object-shaped data envelope yields its values; reading it as empty would lose the page.
    data: itemsOf(body.data),
    meta,
    links,
    nextCursor: typeof cursor === 'string' ? cursor : null,
    hasMore: (links.next ?? null) !== null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemsOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[]
  }

  return isRecord(data) ? (Object.values(data) as T[]) : []
}

// The server encodes the caller's filters into links.next, so a rebuilt URL would drop them on
// page two; resolved against baseUrl so a relative link still parses rather than ending the walk.
function queryFrom(url: string, baseUrl: string): Record<string, unknown> {
  try {
    const query: Record<string, unknown> = {}
    for (const [key, value] of new URL(url, baseUrl).searchParams.entries()) {
      assign(query, segmentsOf(key), value)
    }
    return query
  } catch {
    return {}
  }
}

/**
 * Mirrors PHP's parse_str(): searchParams.entries() hands back tag[] twice, and writing that
 * straight into an object kept only the last value, so page two asked for half the filter.
 */
function segmentsOf(key: string): string[] {
  const start = key.indexOf('[')

  if (start === -1 || !key.endsWith(']')) {
    return [key]
  }

  const brackets = key.slice(start).match(/\[[^[\]]*\]/g)

  // A key like a[b]c[d] is not bracket notation at all; PHP leaves such a key alone and so do we.
  if (brackets === null || brackets.join('') !== key.slice(start)) {
    return [key]
  }

  return [key.slice(0, start), ...brackets.map((bracket) => bracket.slice(1, -1))]
}

function assign(target: Record<string, unknown>, segments: string[], value: string): void {
  let container = target

  for (const segment of segments.slice(0, -1)) {
    const key = nextKey(container, segment)

    if (typeof container[key] !== 'object' || container[key] === null) {
      container[key] = {}
    }

    container = container[key] as Record<string, unknown>
  }

  container[nextKey(container, segments[segments.length - 1]!)] = value
}

// An empty segment appends at the container's current count, which reserialises as tag[0], tag[1].
function nextKey(container: Record<string, unknown>, segment: string): string {
  return segment === '' ? String(Object.keys(container).length) : segment
}

export class Paginator<T> implements AsyncIterable<T> {
  constructor(
    private readonly transport: Transport,
    private readonly method: string,
    private readonly path: string,
    private readonly query: Record<string, unknown> = {},
  ) {}

  async *pages(): AsyncGenerator<Page<T>> {
    let query = this.query
    const seen = new Set<string>()

    while (true) {
      const response = await this.transport.request<unknown>(this.method, this.path, { query })
      const page = pageFromResponse<T>(response)

      yield page

      const next = page.links.next ?? null
      if (typeof next !== 'string' || next === '') {
        return
      }

      const nextQuery = queryFrom(next, this.transport.baseUrl)

      // An unparseable or query-less next link would otherwise strip the caller's filters on the next request.
      if (Object.keys(nextQuery).length === 0) {
        return
      }

      const fingerprint = JSON.stringify(nextQuery)

      // A server that hands back the cursor it was just given would otherwise spin forever.
      if (seen.has(fingerprint)) {
        return
      }

      seen.add(fingerprint)
      query = nextQuery
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for await (const page of this.pages()) {
      yield* page.data
    }
  }

  async all(): Promise<T[]> {
    const items: T[] = []
    for await (const item of this) {
      items.push(item)
    }
    return items
  }
}
