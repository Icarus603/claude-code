#!/usr/bin/env bun
/**
 * Audit 06: ?? null/[]/{}/0 in critical paths.
 *
 * Pattern: `something() ?? []` where `something()` returning null is
 * NOT just an absence (success case) but a real failure that the
 * caller silently masks.
 *
 * Heuristic: lines containing `?? []` / `?? {}` / `?? null` / `?? 0` /
 * `?? false` / `?? ''` in files that look like critical-path code:
 * - packages/agent/{hooks,query,createDeps,attachments,messages}.ts
 * - packages/agent/internal/*
 * - packages/permission/*
 * - packages/provider/*
 * - packages/config/plugin/*
 * - packages/repl/src/screens/*
 *
 * In other files, ?? is usually just a default; flag-only-when-critical
 * keeps signal-to-noise high.
 */
import { emitJson, summarize, type Finding, type AuditResult } from './lib.js'
import { execSync } from 'child_process'

const CRITICAL_PATTERNS = [
  /^packages\/agent\/(hooks|query|createDeps|attachments|messages)\.ts$/,
  /^packages\/agent\/internal\//,
  /^packages\/agent\/host\.ts$/,
  /^packages\/agent\/agentHostBindings\.ts$/,
  /^packages\/permission\/.*\.ts$/,
  /^packages\/provider\/.*\.ts$/,
  /^packages\/config\/plugin\/.*\.ts$/,
  /^packages\/app-host\/.*\.ts$/,
  /^packages\/repl\/src\/screens\/.*\.tsx?$/,
]

let raw = ''
try {
  raw = execSync(
    `grep -rEn '\\?\\?\\s*(\\[\\]|\\{\\}|null|undefined|0|false|"")' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=__tests__`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

const findings: Finding[] = []
let total = 0
for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  total++
  const [_, file, lineStr, content] = m
  if (!CRITICAL_PATTERNS.some(re => re.test(file))) continue
  // Skip comment lines
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue
  // Skip patterns that are clearly safe defaults (string concat, length etc.)
  if (/length\s*\?\?/.test(content)) continue

  // Highlight specifically the kind likely to mask failure: `await fn() ?? []`
  // or `fn() ?? null` where fn() can throw / return null on real error.
  const isCallChain = /\)\s*\?\?\s*(\[\]|\{\}|null|undefined|0|false|"")/.test(content)
  findings.push({
    pattern: 'nullish-coalesce-critical-path',
    file,
    line: parseInt(lineStr, 10),
    snippet: content.trim().slice(0, 140),
    severity: isCallChain ? 'MEDIUM' : 'LOW',
    note: `\`??\` default in critical-path file. If the LHS expression returning null/undefined indicates a real failure (not just absence), this default silently masks it. Verify whether the LHS must be non-null for the caller to function correctly.`,
  })
}

const result: AuditResult = {
  pattern: 'nullish-coalesce-critical-path',
  description: '?? defaults in critical-path files where the LHS may indicate real failure',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
