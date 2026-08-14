import { Resource } from './base'

export class Account extends Resource {
  me(): Promise<Record<string, unknown>> {
    return this.httpGet('v1/me')
  }

  usage(): Promise<Record<string, unknown>> {
    return this.httpGet('v1/usage')
  }
}
