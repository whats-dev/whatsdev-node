import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'
import { Paginator } from '../src/pagination'
import { stubFetch, type RecordedCall, type StubResponse } from './support/stubFetch'

interface Endpoint {
  method: string
  path: string
}

// sdks/endpoints.json is the contract the main application's SdkEndpointCoverageTest holds the API
// to. These tests hold it to the SDK from this side: it must describe exactly the requests this
// package issues — no more, no less.
const manifest = JSON.parse(readFileSync(new URL('../../endpoints.json', import.meta.url), 'utf8')) as {
  version: number
  endpoints: Endpoint[]
}

const RESOURCES = [
  'account',
  'sessions',
  'messages',
  'messageOps',
  'scheduledMessages',
  'webhooks',
  'sandbox',
  'contacts',
  'contactLists',
  'contactFields',
  'bulk',
  'templates',
  'suppressions',
] as const

type ResourceName = (typeof RESOURCES)[number]

// TypeScript types are erased at runtime, so arguments cannot be synthesized by reflection the way
// the PHP suite does. One explicit row per method is reviewable and deterministic; the coverage
// test below fails loudly when a method has no row, which is what keeps this table from drifting.
const INVOCATIONS: Array<[ResourceName, string, unknown[]]> = [
  ['account', 'me', []],
  ['account', 'usage', []],
  ['sessions', 'list', [{}]],
  ['sessions', 'get', [1]],
  ['sessions', 'create', [{}]],
  ['sessions', 'delete', [1]],
  ['sessions', 'qr', [1]],
  ['sessions', 'pairingCode', [1, '967700000000']],
  ['sessions', 'restart', [1]],
  ['sessions', 'typing', [1, 'x']],
  ['sessions', 'seen', [1, 'x']],
  ['sessions', 'checkExists', [1, '967700000000']],
  ['messages', 'list', [1, {}]],
  ['messages', 'get', [1]],
  ['messages', 'media', [1]],
  ['messages', 'send', [1, {}]],
  ['messages', 'sendText', [1, 'x', 'hello']],
  ['messages', 'sendImage', [1, 'x', {}]],
  ['messages', 'sendVideo', [1, 'x', {}]],
  ['messages', 'sendVoice', [1, 'x', {}]],
  ['messages', 'sendDocument', [1, 'x', {}]],
  ['messages', 'sendLocation', [1, 'x', 1.5, 2.5]],
  ['messages', 'sendContact', [1, 'x', []]],
  ['messages', 'sendPoll', [1, 'x', 'q', ['a', 'b']]],
  ['messages', 'sendButtons', [1, 'x', [], 'text']],
  ['messages', 'sendList', [1, 'x', {}, 'text']],
  ['messages', 'sendLinkPreview', [1, 'x', 'text', {}]],
  ['messages', 'sendTemplate', [1, 'x', 7]],
  ['messageOps', 'forward', [1, 'x']],
  ['messageOps', 'react', [1, '👍']],
  ['messageOps', 'star', [1]],
  ['messageOps', 'unstar', [1]],
  ['messageOps', 'edit', [1, 'text']],
  ['messageOps', 'delete', [1]],
  ['messageOps', 'pin', [1]],
  ['messageOps', 'unpin', [1]],
  ['scheduledMessages', 'list', [{}]],
  ['scheduledMessages', 'get', [1]],
  ['scheduledMessages', 'cancel', [1]],
  ['webhooks', 'list', [{}]],
  ['webhooks', 'create', [{}]],
  ['webhooks', 'get', [1]],
  ['webhooks', 'update', [1, {}]],
  ['webhooks', 'delete', [1]],
  ['webhooks', 'rotateSecret', [1]],
  ['webhooks', 'deliveries', [1, {}]],
  ['webhooks', 'retryDelivery', [1, 2]],
  ['sandbox', 'simulateInbound', [{ sessionId: 1, from: 'x' }]],
  ['contacts', 'list', [{}]],
  ['contacts', 'create', [{}]],
  ['contacts', 'batch', [[]]],
  ['contacts', 'get', [1]],
  ['contacts', 'update', [1, {}]],
  ['contacts', 'delete', [1]],
  ['contactLists', 'list', [{}]],
  ['contactLists', 'create', [{}]],
  ['contactLists', 'get', [1]],
  ['contactLists', 'update', [1, {}]],
  ['contactLists', 'delete', [1]],
  ['contactLists', 'contacts', [1, {}]],
  ['contactLists', 'attach', [1, []]],
  ['contactLists', 'detach', [1, []]],
  ['contactFields', 'list', [{}]],
  ['contactFields', 'create', [{}]],
  ['contactFields', 'update', [1, {}]],
  ['contactFields', 'delete', [1]],
  ['bulk', 'create', [1, {}]],
  ['bulk', 'list', [{}]],
  ['bulk', 'get', [1]],
  ['bulk', 'recipients', [1, {}]],
  ['bulk', 'pause', [1]],
  ['bulk', 'resume', [1]],
  ['bulk', 'cancel', [1]],
  ['templates', 'list', [{}]],
  ['templates', 'create', [{}]],
  ['templates', 'get', [1]],
  ['templates', 'update', [1, {}]],
  ['templates', 'delete', [1]],
  ['templates', 'preview', [1]],
  ['suppressions', 'list', [{}]],
  ['suppressions', 'create', [{}]],
  ['suppressions', 'delete', ['967700000000']],
]

