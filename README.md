# WhatsDev Node.js SDK

The official Node.js client for the WhatsDev WhatsApp API.

## Installation

```bash
npm install @whatsdev/sdk
```

Requires Node.js 18 or later (for the built-in global `fetch`) plus the platform's built-in `node:crypto` module — nothing else. That's the whole runtime dependency list; `package.json` carries no `dependencies` field at all, and everything under `devDependencies` is build-and-test-only and never lands in a consumer's `node_modules` for production. The package ships as both ESM and CJS with its own TypeScript declarations, so it works with `import` and `require` alike, with no separate `@types` package needed.

## Quickstart

This is real, copy-pasteable code that runs against the sandbox with a test key as-is:

```ts
import { WhatsDevClient } from '@whatsdev/sdk'

const client = new WhatsDevClient('YOUR_TEST_API_KEY')
const session = (await client.sessions.create()) as { data: { id: number } }
while (((await client.sessions.get(session.data.id)) as { data: { status: string } }).data.status !== 'connected') {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
const result = await client.messages.sendText(session.data.id, '967700000000', 'Hello from WhatsDev!')

console.log((result.data as { data: { id: number } }).data.id)
```

A sandbox session never needs a QR scan or a real WhatsApp number, but it takes a few seconds to reach `connected` after creation — that's what the `while` loop is waiting for. Every message sent through it is simulated end-to-end and never actually reaches WhatsApp. Because the package returns every response as a generic `Record<string, unknown>` (see the response-shape section below), reading a nested field under TypeScript needs an explicit type assertion such as `as { data: { id: number } }` above — the same thing PHP's dynamic arrays do implicitly.

## Response shapes: the `data` wrapper

Every endpoint that returns a single resource — a session, a message, the account — wraps its payload under an outer `data` key on the server, exactly as the API reference documents it. The package does **not** strip that wrapper for you: a call returns the response body exactly as it arrived, `data` key included. This is deliberate, not an oversight — not every endpoint wraps the same way, and a "helpful" auto-unwrap would have to guess the shape instead of reflecting it, so what you read in your code would stop matching what the API docs say. That's why the quickstart reads `session.data.id`, not `session.id`. **The one exception is `list()` endpoints:** the `Paginator` hands you the items themselves as you iterate, never the list envelope's own `data` key — see Pagination below.

## Authentication, and test vs. live keys

Every request carries `Authorization: Bearer <key>`. A test key and a live key are exactly the same shape — there is no `test_`/`live_` prefix the client can look for. The mode is a flag WhatsDev stores against the key server-side, not something encoded in the key material, so the SDK never tries to infer it from the string. There is also no endpoint that reveals it — not `account.me()`, nor anything else. The mode you know is the one you chose when you created the key: it's shown on your account dashboard at creation time, so keep track of it there.

Get a test key from your account dashboard (API Keys → create a new key with the "Test" toggle on) and use it while developing: it runs inside a sandbox completely isolated from your real account and never consumes real quota. Only switch to a live key when you go to production.

## Error handling

Every failure that happens once you have a client extends `WhatsDevError` — API errors, connection errors, and the webhook and header failures alike. API errors (any non-2xx response) come back as a subclass of `ApiError` matching the server's error code — for example `QuotaExceededError` when a daily or monthly send quota is exhausted. That lets you catch a specific failure with `instanceof` without string-matching a message:

```ts
import { ApiError, QuotaExceededError } from '@whatsdev/sdk'

try {
  await client.messages.sendText(sessionId, '967700000000', 'Hello!')
} catch (error) {
  if (error instanceof QuotaExceededError) {
    // this plan's daily or monthly send quota is used up
    console.log(`Out of quota: ${error.code}`)
  } else if (error instanceof ApiError) {
    // any other typed API error — error.code, error.status, error.details and error.requestId are all available
    console.log(`Request ${error.requestId} failed (${error.status}): ${error.message}`)
  }
}
```

An error code this version of the package doesn't recognise (because the server added it later) never breaks anything — it arrives as a plain `ApiError` instead of a typed subclass, so your code keeps working against a newer API.

**One failure sits outside that hierarchy on purpose:** constructing a client without an `apiKey` throws a plain JavaScript `Error`, because it is a wrong argument rather than anything the API did, and it happens before a request exists. `request()`'s option names are checked by TypeScript at compile time rather than at runtime, so a mistyped key is a build error, not an exception to catch.

