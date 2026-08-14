import { expect, it } from 'vitest'
import { WhatsDevClient } from '../../src/client'

/**
 * The README quickstart, executed against the real API so a broken README fails here.
 * Opt-in: without WHATSDEV_TEST_API_KEY this file skips and issues no request.
 */

// No endpoint reveals a key's mode, so this variable's NAME is the whole contract: it must hold a test key.
const apiKey = process.env.WHATSDEV_TEST_API_KEY ?? ''
const baseUrl = process.env.WHATSDEV_BASE_URL || 'https://whats.youdev.online'

it.skipIf(!process.env.WHATSDEV_TEST_API_KEY)(
  'runs the readme quickstart end to end against the sandbox',
  async () => {
    // The README's `new WhatsDevClient('YOUR_TEST_API_KEY')`, plus a base URL override; the default is the same value.
    const client = new WhatsDevClient({ apiKey, baseUrl })

    const session = (await client.sessions.create()) as { data: { id: number } }

    try {
      // The README loops until `connected` forever; CI must not hang, so the wait is bounded.
      let status: string | undefined

      for (let attempt = 0; attempt < 30; attempt++) {
        status = ((await client.sessions.get(session.data.id)) as { data: { status: string } }).data.status

        if (status === 'connected') {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // Reaching `connected` with no QR scan and no real number is the only observable proxy for a sandbox key.
      expect(status, `session ${session.data.id} never reached connected; last status: ${status}`).toBe('connected')

      const result = await client.messages.sendText(session.data.id, '967700000000', 'Hello from WhatsDev!')

      expect((result.data as { data: { id: number } }).data.id).toBeTruthy()
    } finally {
      // Runs even when an assertion fails, so a red run leaves no session on the owner's account.
      await client.sessions.delete(session.data.id)
    }
  },
  // The bounded wait alone can take 30s, well past vitest's 5s default.
  60_000,
)
