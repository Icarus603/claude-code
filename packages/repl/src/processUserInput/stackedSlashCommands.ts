import {
  getCommand,
  hasCommand,
  type Command,
  type CommandBase,
  type PromptCommand,
} from '@claude-code/command-runtime/runtime'
import { parseStackedSlashCommands } from '@claude-code/command-runtime/slashCommandParsing.js'
import type { ProcessUserInputBaseResult } from './processUserInput.js'

type PromptCommandType = CommandBase & PromptCommand

export async function processStackedPromptCommands(
  input: string,
  commands: Command[],
  execute: (
    command: PromptCommandType,
    args: string,
    isFirst: boolean,
  ) => Promise<ProcessUserInputBaseResult>,
): Promise<ProcessUserInputBaseResult | null> {
  const stacked = parseStackedSlashCommands(input)
  if (!stacked) return null

  const resolved = stacked.commandNames.map(name =>
    hasCommand(name, commands) ? getCommand(name, commands) : null,
  )
  if (
    !resolved.every(
      (command): command is PromptCommandType => command?.type === 'prompt',
    )
  ) {
    return null
  }

  const results = await Promise.all(
    resolved.map((command, index) =>
      execute(
        command,
        index === resolved.length - 1 ? stacked.args : '',
        index === 0,
      ),
    ),
  )
  return {
    messages: results.flatMap(result => result.messages),
    shouldQuery: true,
    allowedTools: [
      ...new Set(results.flatMap(result => result.allowedTools ?? [])),
    ],
    model: results.findLast(result => result.model)?.model,
    effort: results.findLast(result => result.effort)?.effort,
    activeSkill: stacked.commandNames.at(-1),
  }
}
