import { describe, expect, test } from 'bun:test'
import { BackendArtifactStore } from '../stores/artifactStore.js'
import { FileSessionMetadataStore } from '../stores/sessionMetadataStore.js'
import { FileTranscriptStore } from '../stores/transcriptStore.js'
import type { StorageBackend } from '../contracts.js'

// Helper: in-memory storage backend for testing.
function makeBackend(initial: Record<string, string> = {}): StorageBackend {
  const data = new Map<string, string>(Object.entries(initial))
  return {
    read: async (path) => data.get(path) ?? null,
    write: async (path, content) => {
      data.set(path, typeof content === 'string' ? content : Buffer.from(content).toString('utf8'))
    },
    append: async (path, content) => {
      const existing = data.get(path) ?? ''
      data.set(
        path,
        existing +
          (typeof content === 'string' ? content : Buffer.from(content).toString('utf8')),
      )
    },
    delete: async (path) => {
      data.delete(path)
    },
    list: async () => Array.from(data.keys()),
  }
}

describe('FileSessionMetadataStore', () => {
  test('writeSessionMetadata writes JSON-stringified content', async () => {
    const backend = makeBackend()
    const store = new FileSessionMetadataStore(backend, '/sessions')
    await store.writeSessionMetadata('sess-1', { foo: 'bar', count: 42 })
    expect(await backend.read('/sessions/sess-1.metadata.json')).toBe(
      JSON.stringify({ foo: 'bar', count: 42 }, null, 2),
    )
  })

  test('readSessionMetadata reads + parses JSON', async () => {
    const backend = makeBackend({
      '/sessions/sess-1.metadata.json': '{"foo":"bar"}',
    })
    const store = new FileSessionMetadataStore(backend, '/sessions')
    expect(await store.readSessionMetadata('sess-1')).toEqual({ foo: 'bar' })
  })

  test('readSessionMetadata returns null when path missing', async () => {
    const store = new FileSessionMetadataStore(makeBackend(), '/sessions')
    expect(await store.readSessionMetadata('not-found')).toBeNull()
  })

  test('readSessionMetadata returns null on invalid JSON', async () => {
    // Defensive: corrupted metadata file must NOT throw — caller is
    // expected to fall back to empty state.
    const backend = makeBackend({
      '/sessions/sess-1.metadata.json': 'not valid json',
    })
    const store = new FileSessionMetadataStore(backend, '/sessions')
    expect(await store.readSessionMetadata('sess-1')).toBeNull()
  })

  test('readSessionMetadata returns null for non-object root JSON', async () => {
    // Critical: metadata file containing `null`, an array, or a primitive
    // must NOT be returned as the metadata Record. The Array/null check
    // is an explicit guard.
    const backend = makeBackend({
      '/sessions/null.metadata.json': 'null',
      '/sessions/array.metadata.json': '[1, 2, 3]',
      '/sessions/string.metadata.json': '"a string"',
      '/sessions/number.metadata.json': '42',
    })
    const store = new FileSessionMetadataStore(backend, '/sessions')
    expect(await store.readSessionMetadata('null')).toBeNull()
    expect(await store.readSessionMetadata('array')).toBeNull()
    expect(await store.readSessionMetadata('string')).toBeNull()
    expect(await store.readSessionMetadata('number')).toBeNull()
  })

  test('readSessionMetadata handles Uint8Array data from backend', async () => {
    // A binary backend may return Uint8Array. The store converts to UTF-8.
    const backend: StorageBackend = {
      read: async () => new TextEncoder().encode('{"data":1}'),
      write: async () => {},
      append: async () => {},
      delete: async () => {},
      list: async () => [],
    }
    const store = new FileSessionMetadataStore(backend, '/sessions')
    expect(await store.readSessionMetadata('s')).toEqual({ data: 1 })
  })

  test('metadataPath uses .metadata.json suffix (joins on path sep)', async () => {
    let writtenPath = ''
    const backend: StorageBackend = {
      read: async () => null,
      write: async (path) => {
        writtenPath = path
      },
      append: async () => {},
      delete: async () => {},
      list: async () => [],
    }
    const store = new FileSessionMetadataStore(backend, '/some/dir')
    await store.writeSessionMetadata('id-x', {})
    expect(writtenPath).toBe('/some/dir/id-x.metadata.json')
  })
})

