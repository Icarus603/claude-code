import type { CommandLike, CommandRegistryHostBindings } from './contracts.js'
import { HostBindingsError } from './errors.js'

let commandRegistryHostBindings:
  | CommandRegistryHostBindings<CommandLike>
  | null = null

export function installCommandRegistryHostBindings<
  TCommand extends CommandLike,
>(bindings: CommandRegistryHostBindings<TCommand>): void {
  commandRegistryHostBindings =
    bindings as unknown as CommandRegistryHostBindings<CommandLike>
}

export function hasCommandRegistryHostBindings(): boolean {
  return commandRegistryHostBindings !== null
}

export function getCommandRegistryHostBindings<
  TCommand extends CommandLike,
>(): CommandRegistryHostBindings<TCommand> {
  if (!commandRegistryHostBindings) {
    throw new HostBindingsError(
      'Command registry host bindings have not been installed. Install host bindings before using @claude-code/command-runtime runtime APIs.',
    )
  }
  return commandRegistryHostBindings as CommandRegistryHostBindings<TCommand>
}
