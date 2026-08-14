import { resolveConfig, type ClientOptions, type ResolvedConfig } from './config'

export class WhatsDevClient {
  readonly config: ResolvedConfig

  constructor(options: ClientOptions | string) {
    this.config = resolveConfig(options)
  }
}
