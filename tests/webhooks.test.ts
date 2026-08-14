import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { InvalidSignatureError, MissingWebhookSecretError, WhatsDevError } from '../src/errors'
import { assertWebhookSignature, verifyWebhookSignature } from '../src/webhooks'

const body = '{"event":"message","data":{"id":"abc"}}'
const secret = 's3cret'
const valid = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

it('accepts a signature the server would have produced', () => {
  expect(verifyWebhookSignature(body, valid, secret)).toBe(true)
})

it('rejects a tampered body', () => {
  expect(verifyWebhookSignature('{"event":"message","data":{"id":"xyz"}}', valid, secret)).toBe(false)
})

it('rejects the wrong secret', () => {
  expect(verifyWebhookSignature(body, valid, 'other')).toBe(false)
})

it('rejects a missing or malformed header instead of trusting it', () => {
  expect(verifyWebhookSignature(body, null, secret)).toBe(false)
  expect(verifyWebhookSignature(body, undefined, secret)).toBe(false)
  expect(verifyWebhookSignature(body, '', secret)).toBe(false)
  expect(verifyWebhookSignature(body, 'deadbeef', secret)).toBe(false)
  expect(verifyWebhookSignature(body, 'md5=abc', secret)).toBe(false)
})

it('throws on assert so a handler cannot forget to check the return value', () => {
  expect(() => assertWebhookSignature(body, 'sha256=wrong', secret)).toThrow(InvalidSignatureError)
})

// An unset environment variable coerces to '', and HMAC with an empty key is a perfectly valid
// digest an attacker can compute — so an empty secret turned the only security control this helper
// provides into a silent no-op. It is a misconfiguration, not a failed verification: returning
// false would send the developer hunting a forged-payload ghost instead of their own missing
// environment variable.
it('refuses to verify against an empty secret rather than accept the forgery it invites', () => {
  const forged = `sha256=${createHmac('sha256', '').update(body).digest('hex')}`

  expect(() => verifyWebhookSignature(body, forged, '')).toThrow(MissingWebhookSecretError)
  expect(() => assertWebhookSignature(body, forged, '')).toThrow(MissingWebhookSecretError)
  expect(() => verifyWebhookSignature(body, null, '')).toThrow(WhatsDevError)
  expect(() => verifyWebhookSignature(body, forged, '')).toThrow(/webhook secret/)
})

it('rejects the correct digest under the wrong algorithm prefix', () => {
  const sha1Prefixed = `sha1=${createHmac('sha256', secret).update(body).digest('hex')}`

  expect(verifyWebhookSignature(body, sha1Prefixed, secret)).toBe(false)
})

it('rejects a truncated digest', () => {
  const full = createHmac('sha256', secret).update(body).digest('hex')
  const truncated = `sha256=${full.slice(0, -2)}`

  expect(verifyWebhookSignature(body, truncated, secret)).toBe(false)
})

it('returns false rather than throwing when the signature length differs', () => {
  expect(verifyWebhookSignature('{}', 'sha256=ab', 's3cret')).toBe(false)
})

it('verifies a body containing multibyte UTF-8', () => {
  const arabicBody = JSON.stringify({ event: 'message', data: { text: 'مرحبا بالعالم' } })
  const signature = `sha256=${createHmac('sha256', secret).update(arabicBody).digest('hex')}`

  expect(verifyWebhookSignature(arabicBody, signature, secret)).toBe(true)
})

it('verifies a body containing a literal null byte', () => {
  const nullByte = String.fromCharCode(0)
  const bodyWithNull = `{"event":"message","data":"a${nullByte}b"}`
  const signature = `sha256=${createHmac('sha256', secret).update(bodyWithNull).digest('hex')}`

  expect(verifyWebhookSignature(bodyWithNull, signature, secret)).toBe(true)
})

describe('verifyWebhookSignature with a Buffer body', () => {
  it('accepts a signature computed over the same bytes', () => {
    const bufferBody = Buffer.from(body, 'utf8')
    const signature = `sha256=${createHmac('sha256', secret).update(bufferBody).digest('hex')}`

    expect(verifyWebhookSignature(bufferBody, signature, secret)).toBe(true)
  })
})
