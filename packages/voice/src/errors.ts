export class VoiceBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VoiceBaseError'
    this.code = code
  }
}

export class CaptureError extends VoiceBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('VOICE_CAPTURE_ERROR', message, options)
    this.name = 'VoiceCaptureError'
  }
}

export class AuthError extends VoiceBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('VOICE_AUTH_ERROR', message, options)
    this.name = 'VoiceAuthError'
  }
}

export class StreamError extends VoiceBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('VOICE_STREAM_ERROR', message, options)
    this.name = 'VoiceStreamError'
  }
}
