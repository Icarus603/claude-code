import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createMovedToPluginCommand } from '../createMovedToPluginCommand.js'

const FAKE_CONTEXT = {} as never

describe('createMovedToPluginCommand — shape', () => {
  test('returns a Command with type=prompt', () => {
    const cmd = createMovedToPluginCommand({
      name: 'foo',
      description: 'desc',
      progressMessage: 'progressing',
      pluginName: 'my-plugin',
      pluginCommand: 'foo',
      getPromptWhileMarketplaceIsPrivate: async () => [
        { type: 'text', text: 'fallback' },
      ],
    })
    expect(cmd.type).toBe('prompt')
  })

  test('preserves the name field', () => {
    const cmd = createMovedToPluginCommand({
      name: 'mycmd',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: async () => [],
    })
    expect(cmd.name).toBe('mycmd')
  })

  test('userFacingName returns the same name', () => {
    const cmd = createMovedToPluginCommand({
      name: 'visible-name',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: async () => [],
    })
    expect(cmd.userFacingName()).toBe('visible-name')
  })

  test('preserves description and progressMessage', () => {
    const cmd = createMovedToPluginCommand({
      name: 'n',
      description: 'desc here',
      progressMessage: 'in-progress',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: async () => [],
    })
    expect(cmd.description).toBe('desc here')
    expect(cmd.progressMessage).toBe('in-progress')
  })

  test('source is "builtin"', () => {
    const cmd = createMovedToPluginCommand({
      name: 'n',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: async () => [],
    })
    expect(cmd.source).toBe('builtin')
  })

  test('contentLength is 0 (dynamic content)', () => {
    const cmd = createMovedToPluginCommand({
      name: 'n',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: async () => [],
    })
    expect(cmd.contentLength).toBe(0)
  })
})

describe('createMovedToPluginCommand — getPromptForCommand routing', () => {
  // The function has TWO branches based on USER_TYPE env var.
  // ant: returns the install instructions
  // non-ant: defers to getPromptWhileMarketplaceIsPrivate

  let savedUserType: string | undefined

  beforeEach(() => {
    savedUserType = process.env.USER_TYPE
  })

  afterEach(() => {
    if (savedUserType === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = savedUserType
  })

  test('ant USER_TYPE returns install instructions', async () => {
    process.env.USER_TYPE = 'ant'
    const fallback = mock(async () => [{ type: 'text' as const, text: 'should-not-call' }])
    const cmd = createMovedToPluginCommand({
      name: 'mycmd',
      description: '',
      progressMessage: '',
      pluginName: 'my-plugin',
      pluginCommand: 'mycmd',
      getPromptWhileMarketplaceIsPrivate: fallback,
    })
    if (cmd.type !== 'prompt' || !cmd.getPromptForCommand) {
      throw new Error('expected prompt command with getPromptForCommand')
    }
    const result = await cmd.getPromptForCommand('arg1 arg2', FAKE_CONTEXT)
    expect(fallback).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect((result[0] as { type: string }).type).toBe('text')
    const text = (result[0] as { text: string }).text
    expect(text).toContain('moved to a plugin')
    expect(text).toContain('claude plugin install my-plugin@claude-code-marketplace')
    expect(text).toContain('/my-plugin:mycmd')
    expect(text).toContain('claude-code-marketplace/blob/main/my-plugin/README.md')
  })

  test('ant install instructions interpolate pluginName + pluginCommand correctly', async () => {
    process.env.USER_TYPE = 'ant'
    const cmd = createMovedToPluginCommand({
      name: 'visible',
      description: '',
      progressMessage: '',
      pluginName: 'special-plugin',
      pluginCommand: 'special-command',
      getPromptWhileMarketplaceIsPrivate: async () => [],
    })
    if (cmd.type !== 'prompt' || !cmd.getPromptForCommand) {
      throw new Error('expected prompt command')
    }
    const result = await cmd.getPromptForCommand('', FAKE_CONTEXT)
    const text = (result[0] as { text: string }).text
    expect(text).toContain('special-plugin')
    expect(text).toContain('/special-plugin:special-command')
  })

  test('non-ant USER_TYPE delegates to getPromptWhileMarketplaceIsPrivate', async () => {
    process.env.USER_TYPE = 'external'
    const fallback = mock(async () => [{ type: 'text' as const, text: 'fallback-result' }])
    const cmd = createMovedToPluginCommand({
      name: 'cmd',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: fallback,
    })
    if (cmd.type !== 'prompt' || !cmd.getPromptForCommand) {
      throw new Error('expected prompt command')
    }
    const result = await cmd.getPromptForCommand('args', FAKE_CONTEXT)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback).toHaveBeenCalledWith('args', FAKE_CONTEXT)
    expect(result).toEqual([{ type: 'text', text: 'fallback-result' }])
  })

  test('USER_TYPE undefined delegates to getPromptWhileMarketplaceIsPrivate', async () => {
    delete process.env.USER_TYPE
    const fallback = mock(async () => [{ type: 'text' as const, text: 'no-env' }])
    const cmd = createMovedToPluginCommand({
      name: 'cmd',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: fallback,
    })
    if (cmd.type !== 'prompt' || !cmd.getPromptForCommand) {
      throw new Error('expected prompt command')
    }
    const result = await cmd.getPromptForCommand('', FAKE_CONTEXT)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ type: 'text', text: 'no-env' }])
  })

  test('USER_TYPE=ant comparison is case-sensitive', async () => {
    process.env.USER_TYPE = 'ANT'
    const fallback = mock(async () => [{ type: 'text' as const, text: 'fallback' }])
    const cmd = createMovedToPluginCommand({
      name: 'cmd',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: fallback,
    })
    if (cmd.type !== 'prompt' || !cmd.getPromptForCommand) {
      throw new Error('expected prompt command')
    }
    await cmd.getPromptForCommand('', FAKE_CONTEXT)
    // 'ANT' (uppercase) should NOT match 'ant' — falls through to fallback.
    expect(fallback).toHaveBeenCalled()
  })

  test('args are passed verbatim to fallback', async () => {
    process.env.USER_TYPE = 'external'
    const fallback = mock(async () => [{ type: 'text' as const, text: '' }])
    const cmd = createMovedToPluginCommand({
      name: 'cmd',
      description: '',
      progressMessage: '',
      pluginName: 'p',
      pluginCommand: 'c',
      getPromptWhileMarketplaceIsPrivate: fallback,
    })
    if (cmd.type !== 'prompt' || !cmd.getPromptForCommand) {
      throw new Error('expected prompt command')
    }
    await cmd.getPromptForCommand('arg with spaces', FAKE_CONTEXT)
    expect(fallback.mock.calls[0]?.[0]).toBe('arg with spaces')
  })
})
