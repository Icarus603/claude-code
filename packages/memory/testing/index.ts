/**
 * @claude-code/memory/testing
 *
 * V7 §9.11 — public in-memory seams for memory package tests.
 * Must NOT import from ../src/internal/.
 */
import type {
  MemFsImplementation,
  MemoryFileHeader,
  MemoryHostBindings,
} from '@claude-code/memory'

type DirEntry = {
  name: string
  isFile(): boolean
  isDirectory(): boolean
}

function createDirEntry(name: string, kind: 'file' | 'dir'): DirEntry {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
  }
}

/**
 * In-memory filesystem stub for memory package tests.
 */
export class MemoryFsStub implements MemFsImplementation {
  private readonly files = new Map<string, string>()
  private readonly directories = new Map<string, Set<string>>()

  constructor(seed?: Record<string, string>) {
    for (const [path, content] of Object.entries(seed ?? {})) {
      this.writeFile(path, content)
    }
  }

  readFileSync(path: string): string {
    const value = this.files.get(path)
    if (value === undefined) {
      throw new Error(`MemoryFsStub: file not found: ${path}`)
    }
    return value
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const names = [...(this.directories.get(path) ?? new Set<string>())].sort()
    return names.map(name => {
      const childPath = path.endsWith('/') ? `${path}${name}` : `${path}/${name}`
      return createDirEntry(name, this.files.has(childPath) ? 'file' : 'dir')
    })
  }

  async mkdir(path: string): Promise<void> {
    this.ensureDir(path)
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content)
    const segments = path.split('/').filter(Boolean)
    let current = ''
    for (let i = 0; i < segments.length - 1; i++) {
      current += `/${segments[i]}`
      this.ensureDir(current)
      this.directories.get(current)!.add(segments[i + 1]!)
    }
    const parent = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}` : '/'
    this.ensureDir(parent)
    this.directories.get(parent)!.add(segments[segments.length - 1]!)
  }

  private ensureDir(path: string): void {
    if (!this.directories.has(path)) {
      this.directories.set(path, new Set<string>())
    }
  }
}

/**
 * Host binding stub with deterministic no-op behavior.
 */
export function createMemoryHostBindings(
  overrides?: Partial<MemoryHostBindings>,
): MemoryHostBindings {
  const fs = new MemoryFsStub()
  return {
    now: () => 0,
    getCwd: () => process.cwd(),
    getOriginalCwd: () => process.cwd(),
    getConfigHomeDir: () => '/tmp/claude',
    getFsImplementation: () => fs,
    listCandidates: async () => [],
    scanMemoryFiles: async () => [],
    formatMemoryManifest: (memories: MemoryFileHeader[]) =>
      memories.map(memory => memory.filename).join('\n'),
    reportMemoryShapeTelemetry: () => {},
    clearMemoryFileCaches: () => {},
    registerDreamTask: () => 'dream-test-task',
    addDreamTurn: () => {},
    completeDreamTask: () => {},
    failDreamTask: () => {},
    getDreamTaskState: () => undefined,
    ...overrides,
  }
}
