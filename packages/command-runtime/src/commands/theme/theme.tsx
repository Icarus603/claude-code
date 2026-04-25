import * as React from 'react'
import type { CommandResultDisplay } from '@claude-code/command-runtime/runtime'
import { Pane } from '@anthropic/ink'
import { ThemePicker } from '@claude-code/repl/components/ThemePicker.js'
import { useTheme } from '@anthropic/ink'
import type { LocalJSXCommandCall } from '@claude-code/agent/command.js'

type Props = {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}

function ThemePickerCommand({ onDone }: Props): React.ReactNode {
  const [, setTheme] = useTheme()

  return (
    <Pane color="permission">
      <ThemePicker
        onThemeSelect={setting => {
          setTheme(setting)
          onDone(`Theme set to ${setting}`)
        }}
        onCancel={() => {
          onDone('Theme picker dismissed', { display: 'system' })
        }}
        skipExitHandling={true}
      />
    </Pane>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context) => {
  return <ThemePickerCommand onDone={onDone} />
}
