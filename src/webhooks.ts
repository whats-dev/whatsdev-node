import { createHmac, timingSafeEqual } from 'node:crypto'
import { InvalidSignatureError, MissingWebhookSecretError } from './errors'

/**
 * rawBody must be the exact bytes received. Re-encoding a decoded payload changes key
 * order and whitespace, and the signature is over bytes — so a decoded object would fail
 * verification for a perfectly genuine delivery.
 *
 * @throws MissingWebhookSecretError when the secret is empty.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  // An unset environment variable coerces to '', and an HMAC keyed on '' is a digest any attacker
  // can compute. Throwing names the real cause; returning false would send the developer hunting a
  // forged payload instead of their own missing configuration.
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
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): void {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new InvalidSignatureError('The webhook signature did not match.')
  }
}
