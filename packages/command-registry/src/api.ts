import type { CommandLike } from './contracts.js'
import { getCommandRegistryHostBindings } from './host.js'

export async function getCommands<TCommand extends CommandLike>(
  cwd: string,
): Promise<TCommand[]> {
  return getCommandRegistryHostBindings<TCommand>().getCommands(cwd)
}

export function clearCommandsCache(): void {
  getCommandRegistryHostBindings<CommandLike>().clearCommandsCache()
}

export function getCommandName<TCommand extends CommandLike>(
  command: TCommand,
): string {
  return getCommandRegistryHostBindings<TCommand>().getCommandName(command)
}

export function isCommandEnabled<TCommand extends CommandLike>(
  command: TCommand,
): boolean {
  return getCommandRegistryHostBindings<TCommand>().isCommandEnabled(command)
}

export function builtInCommandNames(): Set<string> {
  return getCommandRegistryHostBindings<CommandLike>().builtInCommandNames()
}

export function findCommand<TCommand extends CommandLike>(
  commandName: string,
  commands: TCommand[],
): TCommand | undefined {
  return getCommandRegistryHostBindings<TCommand>().findCommand(
    commandName,
    commands,
  )
}

export function hasCommand<TCommand extends CommandLike>(
  commandName: string,
  commands: TCommand[],
): boolean {
  return getCommandRegistryHostBindings<TCommand>().hasCommand(
    commandName,
    commands,
  )
}

export function getCommand<TCommand extends CommandLike>(
  commandName: string,
  commands: TCommand[],
): TCommand {
  return getCommandRegistryHostBindings<TCommand>().getCommand(
    commandName,
    commands,
  )
}

export async function getSkillToolCommands<TCommand extends CommandLike>(
  cwd: string,
): Promise<TCommand[]> {
  return getCommandRegistryHostBindings<TCommand>().getSkillToolCommands(cwd)
}

export async function getSlashCommandToolSkills<TCommand extends CommandLike>(
  cwd: string,
): Promise<TCommand[]> {
  return getCommandRegistryHostBindings<TCommand>().getSlashCommandToolSkills(
    cwd,
  )
}

export function getMcpSkillCommands<TCommand extends CommandLike>(
  mcpCommands: readonly TCommand[],
): readonly TCommand[] {
  return getCommandRegistryHostBindings<TCommand>().getMcpSkillCommands(
    mcpCommands,
  )
}

