export const DEFAULT_BASE_URL = 'https://whats.youdev.online'

const REDACTED = '***redacted***'

export interface ClientOptions {
  apiKey: string
  baseUrl?: string
  /** Milliseconds. */
  timeout?: number
  maxRetries?: number
  headers?: Record<string, string>
  /** Node equivalent of the PHP package's withHttpClient(). */
  fetch?: typeof fetch
}

export interface ResolvedConfig {
  apiKey: string
  baseUrl: string
  timeout: number
  maxRetries: number
  headers: Record<string, string>
}

export function resolveConfig(options: ClientOptions | string): ResolvedConfig {
  const input = typeof options === 'string' ? { apiKey: options } : options

  if (!input.apiKey) {
    throw new Error('apiKey is required.')
  }

  return redactedOnOutput({
    apiKey: input.apiKey,
    baseUrl: (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeout: input.timeout ?? 30_000,
    maxRetries: input.maxRetries ?? 2,
    headers: input.headers ?? {},
  })
}

/**
 * Mirrors the sibling package's Config::jsonSerialize()/__debugInfo(), so one team's "log the
 * resolved config at boot" line cannot redact in the PHP service and ship a live key from the
 * Node one. Reading config.apiKey is the documented access and still returns the real value.
 */
function redactedOnOutput(config: ResolvedConfig): ResolvedConfig {
  const redacted = (): Record<string, unknown> => ({ ...config, apiKey: REDACTED })

  // util.inspect.custom without importing node:util, which would put @types/node back on the surface.
  for (const key of ['toJSON', Symbol.for('nodejs.util.inspect.custom')] as const) {
    // Non-enumerable: an added own key would show up in Object.keys() and in a spread of the config.
    Object.defineProperty(config, key, { value: redacted, enumerable: false })
  }

  return config
}
