import { readFile } from 'fs/promises'

const PROVIDER_APP_COMPAT_BUDGET = 70

async function main(): Promise<void> {
  const [claudeLegacyFacade, providerHostSetupRoot, providerHostSetupPkg, providerLegacy] =
    await Promise.all([
      readFile('src/services/api/claudeLegacy.ts', 'utf8'),
      readFile('src/services/api/providerHostSetup.ts', 'utf8'),
      readFile('packages/provider/src/providerHostSetup.ts', 'utf8'),
      readFile('packages/provider/src/claudeLegacy.ts', 'utf8'),
    ])

  if (
    claudeLegacyFacade.trim() !==
    "export * from '@claude-code/provider/claudeLegacy'"
  ) {
    throw new Error(
      'src/services/api/claudeLegacy.ts is no longer a pure provider facade',
    )
  }

  if (!providerHostSetupRoot.includes('installProviderRuntimeBindings(bindings)')) {
    throw new Error(
      'src/services/api/providerHostSetup.ts no longer owns root provider binding composition',
    )
  }

  if (providerHostSetupPkg.includes('@claude-code/app-compat/')) {
    throw new Error(
      'packages/provider/src/providerHostSetup.ts should not import app-compat directly',
    )
  }

  const appCompatRefs =
    (providerLegacy.match(/@claude-code\/app-compat\//g) ?? []).length
  if (appCompatRefs > PROVIDER_APP_COMPAT_BUDGET) {
    throw new Error(
      `Provider owner budget regressed: current=${appCompatRefs}, budget=${PROVIDER_APP_COMPAT_BUDGET}`,
    )
  }

  console.log('provider owner verification passed')
}

await main()
