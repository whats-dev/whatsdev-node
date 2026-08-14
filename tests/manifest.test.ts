import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WhatsDevClient } from '../src/client'
import { Paginator } from '../src/pagination'
import { Resource } from '../src/resources/base'
import { stubFetch, type RecordedCall, type StubResponse } from './support/stubFetch'

interface Endpoint {
  method: string
  path: string
}

interface Manifest {
  version: number
  endpoints: Endpoint[]
}

// sdks/endpoints.json is the contract the main application's SdkEndpointCoverageTest holds the API
// to. These tests hold it to the SDK from this side: it must describe exactly the requests this
// package issues — no more, no less.
// Package root first: `git subtree split --prefix=sdks/node` publishes without the repository copy.
function loadManifest(): Manifest | null {
  for (const candidate of ['../endpoints.json', '../../endpoints.json']) {
    const url = new URL(candidate, import.meta.url)

    if (existsSync(url)) {
      return JSON.parse(readFileSync(url, 'utf8')) as Manifest
    }
  }

  return null
}

const manifest = loadManifest()
const endpoints = manifest?.endpoints ?? []

if (manifest === null) {
  console.warn('Skipping the endpoint manifest tests: endpoints.json is at neither sdks/node/endpoints.json nor sdks/endpoints.json.')
}

type ResourceName = {
  [K in keyof WhatsDevClient]: WhatsDevClient[K] extends Resource ? K : never
}[keyof WhatsDevClient]

// Derived, never hand-listed: a resource wired onto the client would otherwise escape this test.
function resourceNames(client: WhatsDevClient): ResourceName[] {
  return Object.getOwnPropertyNames(client).filter(
    (name) => (client as unknown as Record<string, unknown>)[name] instanceof Resource,
  ) as ResourceName[]
}

const KNOWN_RESOURCES = [
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

// The send helpers are one endpoint behind thirteen ergonomic front doors; every other entry is 1:1.
const EXPECTED_CALLERS: Record<string, string[]> = {
  'POST v1/sessions/{session}/messages': [
    'send',
    'sendText',
    'sendImage',
    'sendVideo',
    'sendVoice',
    'sendDocument',
    'sendLocation',
    'sendContact',
    'sendPoll',
    'sendButtons',
    'sendList',
    'sendLinkPreview',
    'sendTemplate',
  ].map((method) => `messages.${method}`),
}

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

// A literal entry wins outright, so a future sibling of a placeholder route — say
// POST v1/contacts/{contact} beside POST v1/contacts/batch — cannot read as ambiguous.
function resolve(method: string, path: string): Endpoint[] {
  const literal = endpoints.filter((endpoint) => endpoint.method === method && endpoint.path === path)

  return literal.length > 0 ? literal : endpoints.filter((endpoint) => matches(endpoint, method, path))
}

describe.skipIf(manifest === null)('endpoint manifest', () => {
  it('lists 70 tier-one endpoints', () => {
    const pairs = endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    const malformed = endpoints.filter((endpoint) => !/^v1\/[a-z0-9\-/{}_]+$/.test(endpoint.path))

    expect(endpoints).toHaveLength(70)
    expect(new Set(pairs).size, 'The manifest holds duplicate method+path entries.').toBe(70)
    expect(malformed, 'Malformed manifest paths.').toEqual([])
  })

  it('has an invocation row for every public resource method', () => {
    const { client } = setup()
    const names = resourceNames(client)
    const undiscovered = KNOWN_RESOURCES.filter((known) => !names.includes(known))
    const uncovered: string[] = []
    const stale: string[] = []

    for (const name of names) {
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

    expect(names.length, 'No resources were derived off the client at all.').toBeGreaterThan(0)
    expect(undiscovered, `Known resources this derivation failed to find: ${undiscovered.join(', ')}`).toEqual([])
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

    const callers = new Map<string, string[]>()
    const unknown: string[] = []

    for (const [where, pair] of recorded) {
      const [method, path] = [pair.slice(0, pair.indexOf(' ')), pair.slice(pair.indexOf(' ') + 1)]
      const hits = resolve(method, path)

      if (hits.length !== 1) {
        unknown.push(`${where} issues ${pair}, matched by ${hits.length} manifest entries`)
        continue
      }

      const entry = `${hits[0]!.method} ${hits[0]!.path}`
      callers.set(entry, [...(callers.get(entry) ?? []), where])
    }

    const miscounted: string[] = []

    for (const endpoint of endpoints) {
      const pair = `${endpoint.method} ${endpoint.path}`
      const actual = [...(callers.get(pair) ?? [])].sort()
      const expected = EXPECTED_CALLERS[pair]

      if (expected === undefined) {
        if (actual.length !== 1) {
          miscounted.push(`${pair} expects 1 caller, has ${actual.length}: ${actual.join(', ') || 'none'}`)
        }

        continue
      }

      const wanted = [...expected].sort()

      if (actual.join('|') !== wanted.join('|')) {
        miscounted.push(
          `${pair} expects ${wanted.length} callers (${wanted.join(', ')}), has ${actual.length}: ${actual.join(', ') || 'none'}`,
        )
      }
    }

    const uncalled = endpoints
      .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
      .filter((pair) => !callers.has(pair))

    expect(silent, `These resource methods issued no request at all: ${silent.join(', ')}`).toEqual([])
    expect(recorded.size).toBe(INVOCATIONS.length)
    expect(unknown, `Requests this SDK issues that no single manifest entry describes: ${unknown.join('; ')}`).toEqual([])
    expect(uncalled, `Manifest entries no resource method ever calls: ${uncalled.join('; ')}`).toEqual([])
    expect(miscounted, `Manifest entries whose callers are not the ones this test pins: ${miscounted.join('; ')}`).toEqual([])
  })
})