const OK: StubResponse = { status: 200, body: { data: [], links: { next: null }, meta: {} } }

function publicMethods(instance: object): string[] {
  return Object.getOwnPropertyNames(Object.getPrototypeOf(instance) as object).filter((name) => name !== 'constructor')
}

function setup(): { client: WhatsDevClient; calls: RecordedCall[] } {
  const { fetch, calls } = stubFetch([OK])

  return { client: new WhatsDevClient({ apiKey: 'k', fetch }), calls }
}

function matches(endpoint: Endpoint, method: string, path: string): boolean {
  if (endpoint.method !== method) {
    return false
  }

  const pattern = endpoint.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[a-z_]+\\\}/g, '[^/]+')

  return new RegExp(`^${pattern}$`).test(path)
}

describe('endpoint manifest', () => {
  it('lists 70 tier-one endpoints', () => {
    const pairs = manifest.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    const malformed = manifest.endpoints.filter((endpoint) => !/^v1\/[a-z0-9\-/{}_]+$/.test(endpoint.path))

    expect(manifest.endpoints).toHaveLength(70)
    expect(new Set(pairs).size, 'The manifest holds duplicate method+path entries.').toBe(70)
    expect(malformed, 'Malformed manifest paths.').toEqual([])
  })

  it('has an invocation row for every public resource method', () => {
    const { client } = setup()
    const uncovered: string[] = []
    const stale: string[] = []

    for (const name of RESOURCES) {
      for (const method of publicMethods(client[name])) {
        if (!INVOCATIONS.some(([resource, invoked]) => resource === name && invoked === method)) {
          uncovered.push(`${name}.${method}`)
        }
      }
    }

    for (const [name, method] of INVOCATIONS) {
      if (!publicMethods(client[name]).includes(method)) {
        stale.push(`${name}.${method}`)
      }
    }

    expect(uncovered, `Resource methods with no invocation row: ${uncovered.join(', ')}`).toEqual([])
    expect(stale, `Invocation rows naming a method that does not exist: ${stale.join(', ')}`).toEqual([])
  })

  it('covers exactly the endpoints the resource methods call', async () => {
    const { client, calls } = setup()
    const recorded = new Map<string, string>()
    const silent: string[] = []

    for (const [name, method, args] of INVOCATIONS) {
      const resource = client[name] as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>
      const fn = resource[method]

      if (typeof fn !== 'function') {
        throw new Error(`${name}.${method} is not a function.`)
      }

      const before = calls.length
      const returned = fn.apply(resource, args)

      // The paginator is lazy by design and issues nothing until a page is pulled.
      if (returned instanceof Paginator) {
        await returned.pages().next()
      } else {
        await returned
      }

      if (calls.length === before) {
        silent.push(`${name}.${method}`)
        continue
      }

      const call = calls[calls.length - 1]!
      recorded.set(`${name}.${method}`, `${call.method} ${new URL(call.url).pathname.replace(/^\/+/, '')}`)
    }

    const matched = new Set<string>()
    const unknown: string[] = []

    for (const [where, pair] of recorded) {
      const [method, path] = [pair.slice(0, pair.indexOf(' ')), pair.slice(pair.indexOf(' ') + 1)]
      const hits = manifest.endpoints.filter((endpoint) => matches(endpoint, method, path))

      if (hits.length !== 1) {
        unknown.push(`${where} issues ${pair}, matched by ${hits.length} manifest entries`)
        continue
      }

      matched.add(`${hits[0]!.method} ${hits[0]!.path}`)
    }

    const uncalled = manifest.endpoints
      .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
      .filter((pair) => !matched.has(pair))

    expect(silent, `These resource methods issued no request at all: ${silent.join(', ')}`).toEqual([])
    expect(recorded.size).toBe(INVOCATIONS.length)
    expect(unknown, `Requests this SDK issues that no single manifest entry describes: ${unknown.join('; ')}`).toEqual([])
    expect(uncalled, `Manifest entries no resource method ever calls: ${uncalled.join('; ')}`).toEqual([])
  })
})
