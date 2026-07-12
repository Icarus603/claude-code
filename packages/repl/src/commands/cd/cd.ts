import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { LocalCommandCall } from '@claude-code/agent/command.js'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { setOriginalCwd } from '@claude-code/app-host/bootstrap/state.js'
import { clearSystemPromptSections } from '@claude-code/provider/systemPromptSections'
import { clearMemoryFileCaches } from '@claude-code/storage/claudemd.js'
import { setCwd } from '@claude-code/shell/Shell.js'
import { onCwdChangedForHooks } from '@claude-code/agent/fileChangedWatcher.js'

export const call: LocalCommandCall = async args => {
  const oldCwd = getCwd()
  const path = resolve(oldCwd, args.trim() || '.')
  const info = await stat(path)
  if (!info.isDirectory()) throw new Error(`Not a directory: ${path}`)
  process.chdir(path)
  setCwd(path)
  setOriginalCwd(path)
  clearSystemPromptSections()
  clearMemoryFileCaches()
  await onCwdChangedForHooks(oldCwd, path)
  return { type: 'text', value: `Working directory changed to ${path}` }
}
