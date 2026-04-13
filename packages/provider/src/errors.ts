/**
 * V7 §6.5 — ProviderError typed error namespace.
 */
export class ProviderBaseError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProviderBaseError'
    this.code = code
  }
}
export class AuthError extends ProviderBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROVIDER_AUTH_ERROR', message, options)
    this.name = 'ProviderAuthError'
  }
}
export class RateLimitError extends ProviderBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROVIDER_RATE_LIMIT', message, options)
    this.name = 'ProviderRateLimitError'
  }
}
export class ContextOverflowError extends ProviderBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROVIDER_CONTEXT_OVERFLOW', message, options)
    this.name = 'ProviderContextOverflowError'
  }
}
export class UpstreamError extends ProviderBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROVIDER_UPSTREAM_ERROR', message, options)
    this.name = 'ProviderUpstreamError'
  }
}
export class StreamError extends ProviderBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROVIDER_STREAM_ERROR', message, options)
    this.name = 'ProviderStreamError'
  }
}

export class HostBindingsError extends ProviderBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROVIDER_HOST_BINDINGS_ERROR', message, options)
    this.name = 'ProviderHostBindingsError'
  }
}

export class ConfigurationError extends ProviderBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('PROVIDER_CONFIGURATION_ERROR', message, options)
    this.name = 'ProviderConfigurationError'
  }
}
