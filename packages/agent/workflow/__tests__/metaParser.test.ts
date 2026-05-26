import { describe, expect, test } from 'bun:test'
import { parseWorkflowScript } from '../metaParser.js'

describe('parseWorkflowScript', () => {
  test('splits a valid meta literal from the body', () => {
    const script = `export const meta = {
  name: "test-wf",
  description: "A test workflow",
  phases: [{ title: "Scan" }, { title: "Fix", detail: "one per item" }],
}
phase('Scan')
const x = await agent('hi')`
    const r = parseWorkflowScript(script)
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.meta.name).toBe('test-wf')
    expect(r.meta.description).toBe('A test workflow')
    expect(r.meta.phases).toHaveLength(2)
    expect(r.meta.phases?.[1]?.detail).toBe('one per item')
    expect(r.scriptBody.trim().startsWith("phase('Scan')")).toBe(true)
  })

  test('parses whenToUse when present', () => {
    const r = parseWorkflowScript(
      `export const meta = { name: "x", description: "d", whenToUse: "when foo" }\nbody`,
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.meta.whenToUse).toBe('when foo')
  })

  test('rejects a script with no meta declaration', () => {
    const r = parseWorkflowScript(`phase('x')\nawait agent('y')`)
    expect('error' in r).toBe(true)
  })

  test('rejects template interpolation in meta (non-literal)', () => {
    const r = parseWorkflowScript(
      'export const meta = { name: `a${y}`, description: "d" }\nbody',
    )
    expect('error' in r).toBe(true)
    if (!('error' in r)) return
    expect(r.error).toContain('pure literal')
  })

  test('rejects spread in meta (non-literal)', () => {
    const r = parseWorkflowScript(
      `export const meta = { ...base, name: "x", description: "d" }\nbody`,
    )
    expect('error' in r).toBe(true)
  })

  test('rejects function/arrow in meta (non-literal)', () => {
    const r = parseWorkflowScript(
      `export const meta = { name: "x", description: "d", f: () => 1 }\nbody`,
    )
    expect('error' in r).toBe(true)
  })

  test('does not miscount braces inside strings', () => {
    const r = parseWorkflowScript(
      `export const meta = { name: "a}b{c", description: "d{e}f" }\nREST`,
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.meta.name).toBe('a}b{c')
    expect(r.scriptBody.trim()).toBe('REST')
  })

  test('does not miscount braces inside comments', () => {
    const r = parseWorkflowScript(
      `export const meta = { name: "x", /* } } } */ description: "d" }\nREST`,
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.scriptBody.trim()).toBe('REST')
  })

  test('requires name and description', () => {
    expect('error' in parseWorkflowScript(`export const meta = { name: "x" }\nb`)).toBe(true)
    expect('error' in parseWorkflowScript(`export const meta = { description: "d" }\nb`)).toBe(true)
  })

  test('rejects an unclosed meta literal', () => {
    const r = parseWorkflowScript(`export const meta = { name: "x", description: "d"\nbody`)
    expect('error' in r).toBe(true)
  })
})
