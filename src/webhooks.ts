import { createHmac, timingSafeEqual } from 'node:crypto'
import { InvalidSignatureError, MissingWebhookSecretError } from './errors'

/**
 * rawBody must be the exact bytes received: the signature is over bytes, and re-encoding a decoded
 * payload changes key order and whitespace.
 *
 * Typed Uint8Array, not Buffer: a Buffer is one, and naming Buffer would put @types/node in the
 * published declarations that both READMEs promise a consumer does not need.
 *
 * @throws MissingWebhookSecretError when the secret is empty.
 */
export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  // An HMAC keyed on '' is a digest any attacker can compute, so an unset secret is not a verdict.
  if (!secret) {
    throw new MissingWebhookSecretError(
      'The webhook secret is empty, so no signature can be verified. Check that the environment variable holding it is set.',
    )
  }

  if (!signatureHeader?.startsWith('sha256=')) {
    return false
  }

  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'))
  const received = Buffer.from(signatureHeader.slice(7))

  // timingSafeEqual throws on a length mismatch, and a wrong-length signature is simply invalid.
  return expected.length === received.length && timingSafeEqual(expected, received)
}

/** @throws MissingWebhookSecretError when the secret is empty. */
export function assertWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
): void {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new InvalidSignatureError('The webhook signature did not match.')
  }
}
