#!/usr/bin/env bun
// V7 §8.21 — verify that session memory paths resolve correctly.
//
// Reproduces the bug where permission host bindings missing `getSessionId` /
// `getProjectDir` produced `<cwd>/unknown/session-memory/...` instead of the
// real per-session path under `~/.claude/projects/<project>/<sessionId>/`.

import { existsSync } from 'node:fs'
import { sep, resolve } from 'node:path'
import 'src/runtime/bootstrap.js'
import {
  getSessionMemoryDir,
  getSessionMemoryPath,
} from '@claude-code/permission/filesystem'

const dir = getSessionMemoryDir()
const file = getSessionMemoryPath()

console.log('session-memory dir :', dir)
console.log('session-memory file:', file)

const looksWrong =
  dir.includes(`${sep}unknown${sep}`) ||
  dir.endsWith(`${sep}unknown${sep}session-memory${sep}`)

if (looksWrong) {
  console.error('\n❌ FAIL — path falls back to "unknown" sentinel.')
  process.exit(1)
}

// Belt-and-braces: a stray <cwd>/unknown/ dir means SessionMemory wrote to
// the wrong place during a real session.
const strayDir = resolve(process.cwd(), 'unknown')
if (existsSync(strayDir)) {
  console.error(
    `\n❌ FAIL — stray fallback directory found at ${strayDir}.`,
  )
  process.exit(1)
}

console.log('\n✓ PASS — path resolves to a real session id.')
