import { ensureCommandRuntimeInstalled } from './commandRuntimeInstaller.js'
import {
  builtInCommandNames as builtInCommandNamesFromPackage,
  clearCommandMemoizationCaches as clearCommandMemoizationCachesFromPackage,
  clearCommandsCache as clearCommandsCacheFromPackage,
  findCommand as findCommandFromPackage,
  getCommand as getCommandFromPackage,
  getCommands as getCommandsFromPackage,
  getMcpSkillCommands as getMcpSkillCommandsFromPackage,
  getSlashCommandToolSkills as getSlashCommandToolSkillsFromPackage,
  getSkillToolCommands as getSkillToolCommandsFromPackage,
  hasCommand as hasCommandFromPackage,
} from './api.js'
import type { CommandLike } from './contracts.js'
import { getCommandRegistryHostBindings } from './host.js'
import {
  getCommandName,
  isCommandEnabled,
  type Command,
  type CommandBase,
  type CommandResultDisplay,
  type LocalCommandResult,
  type LocalJSXCommandContext,
  type PromptCommand,
  type ResumeEntrypoint,
} from './types.js'

export type {
  Command,
  CommandBase,
  CommandResultDisplay,
  LocalCommandResult,
  LocalJSXCommandContext,
  PromptCommand,
  ResumeEntrypoint,
} from './types.js'
export { getCommandName, isCommandEnabled } from './types.js'

function getHostBindings() {
  ensureCommandRuntimeInstalled()
  return getCommandRegistryHostBindings<Command>()
}

const INTERNAL_ONLY_COMMANDS_TARGET: Command[] = []
const REMOTE_SAFE_COMMANDS_TARGET = new Set<Command>()
const BRIDGE_SAFE_COMMANDS_TARGET = new Set<Command>()

let commandCollectionsInitialized = false

function ensureCommandCollectionsInitialized(): void {
  if (commandCollectionsInitialized) return

  const hostBindings = getHostBindings()
  INTERNAL_ONLY_COMMANDS_TARGET.splice(
    0,
    INTERNAL_ONLY_COMMANDS_TARGET.length,
    ...hostBindings.internalOnlyCommands(),
  )
  REMOTE_SAFE_COMMANDS_TARGET.clear()
  for (const command of hostBindings.remoteSafeCommands()) {
    REMOTE_SAFE_COMMANDS_TARGET.add(command)
  }
  BRIDGE_SAFE_COMMANDS_TARGET.clear()
  for (const command of hostBindings.bridgeSafeCommands()) {
    BRIDGE_SAFE_COMMANDS_TARGET.add(command)
  }
  commandCollectionsInitialized = true
}

export const INTERNAL_ONLY_COMMANDS = new Proxy(INTERNAL_ONLY_COMMANDS_TARGET, {
  get(target, prop, receiver) {
    ensureCommandCollectionsInitialized()
    return Reflect.get(target, prop, receiver)
  },
}) as Command[]

export const REMOTE_SAFE_COMMANDS = new Proxy(REMOTE_SAFE_COMMANDS_TARGET, {
  get(target, prop, receiver) {
    ensureCommandCollectionsInitialized()
    const value = Reflect.get(target, prop, receiver)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) as Set<Command>

export const BRIDGE_SAFE_COMMANDS = new Proxy(BRIDGE_SAFE_COMMANDS_TARGET, {
  get(target, prop, receiver) {
    ensureCommandCollectionsInitialized()
    const value = Reflect.get(target, prop, receiver)
    return typeof value === 'function' ? value.bind(target) : value
  },
}) as Set<Command>

export function clearCommandMemoizationCaches(): void {
  ensureCommandRuntimeInstalled()
  clearCommandMemoizationCachesFromPackage()
  commandCollectionsInitialized = false
}

export function builtInCommandNames(): Set<string> {
  ensureCommandRuntimeInstalled()
  return builtInCommandNamesFromPackage()
}

export function clearCommandsCache(): void {
  ensureCommandRuntimeInstalled()
  clearCommandsCacheFromPackage()
  commandCollectionsInitialized = false
}

export function findCommand(
  commandName: string,
  commands: Command[],
): Command | undefined {
  ensureCommandRuntimeInstalled()
  return findCommandFromPackage(commandName, commands as CommandLike[]) as
    | Command
    | undefined
}

export function getCommand(commandName: string, commands: Command[]): Command {
  ensureCommandRuntimeInstalled()
  return getCommandFromPackage(commandName, commands as CommandLike[]) as Command
}

export function getCommands(cwd: string): Promise<Command[]> {
  ensureCommandRuntimeInstalled()
  return getCommandsFromPackage(cwd) as Promise<Command[]>
}

export function getMcpSkillCommands(
  mcpCommands: readonly Command[],
): readonly Command[] {
  ensureCommandRuntimeInstalled()
  return getMcpSkillCommandsFromPackage(mcpCommands as readonly CommandLike[]) as readonly Command[]
}

export function getSlashCommandToolSkills(cwd: string): Promise<Command[]> {
  ensureCommandRuntimeInstalled()
  return getSlashCommandToolSkillsFromPackage(cwd) as Promise<Command[]>
}

export function getSkillToolCommands(cwd: string): Promise<Command[]> {
  ensureCommandRuntimeInstalled()
  return getSkillToolCommandsFromPackage(cwd) as Promise<Command[]>
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  ensureCommandRuntimeInstalled()
  return hasCommandFromPackage(commandName, commands as CommandLike[])
}

export function isBridgeSafeCommand(cmd: Command): boolean {
  return getHostBindings().isBridgeSafeCommand(cmd)
}

export function filterCommandsForRemoteMode(commands: Command[]): Command[] {
  return getHostBindings().filterCommandsForRemoteMode(commands)
}

export function formatDescriptionWithSource(cmd: Command): string {
  return getHostBindings().formatDescriptionWithSource(cmd)
}
