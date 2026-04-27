/**
 * Singleton manager for cloud-provider authentication status (AWS Bedrock,
 * GCP Vertex). Communicates auth refresh state between auth utilities and
 * React components / SDK output. The SDK 'auth_status' message shape is
 * provider-agnostic, so a single manager serves all providers.
 *
 * Legacy name: originally AWS-only; now used by all cloud auth refresh flows.
 *
 * Moved from packages/repl/src/awsAuthStatusManager.ts to break the
 * provider→repl back-edge that contributed to the 154-file SCC. Singleton
 * identity is preserved — all consumers (provider/userAuth, provider/authAlias,
 * cli/sdk, repl/AwsAuthStatusBox) now import from this canonical location.
 */

import { createSignal } from '@claude-code/config/signal'

export type AwsAuthStatus = {
  isAuthenticating: boolean
  output: string[]
  error?: string
}

export class AwsAuthStatusManager {
  private static instance: AwsAuthStatusManager | null = null
  private status: AwsAuthStatus = {
    isAuthenticating: false,
    output: [],
  }
  private changed = createSignal<[status: AwsAuthStatus]>()

  static getInstance(): AwsAuthStatusManager {
    if (!AwsAuthStatusManager.instance) {
      AwsAuthStatusManager.instance = new AwsAuthStatusManager()
    }
    return AwsAuthStatusManager.instance
  }

  getStatus(): AwsAuthStatus {
    return {
      ...this.status,
      output: [...this.status.output],
    }
  }

  startAuthentication(): void {
    this.status = {
      isAuthenticating: true,
      output: [],
    }
    this.changed.emit(this.getStatus())
  }

  addOutput(line: string): void {
    this.status.output.push(line)
    this.changed.emit(this.getStatus())
  }

  setError(error: string): void {
    this.status.error = error
    this.changed.emit(this.getStatus())
  }

  endAuthentication(success: boolean): void {
    if (success) {
      this.status = {
        isAuthenticating: false,
        output: [],
      }
    } else {
      this.status.isAuthenticating = false
    }
    this.changed.emit(this.getStatus())
  }

  subscribe = this.changed.subscribe

  static reset(): void {
    if (AwsAuthStatusManager.instance) {
      AwsAuthStatusManager.instance.changed.clear()
      AwsAuthStatusManager.instance = null
    }
  }
}
