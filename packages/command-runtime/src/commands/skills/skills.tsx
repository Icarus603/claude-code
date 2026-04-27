import * as React from 'react'
import type { LocalJSXCommandContext } from '../../runtime.js'
import { SkillsMenu } from '@claude-code/repl/components/skills/SkillsMenu.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <SkillsMenu onExit={onDone} commands={context.options.commands} />
}