describe('FileTranscriptStore', () => {
  test('appendSessionEvent appends to .jsonl path', async () => {
    let appendedPath = ''
    let appendedData = ''
    const backend: StorageBackend = {
      read: async () => null,
      write: async () => {},
      append: async (path, data) => {
        appendedPath = path
        appendedData = typeof data === 'string' ? data : ''
      },
      delete: async () => {},
      list: async () => [],
    }
    const store = new FileTranscriptStore(backend, '/sessions')
    await store.appendSessionEvent('sess-1', '{"line":1}\n')
    expect(appendedPath).toBe('/sessions/sess-1.jsonl')
    expect(appendedData).toBe('{"line":1}\n')
  })

  test('readSessionEvents splits on newlines, filters blank lines', async () => {
    const backend = makeBackend({
      '/sessions/s.jsonl': '{"a":1}\n{"b":2}\n\n{"c":3}\n',
    })
    const store = new FileTranscriptStore(backend, '/sessions')
    expect(await store.readSessionEvents('s')).toEqual([
      '{"a":1}',
      '{"b":2}',
      '{"c":3}',
    ])
  })

  test('readSessionEvents trims whitespace-only lines', async () => {
    // Each line has .trim() applied; lines that become empty are
    // filtered. Lines with internal whitespace preserve it.
    const backend = makeBackend({
      '/sessions/s.jsonl': '  line1  \n   \n line 2 \n',
    })
    const store = new FileTranscriptStore(backend, '/sessions')
    expect(await store.readSessionEvents('s')).toEqual(['line1', 'line 2'])
  })

  test('readSessionEvents empty file → []', async () => {
    const backend = makeBackend({ '/sessions/s.jsonl': '' })
    const store = new FileTranscriptStore(backend, '/sessions')
    expect(await store.readSessionEvents('s')).toEqual([])
  })

  test('readSessionEvents missing file → []', async () => {
    const store = new FileTranscriptStore(makeBackend(), '/sessions')
    expect(await store.readSessionEvents('missing')).toEqual([])
  })

  test('readSessionEvents handles Uint8Array (binary backend)', async () => {
    const backend: StorageBackend = {
      read: async () => new TextEncoder().encode('a\nb\n'),
      write: async () => {},
      append: async () => {},
      delete: async () => {},
      list: async () => [],
    }
    const store = new FileTranscriptStore(backend, '/sessions')
    expect(await store.readSessionEvents('s')).toEqual(['a', 'b'])
  })
})

describe('BackendArtifactStore', () => {
  test('writeArtifact delegates to backend.write', async () => {
    let writtenPath = ''
    let writtenData: unknown = null
    const backend: StorageBackend = {
      read: async () => null,
      write: async (path, data) => {
        writtenPath = path
        writtenData = data
      },
      append: async () => {},
      delete: async () => {},
      list: async () => [],
    }
    const store = new BackendArtifactStore(backend)
    await store.writeArtifact('/path/x.bin', 'content')
    expect(writtenPath).toBe('/path/x.bin')
    expect(writtenData).toBe('content')
  })

  test('readArtifact delegates to backend.read', async () => {
    const backend = makeBackend({ '/p/y.txt': 'hello' })
    const store = new BackendArtifactStore(backend)
    expect(await store.readArtifact('/p/y.txt')).toBe('hello')
  })

  test('readArtifact returns null when missing', async () => {
    const store = new BackendArtifactStore(makeBackend())
    expect(await store.readArtifact('/no')).toBeNull()
  })

  test('Uint8Array round-trips through writeArtifact/readArtifact', async () => {
    let stored: unknown = null
    const backend: StorageBackend = {
      read: async () => stored as never,
      write: async (_p, data) => {
        stored = data
      },
      append: async () => {},
      delete: async () => {},
      list: async () => [],
    }
    const store = new BackendArtifactStore(backend)
    const bin = new Uint8Array([1, 2, 3])
    await store.writeArtifact('/x', bin)
    expect(await store.readArtifact('/x')).toBe(bin)
  })
})
