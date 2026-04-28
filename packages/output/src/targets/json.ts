import type { OutputEvent, OutputTarget } from '../contracts.js'

export class JsonOutputTarget implements OutputTarget {
  constructor(
    private write: (line: string) => void = line => {
      console.log(line)
    },
  ) {}

  emit(event: OutputEvent): void {
    this.write(JSON.stringify(event))
  }
}
