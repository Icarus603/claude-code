import { enableConfigs } from '@claude-code/config'

async function main(): Promise<void> {
  enableConfigs()
  await import('../src/runtime/bootstrap.js')

  const {
    builtInCommandNames: builtInCommandNamesFromPackage,
    findCommand: findCommandFromPackage,
    getCommands: getCommandsFromPackage,
  } = await import('@claude-code/command-registry/runtime')
  const {
    builtInCommandNames: builtInCommandNamesFromSrc,
    findCommand: findCommandFromSrc,
    getCommands: getCommandsFromSrc,
  } = await import('../src/commands.js')

  const cwd = process.cwd()
  const [packageCommands, srcCommands] = await Promise.all([
    getCommandsFromPackage(cwd),
    getCommandsFromSrc(cwd),
  ])

  if (packageCommands.length !== srcCommands.length) {
    throw new Error(
      `Command registry mismatch: package=${packageCommands.length}, src=${srcCommands.length}`,
    )
  }

  const packageHelp = findCommandFromPackage('help', packageCommands)
  const srcHelp = findCommandFromSrc('help', srcCommands)
  if (!packageHelp || !srcHelp) {
    throw new Error('Failed to resolve /help command from command registry')
  }

  const packageBuiltInNames = builtInCommandNamesFromPackage()
  const srcBuiltInNames = builtInCommandNamesFromSrc()
  if (packageBuiltInNames.size !== srcBuiltInNames.size) {
    throw new Error(
      `Built-in command set mismatch: package=${packageBuiltInNames.size}, src=${srcBuiltInNames.size}`,
    )
  }

  if (!packageBuiltInNames.has('help')) {
    throw new Error('Built-in command set does not include help')
  }

  console.log('command registry verification passed')
}

await main()
