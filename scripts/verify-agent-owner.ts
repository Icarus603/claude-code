import { readFile } from 'fs/promises'

const AGENT_APP_COMPAT_BUDGET = 158

async function main(): Promise<void> {
  // Root facades src/query.ts and src/QueryEngine.ts deleted in #129 follow-up
  // (zero remaining consumers). The app-compat coupling budget is enforced
  // directly against packages/agent/{query,QueryEngine}.ts.
  const [packageQuery, packageQueryEngine] = await Promise.all([
    readFile('packages/agent/query.ts', 'utf8'),
    readFile('packages/agent/QueryEngine.ts', 'utf8'),
  ])

  const appCompatRefs =
    (packageQuery.match(/@claude-code\/app-compat\//g) ?? []).length +
    (packageQueryEngine.match(/@claude-code\/app-compat\//g) ?? []).length

  if (appCompatRefs > AGENT_APP_COMPAT_BUDGET) {
    throw new Error(
      `Agent owner budget regressed: current=${appCompatRefs}, budget=${AGENT_APP_COMPAT_BUDGET}`,
    )
  }

  console.log('agent owner verification passed')
}

await main()
