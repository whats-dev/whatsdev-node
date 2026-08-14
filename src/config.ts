export const DEFAULT_BASE_URL = 'https://whats.youdev.online'

export interface ClientOptions {
  apiKey: string
  baseUrl?: string
  /** Milliseconds. */
  timeout?: number
  maxRetries?: number
  headers?: Record<string, string>
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

  return {
    apiKey: input.apiKey,
    baseUrl: (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeout: input.timeout ?? 30_000,
    maxRetries: input.maxRetries ?? 2,
    headers: input.headers ?? {},
  }
}
