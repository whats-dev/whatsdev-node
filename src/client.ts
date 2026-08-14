import { resolveConfig, type ClientOptions, type ResolvedConfig } from './config'
import { Transport, type RequestOptions } from './http/transport'

export class WhatsDevClient {
  readonly config: ResolvedConfig

  private readonly transport: Transport

  constructor(options: ClientOptions | string) {
    this.config = resolveConfig(options)
    this.transport = new Transport(this.config, typeof options === 'string' ? undefined : options.fetch)
  }

  /**
   * The escape hatch. Every endpoint this package has no method for is one call away, so
   * nothing in the API is ever unreachable from the SDK.
   */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.transport.request<T>(method, path, options)

    return response.body
  }
}
