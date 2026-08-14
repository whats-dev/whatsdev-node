import { resolveConfig, type ClientOptions, type ResolvedConfig } from './config'
import { Transport, type RequestOptions } from './http/transport'
import { Account } from './resources/account'
import { Bulk } from './resources/bulk'
import { ContactFields } from './resources/contactFields'
import { ContactLists } from './resources/contactLists'
import { Contacts } from './resources/contacts'
import { MessageOps } from './resources/messageOps'
import { Messages } from './resources/messages'
import { Sandbox } from './resources/sandbox'
import { ScheduledMessages } from './resources/scheduledMessages'
import { Sessions } from './resources/sessions'
import { Suppressions } from './resources/suppressions'
import { Templates } from './resources/templates'
import { Webhooks } from './resources/webhooks'

export class WhatsDevClient {
  // Held privately and read through a prototype getter: an own property lands in
  // JSON.stringify(client) and console.log(client), and the config carries a live API key.
  readonly #config: ResolvedConfig

  readonly account: Account
  readonly sessions: Sessions
  readonly messages: Messages
  readonly messageOps: MessageOps
  readonly scheduledMessages: ScheduledMessages
  readonly webhooks: Webhooks
  readonly contacts: Contacts
  readonly contactLists: ContactLists
  readonly contactFields: ContactFields
  readonly bulk: Bulk
  readonly templates: Templates
  readonly suppressions: Suppressions
  readonly sandbox: Sandbox

  private readonly transport: Transport

  get config(): ResolvedConfig {
    return this.#config
  }

  constructor(options: ClientOptions | string) {
    this.#config = resolveConfig(options)
    this.transport = new Transport(this.#config, typeof options === 'string' ? undefined : options.fetch)

    this.account = new Account(this.transport)
    this.sessions = new Sessions(this.transport)
    this.messages = new Messages(this.transport)
    this.messageOps = new MessageOps(this.transport)
    this.scheduledMessages = new ScheduledMessages(this.transport)
    this.webhooks = new Webhooks(this.transport)
    this.contacts = new Contacts(this.transport)
    this.contactLists = new ContactLists(this.transport)
    this.contactFields = new ContactFields(this.transport)
    this.bulk = new Bulk(this.transport)
    this.templates = new Templates(this.transport)
    this.suppressions = new Suppressions(this.transport)
    this.sandbox = new Sandbox(this.transport)
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
