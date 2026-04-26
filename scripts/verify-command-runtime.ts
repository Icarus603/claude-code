import { enableConfigs } from '@claude-code/config'
import { installConfigHostBindings } from '../packages/config/host.js'

async function main(): Promise<void> {
  // Dummy creds — getAnthropicApiKeyWithSource() throws on a fresh CI
  // runner with no env vars and no OAuth token. Set before bootstrap so
  // any downstream provider init sees a value.
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'provider-test'

  // Install minimal host bindings so enableConfigs() doesn't throw.
  installConfigHostBindings({})
  enableConfigs()
  await import('@claude-code/app-host/runtime/bootstrap.js')

  const {
    builtInCommandNames: builtInCommandNamesFromPackage,
    findCommand: findCommandFromPackage,
    getCommands: getCommandsFromPackage,
  } = await import('@claude-code/command-runtime/runtime')
  const {
    builtInCommandNames: builtInCommandNamesFromSrc,
    findCommand: findCommandFromSrc,
    getCommands: getCommandsFromSrc,
  } = await import('@claude-code/command-runtime/runtime')

  const cwd = process.cwd()
  const [packageCommands, srcCommands] = await Promise.all([
    getCommandsFromPackage(cwd),
    getCommandsFromSrc(cwd),
  ])

  if (packageCommands.length !== srcCommands.length) {
    throw new Error(
      `Command runtime mismatch: package=${packageCommands.length}, src=${srcCommands.length}`,
    )
  }

  const packageHelp = findCommandFromPackage('help', packageCommands)
  const srcHelp = findCommandFromSrc('help', srcCommands)
  if (!packageHelp || !srcHelp) {
    throw new Error('Failed to resolve /help command from command runtime')
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

  console.log('command runtime verification passed')
}

await main()
