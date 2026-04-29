import { describe, expect, test } from 'bun:test'
import {
  CheckError,
  InstallError,
  UpdaterBaseError,
  VerificationError,
} from '../errors.js'

describe('UpdaterBaseError', () => {
  test('preserves the explicit code', () => {
    expect(new UpdaterBaseError('CUSTOM', 'm').code).toBe('CUSTOM')
  })
  test('preserves the message', () => {
    expect(new UpdaterBaseError('X', 'failed to update').message).toBe(
      'failed to update',
    )
  })
  test('is an Error instance', () => {
    expect(new UpdaterBaseError('X', 'm')).toBeInstanceOf(Error)
  })
  test('forwards ErrorOptions.cause', () => {
    const cause = new Error('underlying')
    expect(new UpdaterBaseError('X', 'm', { cause }).cause).toBe(cause)
  })
  test('default name is "UpdaterBaseError"', () => {
    expect(new UpdaterBaseError('X', 'm').name).toBe('UpdaterBaseError')
  })
})

describe('CheckError', () => {
  test('code is UPDATER_CHECK_ERROR', () => {
    expect(new CheckError('m').code).toBe('UPDATER_CHECK_ERROR')
  })
  test('name is UpdaterCheckError (not CheckError)', () => {
    expect(new CheckError('m').name).toBe('UpdaterCheckError')
  })
  test('extends UpdaterBaseError', () => {
    expect(new CheckError('m')).toBeInstanceOf(UpdaterBaseError)
  })
})

describe('VerificationError', () => {
  test('code is UPDATER_VERIFICATION_ERROR', () => {
    expect(new VerificationError('m').code).toBe('UPDATER_VERIFICATION_ERROR')
  })
  test('name is UpdaterVerificationError', () => {
    expect(new VerificationError('m').name).toBe('UpdaterVerificationError')
  })
  test('forwards cause', () => {
    const cause = new Error('sha mismatch')
    expect(new VerificationError('m', { cause }).cause).toBe(cause)
  })
})

describe('InstallError', () => {
  test('code is UPDATER_INSTALL_ERROR', () => {
    expect(new InstallError('m').code).toBe('UPDATER_INSTALL_ERROR')
  })
  test('name is UpdaterInstallError', () => {
    expect(new InstallError('m').name).toBe('UpdaterInstallError')
  })
})

describe('updater error code uniqueness', () => {
  test('all three subclasses have distinct codes', () => {
    const codes = new Set([
      new CheckError('m').code,
      new VerificationError('m').code,
      new InstallError('m').code,
    ])
    expect(codes.size).toBe(3)
  })
  test('all subclass codes start with UPDATER_ prefix', () => {
    for (const code of [
      new CheckError('m').code,
      new VerificationError('m').code,
      new InstallError('m').code,
    ]) {
      expect(code).toMatch(/^UPDATER_/)
    }
  })
})
