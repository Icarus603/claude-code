type TransportConstructor<T = unknown> = new (...args: any[]) => T

export type Transport = {
  connect?: (...args: any[]) => Promise<void> | void
  write?: (...args: any[]) => Promise<void> | void
  close?: (...args: any[]) => Promise<void> | void
  [key: string]: unknown
}

function loadSSEModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(
    `${process.cwd()}/src/cli/transports/SSETransport.js`,
  ) as typeof import('../../../src/cli/transports/SSETransport.js')
}

function loadWebSocketModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(
    `${process.cwd()}/src/cli/transports/WebSocketTransport.js`,
  ) as typeof import('../../../src/cli/transports/WebSocketTransport.js')
}

function loadHybridModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(
    `${process.cwd()}/src/cli/transports/HybridTransport.js`,
  ) as typeof import('../../../src/cli/transports/HybridTransport.js')
}

function loadSerialUploaderModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(
    `${process.cwd()}/src/cli/transports/SerialBatchEventUploader.js`,
  ) as typeof import('../../../src/cli/transports/SerialBatchEventUploader.js')
}

function loadWorkerStateModule() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(
    `${process.cwd()}/src/cli/transports/WorkerStateUploader.js`,
  ) as typeof import('../../../src/cli/transports/WorkerStateUploader.js')
}

function instantiate<T>(Ctor: TransportConstructor<T>, args: any[]): T {
  return new Ctor(...args)
}

export class SSETransport {
  constructor(...args: any[]) {
    return instantiate(loadSSEModule().SSETransport as any, args)
  }
}

export function parseSSEFrames(...args: any[]) {
  return loadSSEModule().parseSSEFrames(...args)
}

export class WebSocketTransport {
  constructor(...args: any[]) {
    return instantiate(loadWebSocketModule().WebSocketTransport as any, args)
  }
}

export class HybridTransport {
  constructor(...args: any[]) {
    return instantiate(loadHybridModule().HybridTransport as any, args)
  }
}

export class SerialBatchEventUploader<T = unknown> {
  constructor(...args: any[]) {
    return instantiate(loadSerialUploaderModule().SerialBatchEventUploader<T> as any, args)
  }
}

export class WorkerStateUploader {
  constructor(...args: any[]) {
    return instantiate(loadWorkerStateModule().WorkerStateUploader as any, args)
  }
}
