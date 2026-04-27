import * as React from 'react'
import { useMainLoopModel } from '@claude-code/repl/hooks/useMainLoopModel.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import { useAppState, useSetAppState } from '@claude-code/app-host/state/AppState.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import {
  type EffortLevel,
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getEffortValueDescription,
  isEffortLevel,
  toPersistableEffort,
} from '@claude-code/agent/effort.js'
import { updateSettingsForSource } from '@claude-code/config/settings'
import { readEnv } from '@claude-code/config/env/utils'
import { EffortPicker } from '@claude-code/repl/components/EffortPicker.js'

const COMMON_HELP_ARGS = ['help', '-h', '--help']

type EffortCommandResult = {
  message: string
  effortUpdate?: { value: EffortValue | undefined }
}

function setEffortValue(effortValue: EffortValue): EffortCommandResult {
  const persistable = toPersistableEffort(effortValue)
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable,
    })
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`,
      }
    }
  }
  logEvent('tengu_effort_command', {
    effort:
      effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts — if env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride()
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = readEnv('CLAUDE_CODE_EFFORT_LEVEL')
    if (persistable === undefined) {
      return {
        message: `Not applied: CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: { value: effortValue },
      }
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: { value: effortValue },
    }
  }

  const description = getEffortValueDescription(effortValue)
  const suffix = persistable !== undefined ? '' : ' (this session only)'
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: { value: effortValue },
  }
}

export function showCurrentEffort(
  appStateEffort: EffortValue | undefined,
  model: string,
): EffortCommandResult {
  const envOverride = getEffortEnvOverride()
  const effectiveValue =
    envOverride === null ? undefined : (envOverride ?? appStateEffort)
  if (effectiveValue === undefined) {
    const level = getDisplayedEffortLevel(model, appStateEffort)
    return { message: `Effort level: auto (currently ${level})` }
  }
  const description = getEffortValueDescription(effectiveValue)
  return {
    message: `Current effort level: ${effectiveValue} (${description})`,
  }
}

function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined,
  })
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`,
    }
  }
  logEvent('tengu_effort_command', {
    effort:
      'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  // env=auto/unset (null) matches what /effort auto asks for, so only warn
  // when env is pinning a specific level that will keep overriding.
  const envOverride = getEffortEnvOverride()
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = readEnv('CLAUDE_CODE_EFFORT_LEVEL')
    return {
      message: `Cleared effort from settings, but CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: { value: undefined },
    }
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: { value: undefined },
  }
}

export function executeEffort(args: string): EffortCommandResult {
  const normalized = args.toLowerCase()
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel()
  }

  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: low, medium, high, xhigh, max, auto`,
    }
  }

  return setEffortValue(normalized)
}

function ShowCurrentEffort({
  onDone,
}: {
  onDone: (result: string) => void
}): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue)
  const model = useMainLoopModel()
  const { message } = showCurrentEffort(effortValue, model)
  onDone(message)
  return null
}

/**
 * Interactive picker shown when /effort is invoked with no args. Uses
 * the visual Speed/Intelligence axis component (xhigh shimmers, max
 * rainbow-cycles). On confirm, applies the chosen level via the same
 * `setEffortValue` path that `/effort <level>` already takes — single
 * source of truth for both UI and CLI persistence semantics.
 */
function EffortPickerCommand({
  onDone,
}: {
  onDone: (result: string) => void
}): React.ReactNode {
  const setAppState = useSetAppState()
  const appStateEffort = useAppState(s => s.effortValue)
  const model = useMainLoopModel()
  // Initial focus = the level the API would actually use right now.
  const [committed, setCommitted] = React.useState(false)
  const initialLevel = React.useMemo<EffortLevel>(() => {
    return getDisplayedEffortLevel(model, appStateEffort)
  }, [model, appStateEffort])

  if (committed) {
    return null
  }
  return (
    <EffortPicker
      current={initialLevel}
      model={model}
      onConfirm={level => {
        setCommitted(true)
        const result = setEffortValue(level)
        if (result.effortUpdate) {
          setAppState(prev => ({
            ...prev,
            effortValue: result.effortUpdate!.value,
          }))
        }
        onDone(result.message)
      }}
      onCancel={() => {
        setCommitted(true)
        onDone('Effort unchanged')
      }}
    />
  )
}

function ApplyEffortAndClose({
  result,
  onDone,
}: {
  result: EffortCommandResult
  onDone: (result: string) => void
}): React.ReactNode {
  const setAppState = useSetAppState()
  const { effortUpdate, message } = result
  React.useEffect(() => {
    if (effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: effortUpdate.value,
      }))
    }
    onDone(message)
  }, [setAppState, effortUpdate, message, onDone])
  return null
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  args = args?.trim() || ''

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      [
        'Usage: /effort [low|medium|high|xhigh|max|auto|status]',
        '',
        'Run with no argument to open the interactive picker.',
        '',
        'Effort levels (Anthropic docs: platform.claude.com/docs/en/build-with-claude/effort):',
        '- low:    Most efficient — significant token savings, best for simple tasks',
        '- medium: Balanced — moderate token savings with solid performance',
        '- high:   High capability — equivalent to not setting the parameter (default)',
        '- xhigh:  Extended capability for long-horizon work (Opus 4.7 only)',
        '- max:    Absolute maximum capability with no constraints on token spending',
        '- auto:   Use the default effort level for your model',
      ].join('\n'),
    )
    return
  }

  if (args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />
  }

  // No argument → open the visual picker (Speed/Intelligence axis with
  // shimmer on xhigh and rainbow on max).
  if (!args) {
    return <EffortPickerCommand onDone={onDone} />
  }

  const result = executeEffort(args)
  return <ApplyEffortAndClose result={result} onDone={onDone} />
}
