import type React from 'react'

type UiBindingMap = Record<string, any>

let uiBindings: UiBindingMap | null = null

function missingBinding(name: string): (...args: any[]) => never {
  return (..._args: any[]) => {
    throw new Error(
      `Swarm UI binding "${name}" was accessed before installSwarmAppUi()`,
    )
  }
}

function getBinding<T>(name: string): T {
  if (!uiBindings || !(name in uiBindings)) {
    throw new Error(
      `Swarm UI binding "${name}" is unavailable. installSwarmAppUi() must run before using @claude-code/swarm UI helpers.`,
    )
  }
  return uiBindings[name] as T
}

export type OptionWithDescription<T = string> = {
  label: string
  value: T
  description?: string
}

export type ToolUseConfirm = unknown;
export type ToolPermissionContext = unknown;

export let Select = missingBinding('Select') as React.ComponentType<any>
export let Spinner = missingBinding('Spinner') as React.ComponentType<any>
export let useExitOnCtrlCDWithKeybindings = missingBinding(
  'useExitOnCtrlCDWithKeybindings',
) as () => { pending: boolean; keyName?: string }

export function installSwarmAppUi(bindings: UiBindingMap): void {
  uiBindings = bindings
  Select = getBinding('Select')
  Spinner = getBinding('Spinner')
  useExitOnCtrlCDWithKeybindings = getBinding(
    'useExitOnCtrlCDWithKeybindings',
  )
}
