
export interface QueuedCommand {
  type: string
  payload?: unknown
}

export class CommandQueue {
  private queue: QueuedCommand[] = []

  enqueue(command: QueuedCommand): void {
    this.queue.push(command)
  }

  dequeue(): QueuedCommand | undefined {
    return this.queue.shift()
  }

  drain(): QueuedCommand[] {
    const commands = [...this.queue]
    this.queue.length = 0
    return commands
  }

  get length(): number {
    return this.queue.length
  }

  clear(): void {
    this.queue.length = 0
  }
}
