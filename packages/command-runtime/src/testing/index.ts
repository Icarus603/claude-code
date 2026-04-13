/**
 * @claude-code/command-runtime/testing
 * V7 §9.11 — StubCommandRuntime for hermetic tests.
 * Must NOT import from ../internal/.
 */
export type StubCommandDefinition = {
  name: string
  description?: string
  aliases?: string[]
}

export class StubCommandRuntime {
  private readonly _commands: StubCommandDefinition[] = []

  addCommand(cmd: StubCommandDefinition): void {
    this._commands.push(cmd)
  }

  async getCommands(): Promise<StubCommandDefinition[]> {
    return [...this._commands]
  }

  find(name: string): StubCommandDefinition | undefined {
    return this._commands.find(c => c.name === name || c.aliases?.includes(name))
  }

  get(name: string): StubCommandDefinition {
    const cmd = this.find(name)
    if (!cmd) throw new Error(`Command not found: ${name}`)
    return cmd
  }

  reset(): void {
    this._commands.length = 0
  }
}
