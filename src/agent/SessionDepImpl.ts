
import type { SessionDep, CoreMessage } from '@claude-code/agent'
import type { Message } from '../Tool.js'
import { getSessionId } from '../bootstrap/state.js'
import { recordTranscript } from '../utils/sessionStorage.js'

export class SessionDepImpl implements SessionDep {
  getSessionId(): string {
    return getSessionId()
  }

  async recordTranscript(messages: CoreMessage[]): Promise<void> {
    try {
      await recordTranscript(messages as unknown as Message[])
    } catch {
    }
  }
}
