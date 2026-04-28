#!/usr/bin/env bun
/**
 * Audit 01c: for each unwired+NOOP slot from 01b, count REAL importers.
 *
 * Real importer = a file that imports the paired getter from a _deps.ts
 * (any path containing _deps). Filters out same-name coincidences.
 */
import { execSync } from 'child_process'
import { readSafe, findFiles } from './lib.js'

// True latent bugs from 01b
const TRUE_BUGS = [
  ['setSetAppStateFn', 'setAppState'],
  ['setClearAgentDefinitionsCacheFn', 'clearAgentDefinitionsCache'],
  ['setClearAllOutputStylesCacheFn', 'clearAllOutputStylesCache'],
  ['setClearCommandsCacheFn', 'clearCommandsCache'],
  ['setClearPromptCacheFn', 'clearPromptCache'],
  ['setRipGrepFn', 'ripGrep'],
  ['setUnzipFileFn', 'unzipFile'],
  ['setParseAgentToolsFromFrontmatterFn', 'parseAgentToolsFromFrontmatter'],
  ['setParseSlashCommandToolsFromFrontmatterFn', 'parseSlashCommandToolsFromFrontmatter'],
  ['setParseShellFrontmatterFn', 'parseShellFrontmatter'],
  ['setParseBooleanFrontmatterFn', 'parseBooleanFrontmatter'],
  ['setParsePositiveIntFromFrontmatterFn', 'parsePositiveIntFromFrontmatter'],
  ['setParseEffortValueFn', 'parseEffortValue'],
  ['setParseYamlFn', 'parseYaml'],
  ['setParseArgumentNamesFn', 'parseArgumentNames'],
  ['setParseUserSpecifiedModelFn', 'parseUserSpecifiedModel'],
  ['setParseZipModesFn', 'parseZipModes'],
  ['setParseAndValidateManifestFromBytesFn', 'parseAndValidateManifestFromBytes'],
  ['setGetAgentDefinitionsWithOverridesFn', 'getAgentDefinitionsWithOverrides'],
  ['setIsFsInaccessibleFn', 'isFsInaccessible'],
  ['setHasShownHintThisSessionFn', 'hasShownHintThisSession'],
  ['setSetPendingHintFn', 'setPendingHint'],
  ['setGetSystemDirectoriesFn', 'getSystemDirectories'],
  ['setFindCanonicalGitRootFn', 'findCanonicalGitRoot'],
  ['setGetAdditionalDirectoriesForClaudeMdFn', 'getAdditionalDirectoriesForClaudeMd'],
  ['setGetUseCoworkPluginsFn', 'getUseCoworkPlugins'],
  ['setResetSentSkillNamesFn', 'resetSentSkillNames'],
  ['setUninstallPluginOpFn', 'uninstallPluginOp'],
  ['setUpdatePluginOpFn', 'updatePluginOp'],
] as const

console.log('setter | getter | files importing getter from _deps | files calling getter()')
console.log('-'.repeat(100))
let totalReal = 0
const realBugs: Array<{setter: string; getter: string; importers: string[]}> = []
for (const [setter, getter] of TRUE_BUGS) {
  // Find files that import this getter from _deps
  let raw = ''
  try {
    raw = execSync(
      `grep -rlE "import\\s*\\{[^}]*\\b${getter}\\b[^}]*\\}\\s*from\\s*['\\\"][^'\\\"]*_deps[^'\\\"]*['\\\"]" packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8' },
    )
  } catch {}
  const importers = raw.trim().split('\n').filter(Boolean)
  // Filter to those that ALSO call ${getter}( anywhere
  const realImporters: string[] = []
  for (const file of importers) {
    const text = readSafe(file)
    // Has both: import line and call site
    if (new RegExp(`\\b${getter}\\s*\\(`).test(text)) realImporters.push(file)
  }
  console.log(`${setter.padEnd(50)} ${getter.padEnd(40)} ${importers.length.toString().padStart(3)} -> ${realImporters.length}`)
  if (realImporters.length > 0) {
    totalReal += realImporters.length
    realBugs.push({ setter, getter, importers: realImporters })
  }
}
console.log('-'.repeat(100))
console.log(`Total real-bug call sites: ${totalReal}`)
console.log(`Slots with at least one real reader: ${realBugs.length} / ${TRUE_BUGS.length}`)
