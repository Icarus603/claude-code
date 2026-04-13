/**
 * @claude-code/tool-registry/testing
 * V7 §9.11 — StubRegistry for hermetic tests.
 * Must NOT import from ../internal/.
 */
export type StubToolDefinition = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export class StubRegistry {
  private readonly _tools = new Map<string, StubToolDefinition>()

  register(tool: StubToolDefinition): void {
    this._tools.set(tool.name, tool)
  }

  unregister(name: string): boolean {
    return this._tools.delete(name)
  }

  get(name: string): StubToolDefinition | undefined {
    return this._tools.get(name)
  }

  getAll(): StubToolDefinition[] {
    return [...this._tools.values()]
  }

  reset(): void {
    this._tools.clear()
  }
}
