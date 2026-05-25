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

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: {
    getAppState: () => {
      activeGoal?: {
        condition: string
        iterations: number
        setAt: number
        tokensAtStart: number
        lastReason?: string
        paused?: boolean
      }
    }
    messages?: Message[]
  },
): Promise<React.ReactNode> {
  return (
    <WorkflowsDialog
      onDone={onDone}
      activeGoal={context.getAppState().activeGoal}
      messages={context.messages ?? []}
    />
  )
}