## Pagination

Every `list()` method returns a `Paginator` you can iterate directly with `for await...of` — it fetches the next page automatically, so you never write paging logic by hand:

```ts
for await (const contact of client.contacts.list({ status: 'active' })) {
  console.log(contact.id)
}
```

No request is issued until you actually start iterating (it's lazy), and the loop stops itself after the last page.

## Downloading media

An inbound media message has its file stored on the server. `media()` is the one method in the package that doesn't return decoded JSON — it hands back the bytes exactly as they were streamed, plus the content type the server named them:

```ts
import { writeFile } from 'node:fs/promises'

const file = await client.messages.media(messageId)

await writeFile('/tmp/inbound-media', file.bytes)
console.log(file.contentType) // e.g. image/jpeg, or null if the server named none
```

`file.bytes` is a `Uint8Array` of the raw bytes and `file.contentType` is the `Content-Type` header or `null`. Decoding a picture as JSON would have discarded the only thing you asked for, which is why this one method has a return type of its own.

## Webhook verification

When a webhook event arrives, verify the `X-Signature` header before trusting anything in the body:

```ts
import { assertWebhookSignature } from '@whatsdev/sdk'

async function handleWebhook(request: Request, webhookSecret: string) {
  const rawBody = await request.text() // must be the exact raw bytes, not a re-encoded payload
  const signature = request.headers.get('x-signature')

  assertWebhookSignature(rawBody, signature, webhookSecret) // throws InvalidSignatureError on failure

  const payload = JSON.parse(rawBody)
}
```

**An empty secret throws — it does not return `false`.** If `webhookSecret` is an empty string — exactly the shape of an unset environment variable — both `verifyWebhookSignature` and `assertWebhookSignature` throw `MissingWebhookSecretError`. An HMAC keyed on an empty string is a perfectly valid digest an attacker can compute, so returning `false` would send you hunting a forged payload that never existed instead of finding your own missing configuration.

**This is the part to get right:** pass the raw body exactly as received — a `string` or the raw bytes — never a value that has been through `JSON.parse` and back through `JSON.stringify`. The signature is computed over the exact bytes the server sent — decoding and re-encoding can change key order or whitespace, and that alone makes verification fail for a perfectly genuine delivery. That's why `verifyWebhookSignature`/`assertWebhookSignature` only accept `string | Uint8Array` (a `Buffer` is one), never a decoded object. The comparison itself runs in constant time via `timingSafeEqual` from `node:crypto`, so execution time never leaks whether the signature was close to matching.

## The escape hatch (`request()`)

Any endpoint the package doesn't have a dedicated method for is still one call away:

```ts
const groups = await client.request('GET', 'v1/sessions/7/groups', { query: { limit: 10 } })
```

The third argument is an options object with `query`, `body`, `headers` and `idempotencyKey`. TypeScript flags a mistyped name in an object literal — writing `bodyy` there is a compile error — but that check is narrower than it looks: it doesn't fire for an options object held in a variable alongside a valid key, and it isn't there at all when you call the package from plain JavaScript, which both the ESM and CJS builds support. In those cases an unrecognised key is dropped in silence, so check the names yourself. Most of what the escape hatch reaches are writes, and a write takes a body:

```ts
const group = await client.request('POST', 'v1/sessions/7/groups', {
  body: { name: 'Ops team', participants: ['967700000000'] },
})
```

**Retries follow the same rule here as everywhere else in the package, and that rule is not "always".** A `GET` is retried on a connection error and on 429, 502, 503 and 504. A write — `POST`, `PUT`, `PATCH`, `DELETE` — is retried **only when it carries an `Idempotency-Key`**, because replaying a write the server may already have accepted could deliver a real message twice. The dedicated send methods generate that key for you; the escape hatch does not, so pass one yourself whenever you want a write to be retryable:

```ts
const group = await client.request('POST', 'v1/sessions/7/groups', {
  body: { name: 'Ops team', participants: ['967700000000'] },
  idempotencyKey: 'ops-team-2026-08-14',
})
```

Everything else is shared with the rest of the package: authentication, the typed errors above, and the response body exactly as it arrived, `data` wrapper included. So nothing in the API is ever unreachable from the SDK. You can also pass an optional generic type parameter, like `request<{ data: unknown[] }>(...)`, for more precise type hints when you want them.
