import { describe, expect, test } from 'bun:test'
import {
  COMMAND_NAME_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_ARGS_TAG,
  TERMINAL_OUTPUT_TAGS,
  BASH_INPUT_TAG,
  BASH_STDOUT_TAG,
  BASH_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  COMMON_HELP_ARGS,
  COMMON_INFO_ARGS,
  formatSkillLoadingMetadata,
} from '../xml.js'

describe('XML tag constants', () => {
  test('command tags follow kebab-case shape', () => {
    expect(COMMAND_NAME_TAG).toBe('command-name')
    expect(COMMAND_MESSAGE_TAG).toBe('command-message')
    expect(COMMAND_ARGS_TAG).toBe('command-args')
  })

  test('TERMINAL_OUTPUT_TAGS contains all 6 terminal sub-tags', () => {
    expect(TERMINAL_OUTPUT_TAGS).toEqual([
      BASH_INPUT_TAG,
      BASH_STDOUT_TAG,
      BASH_STDERR_TAG,
      LOCAL_COMMAND_STDOUT_TAG,
      LOCAL_COMMAND_STDERR_TAG,
      LOCAL_COMMAND_CAVEAT_TAG,
    ])
  })

  test('TERMINAL_OUTPUT_TAGS entries are all unique', () => {
    expect(new Set(TERMINAL_OUTPUT_TAGS).size).toBe(TERMINAL_OUTPUT_TAGS.length)
  })
})

describe('common arg classifier lists', () => {
  test('COMMON_HELP_ARGS includes the three canonical help patterns', () => {
    expect(COMMON_HELP_ARGS).toEqual(['help', '-h', '--help'])
  })

  test('COMMON_INFO_ARGS contains read-only intent verbs', () => {
    expect(COMMON_INFO_ARGS).toContain('list')
    expect(COMMON_INFO_ARGS).toContain('show')
    expect(COMMON_INFO_ARGS).toContain('status')
    expect(COMMON_INFO_ARGS).toContain('?')
  })

  test('COMMON_INFO_ARGS does not include destructive verbs (regression check)', () => {
    expect(COMMON_INFO_ARGS).not.toContain('delete')
    expect(COMMON_INFO_ARGS).not.toContain('remove')
    expect(COMMON_INFO_ARGS).not.toContain('reset')
  })
})

describe('formatSkillLoadingMetadata', () => {
  test('emits the three-line metadata block (command-message, command-name, skill-format)', () => {
    const out = formatSkillLoadingMetadata('my-skill')
    expect(out).toContain('<command-message>my-skill</command-message>')
    expect(out).toContain('<command-name>my-skill</command-name>')
    expect(out).toContain('<skill-format>true</skill-format>')
  })

  test('separates lines with \\n', () => {
    const lines = formatSkillLoadingMetadata('foo').split('\n')
    expect(lines).toHaveLength(3)
  })

  test('handles skill names with special chars (does not HTML-encode)', () => {
    // Skill loader inserts the raw name; renderer downstream is responsible
    // for escaping if needed. This test pins the current behavior.
    const out = formatSkillLoadingMetadata('a&b<c>')
    expect(out).toContain('<command-message>a&b<c></command-message>')
  })

  test('empty skill name produces empty tag content', () => {
    const out = formatSkillLoadingMetadata('')
    expect(out).toContain('<command-message></command-message>')
  })
})
