export class WhatsDevError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
    // Without this, `instanceof` breaks for anyone compiling the package down to ES5.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ConnectionError extends WhatsDevError {}

export class InvalidSignatureError extends WhatsDevError {}

export class ApiError extends WhatsDevError {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown>
  readonly requestId?: string

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}, requestId?: string) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
    this.requestId = requestId
  }
}

// Plain subclasses: no properties beyond ApiError's.
export class AccountSuspendedError extends ApiError {}
export class BadRequestError extends ApiError {}
export class BulkLimitExceededError extends ApiError {}
export class BulkRecipientsEmptyError extends ApiError {}
export class ConflictError extends ApiError {}
export class ContactLimitExceededError extends ApiError {}
export class ExportTooSoonError extends ApiError {}
export class FieldInUseError extends ApiError {}
export class FieldLimitReachedError extends ApiError {}
export class ForbiddenError extends ApiError {}
export class InvalidBulkStateError extends ApiError {}
export class InvalidFieldKeyError extends ApiError {}
export class ListLimitExceededError extends ApiError {}
export class MediaNotAvailableError extends ApiError {}
export class MessageNotSentError extends ApiError {}
export class MessageRejectedError extends ApiError {}
export class MethodNotAllowedError extends ApiError {}
export class NoCapacityError extends ApiError {}
export class NotFoundError extends ApiError {}
export class QuotaExceededError extends ApiError {}
export class RateLimitedError extends ApiError {}
export class ScheduledMessageNotCancelableError extends ApiError {}
export class ServerErrorError extends ApiError {}
export class ServiceUnavailableError extends ApiError {}
export class SessionLimitReachedError extends ApiError {}
export class SessionNotConnectedError extends ApiError {}
export class SubscriptionRequiredError extends ApiError {}
export class TemplateBodyTooLongError extends ApiError {}
export class TemplateLimitReachedError extends ApiError {}
export class UnauthenticatedError extends ApiError {}
export class UndefinedContactFieldError extends ApiError {}
export class UnknownTemplateVariableError extends ApiError {}
export class UpstreamErrorError extends ApiError {}

// Detail-carrying subclasses: mirror the PHP twins' extra properties, camelCased.

export class ValidationFailedError extends ApiError {
  readonly errors: Record<string, string[]>

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}, requestId?: string) {
    super(message, code, status, details, requestId)
    this.errors = details as Record<string, string[]>
  }
}

export class QuotaInsufficientError extends ApiError {
  readonly requested: number
  readonly remainingDaily: number
  readonly remainingMonthly: number

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}, requestId?: string) {
    super(message, code, status, details, requestId)
    this.requested = Number(details.requested ?? 0)
    this.remainingDaily = Number(details.remaining_daily ?? 0)
    this.remainingMonthly = Number(details.remaining_monthly ?? 0)
  }
}

export class TemplateVariablesMissingError extends ApiError {
  readonly missingCount: number
  readonly missingVariables: string[]
  readonly sample: string | null

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}, requestId?: string) {
    super(message, code, status, details, requestId)
    this.missingCount = Number(details.missing_count ?? 0)
    this.missingVariables = (details.missing_variables as string[] | undefined) ?? []
    this.sample = details.sample != null ? String(details.sample) : null
  }
}

export class DailyCapReachedError extends ApiError {
  readonly retryAfter: number | null

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}, requestId?: string) {
    super(message, code, status, details, requestId)
    this.retryAfter = details.retry_after != null ? Number(details.retry_after) : null
  }
}

export class ListNotFoundError extends ApiError {
  readonly listIds: unknown[]

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}, requestId?: string) {
    super(message, code, status, details, requestId)
    this.listIds = (details.list_ids as unknown[] | undefined) ?? []
  }
}

export class FeatureNotSupportedError extends ApiError {
  readonly feature: string | null

  constructor(message: string, code: string, status: number, details: Record<string, unknown> = {}, requestId?: string) {
    super(message, code, status, details, requestId)
    this.feature = details.feature != null ? String(details.feature) : null
  }
}

type ApiErrorConstructor = new (
  message: string,
  code: string,
  status: number,
  details: Record<string, unknown>,
  requestId?: string,
) => ApiError

// One entry per API error code — must stay in sync with the sibling package's error map.
const ERRORS: Record<string, ApiErrorConstructor> = {
  account_suspended: AccountSuspendedError,
  bad_request: BadRequestError,
  bulk_limit_exceeded: BulkLimitExceededError,
  bulk_recipients_empty: BulkRecipientsEmptyError,
  conflict: ConflictError,
  contact_limit_exceeded: ContactLimitExceededError,
  daily_cap_reached: DailyCapReachedError,
  export_too_soon: ExportTooSoonError,
  feature_not_supported: FeatureNotSupportedError,
  field_in_use: FieldInUseError,
  field_limit_reached: FieldLimitReachedError,
  forbidden: ForbiddenError,
  invalid_bulk_state: InvalidBulkStateError,
  invalid_field_key: InvalidFieldKeyError,
  list_limit_exceeded: ListLimitExceededError,
  list_not_found: ListNotFoundError,
  media_not_available: MediaNotAvailableError,
  message_not_sent: MessageNotSentError,
  message_rejected: MessageRejectedError,
  method_not_allowed: MethodNotAllowedError,
  no_capacity: NoCapacityError,
  not_found: NotFoundError,
  quota_exceeded: QuotaExceededError,
  quota_insufficient: QuotaInsufficientError,
  rate_limited: RateLimitedError,
  scheduled_message_not_cancelable: ScheduledMessageNotCancelableError,
  server_error: ServerErrorError,
  service_unavailable: ServiceUnavailableError,
  session_limit_reached: SessionLimitReachedError,
  session_not_connected: SessionNotConnectedError,
  subscription_required: SubscriptionRequiredError,
  template_body_too_long: TemplateBodyTooLongError,
  template_limit_reached: TemplateLimitReachedError,
  template_variables_missing: TemplateVariablesMissingError,
  unauthenticated: UnauthenticatedError,
  undefined_contact_field: UndefinedContactFieldError,
  unknown_template_variable: UnknownTemplateVariableError,
  upstream_error: UpstreamErrorError,
  validation_failed: ValidationFailedError,
}

export function errorFromResponse(status: number, body: unknown, requestId?: string): ApiError {
  const envelope = (body as { error?: Record<string, unknown> } | null)?.error
  const code = typeof envelope?.code === 'string' ? envelope.code : 'http_error'
  const message = typeof envelope?.message === 'string' ? envelope.message : `The API returned HTTP ${status}.`
  const details = (envelope?.details ?? {}) as Record<string, unknown>

  const Constructor = ERRORS[code] ?? ApiError

  return new Constructor(message, code, status, details, requestId)
}
