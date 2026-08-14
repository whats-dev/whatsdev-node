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
    data: Array.isArray(body.data) ? (body.data as T[]) : [],
    meta,
    links,
    nextCursor: typeof cursor === 'string' ? cursor : null,
    hasMore: (links.next ?? null) !== null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Parses a links.next URL's query string rather than rebuilding one, because the server
// encodes the caller's filters into that URL. A rebuild would silently drop them on page two.
function queryFrom(url: string): Record<string, string> {
  try {
    const query: Record<string, string> = {}
    for (const [key, value] of new URL(url).searchParams.entries()) {
      query[key] = value
    }
    return query
  } catch {
    return {}
  }
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

      const nextQuery = queryFrom(next)

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
