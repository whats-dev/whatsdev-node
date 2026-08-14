export interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  // The body exactly as it was handed to fetch. `body` above is re-parsed, so it can never show
  // the difference between {} and [] — which is the whole shape of the empty-body divergence.
  rawBody: unknown
  redirect?: RequestInit['redirect']
}

export interface StubResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

type StubEntry = StubResponse | (() => never)

// The last entry repeats, so a retry test can queue one failure without counting attempts.
export function stubFetch(responses: StubEntry[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const queue = [...responses]
  const calls: RecordedCall[] = []

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
    const rawBody = init?.body
    const body = typeof rawBody === 'string' ? parseBody(rawBody) : rawBody

    calls.push({ url, method, headers, body, rawBody, redirect: init?.redirect })

    const next = queue.length > 1 ? queue.shift()! : queue[0]

    if (next === undefined) {
      throw new Error('stubFetch ran out of responses.')
    }

    if (typeof next === 'function') {
      return next()
    }

    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    })
  }) as typeof fetch

  return { fetch: fetchImpl, calls }
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
