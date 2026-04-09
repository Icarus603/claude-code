import type { OutputEvent, OutputTarget } from '../contracts.js'

export class SilentOutputTarget implements OutputTarget {
  emit(_event: OutputEvent): void {}
}
