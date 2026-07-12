/** Returns whether a token can be a slash-command name. */
export function looksLikeCommand(commandName: string): boolean {
  return !/[^a-zA-Z0-9:\-_]/.test(commandName)
}
