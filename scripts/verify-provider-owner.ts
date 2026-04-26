import { readFile } from 'fs/promises'

const PROVIDER_APP_COMPAT_BUDGET = 70

async function main(): Promise<void> {
  // Root facade src/services/api/claudeLegacy.ts deleted in #137 (zero
  // remaining consumers). The app-compat coupling budget is enforced
  // directly against packages/provider/claudeLegacy.ts.
  const [providerHostSetupRoot, providerHostSetupPkg, providerLegacy] =
    await Promise.all([
      readFile('packages/app-host/src/providerHostSetup.ts', 'utf8'),
      readFile('packages/provider/src/providerHostSetup.ts', 'utf8'),
      readFile('packages/provider/src/claudeLegacy.ts', 'utf8'),
    ])

  if (!providerHostSetupRoot.includes('installProviderRuntimeBindings(bindings)')) {
    throw new Error(
      'packages/app-host/src/providerHostSetup.ts no longer owns root provider binding composition',
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
