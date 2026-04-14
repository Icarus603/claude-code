export class UpdaterBaseError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UpdaterBaseError'
    this.code = code
  }
}

export class CheckError extends UpdaterBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('UPDATER_CHECK_ERROR', message, options)
    this.name = 'UpdaterCheckError'
  }
}

export class VerificationError extends UpdaterBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('UPDATER_VERIFICATION_ERROR', message, options)
    this.name = 'UpdaterVerificationError'
  }
}

export class InstallError extends UpdaterBaseError {
  constructor(message: string, options?: ErrorOptions) {
    super('UPDATER_INSTALL_ERROR', message, options)
    this.name = 'UpdaterInstallError'
  }
}
