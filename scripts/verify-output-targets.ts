import {
  JsonOutputTarget,
  SilentOutputTarget,
  TerminalOutputTarget,
  type OutputEvent,
} from '@claude-code/output'

async function main(): Promise<void> {
  const terminalLines: string[] = []
  const jsonLines: string[] = []

  const terminal = new TerminalOutputTarget(line => terminalLines.push(line))
  const json = new JsonOutputTarget(line => jsonLines.push(line))
  const silent = new SilentOutputTarget()

  const event: OutputEvent = {
    type: 'message',
    value: { text: 'runtime-output-ok' },
  }

  terminal.emit(event)
  json.emit(event)
  silent.emit(event)

  if (terminalLines.length !== 1) {
    throw new Error('TerminalOutputTarget did not emit exactly one line')
  }
  if (jsonLines.length !== 1) {
    throw new Error('JsonOutputTarget did not emit exactly one line')
  }

  const parsed = JSON.parse(jsonLines[0]) as OutputEvent
  if (parsed.type !== 'message') {
    throw new Error('JsonOutputTarget emitted an unexpected event payload')
  }

  console.log('output targets verification passed')
}

await main()
