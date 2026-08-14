import { createHmac, timingSafeEqual } from 'node:crypto'
import { InvalidSignatureError } from './errors'

/**
 * rawBody must be the exact bytes received. Re-encoding a decoded payload changes key
 * order and whitespace, and the signature is over bytes — so a decoded object would fail
 * verification for a perfectly genuine delivery.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) {
    return false
  }

  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'))
  const received = Buffer.from(signatureHeader.slice(7))

  // timingSafeEqual throws on a length mismatch, and a wrong-length signature is simply invalid.
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export function assertWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
): void {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new InvalidSignatureError('The webhook signature did not match.')
  }
}
