// Keybinding type definitions
export type ParsedBinding = {
  chord: ParsedKeystroke[]
  action: string | null
  context: KeybindingContextName
}

export type ParsedKeystroke = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super: boolean
}

export type KeybindingContextName = string
export type KeybindingBlock = {
  context: KeybindingContextName
  bindings: Record<string, string | null>
}
export type Chord = ParsedKeystroke[]
export type KeybindingAction = string
