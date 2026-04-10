export type CommandLike = {
  name: string
  aliases?: string[]
  type?: string
  source?: string
  loadedFrom?: string
  disableModelInvocation?: boolean
}

export type CommandRegistryHostBindings<TCommand extends CommandLike> = {
  getCommands: (cwd: string) => Promise<TCommand[]>
  clearCommandMemoizationCaches: () => void
  clearCommandsCache: () => void
  getCommandName: (command: TCommand) => string
  isCommandEnabled: (command: TCommand) => boolean
  builtInCommandNames: () => Set<string>
  findCommand: (
    commandName: string,
    commands: TCommand[],
  ) => TCommand | undefined
  hasCommand: (commandName: string, commands: TCommand[]) => boolean
  getCommand: (commandName: string, commands: TCommand[]) => TCommand
  getSkillToolCommands: (cwd: string) => Promise<TCommand[]>
  getSlashCommandToolSkills: (cwd: string) => Promise<TCommand[]>
  getMcpSkillCommands: (mcpCommands: readonly TCommand[]) => readonly TCommand[]
  internalOnlyCommands: () => readonly TCommand[]
  remoteSafeCommands: () => Set<TCommand>
  bridgeSafeCommands: () => Set<TCommand>
  isBridgeSafeCommand: (command: TCommand) => boolean
  filterCommandsForRemoteMode: (commands: TCommand[]) => TCommand[]
  formatDescriptionWithSource: (command: TCommand) => string
}
