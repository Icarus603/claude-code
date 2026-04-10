import { readFile } from 'fs/promises'

const OPTIONAL_INTEGRATION_PACKAGES = [
  'packages/ide',
  'packages/teleport',
  'packages/updater',
  'packages/server',
]

const REQUIRED_FILES = [
  'package.json',
  'src/index.ts',
  'src/contracts.ts',
]

const DISALLOWED_PATTERNS = [
  '@claude-code/app-compat/',
  '@cc-app/',
  "from 'src/",
  'from "src/',
  "from '../src/",
  'from "../src/',
]

async function main(): Promise<void> {
  const violations: string[] = []

  for (const pkg of OPTIONAL_INTEGRATION_PACKAGES) {
    for (const file of REQUIRED_FILES) {
      const path = `${pkg}/${file}`
      try {
        const content = await readFile(path, 'utf8')
        for (const pattern of DISALLOWED_PATTERNS) {
          if (content.includes(pattern)) {
            violations.push(`${path}: contains disallowed pattern "${pattern}"`)
          }
        }
      } catch {
        violations.push(`${path}: missing required slot file`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Optional integration slot verification failed:\n${violations.join('\n')}`)
  }

  console.log('optional integration slot verification passed')
}

await main()
