/**
 * `/workflows` local-jsx body — renders the WorkflowsDialog (goal-history
 * browser). ant 4936.js LlK.call simply renders the GlK history component;
 * ccb mirrors that, threading the transcript + active goal into the dialog.
 *
 * The transcript is the source of goal "runs" (goal_status attachments);
 * the active goal comes from AppState. Both are read here and passed as
 * props so the dialog stays a pure presentation component.
 */
import * as React from 'react'
import { WorkflowsDialog } from '@claude-code/repl/components/tasks/WorkflowsDialog.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import type { Message } from '@claude-code/agent/messageShapes'

// Signature MUST match LocalJSXCommandCall (onDone, context, args) — declaring
// a narrowed `context` param breaks contravariant assignability against the
// LocalJSXCommandModule the `load()` Promise must resolve to. Take the context
// as `unknown` and narrow internally, mirroring the /background command. State
// lives under `toolUseContext` (messages + getAppState), same as ant.
export async function call(
  onDone: LocalJSXCommandOnDone,
  rawContext: unknown,
  _args: string,
): Promise<React.ReactNode> {
  const context = rawContext as {
    toolUseContext?: {
      messages?: Message[]
      getAppState?: () => {
        activeGoal?: {
          condition: string
          iterations: number
          setAt: number
          tokensAtStart: number
          lastReason?: string
          paused?: boolean
        }
      }
    }
  }
  return (
    <WorkflowsDialog
      onDone={onDone}
      activeGoal={context.toolUseContext?.getAppState?.().activeGoal}
      messages={context.toolUseContext?.messages ?? []}
    />
  )
}
