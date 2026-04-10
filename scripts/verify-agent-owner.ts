import { readFile } from 'fs/promises'

const AGENT_APP_COMPAT_BUDGET = 158

async function main(): Promise<void> {
  const [queryFacade, queryEngineFacade, packageQuery, packageQueryEngine] =
    await Promise.all([
      readFile('src/query.ts', 'utf8'),
      readFile('src/QueryEngine.ts', 'utf8'),
      readFile('packages/agent/query.ts', 'utf8'),
      readFile('packages/agent/QueryEngine.ts', 'utf8'),
    ])

  const normalizedQueryFacade = queryFacade.trim()
  const normalizedQueryEngineFacade = queryEngineFacade.trim()

  if (normalizedQueryFacade !== "export * from '@claude-code/agent/query'") {
    throw new Error('src/query.ts is no longer a pure agent facade')
  }

  if (
    normalizedQueryEngineFacade !==
    "export * from '@claude-code/agent/query-engine'"
  ) {
    throw new Error('src/QueryEngine.ts is no longer a pure agent facade')
  }

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
