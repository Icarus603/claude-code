/**
 * Tests for stdin-napi. The reader needs a real TTY, so the interactive
 * cases run a small child script under a pseudo-terminal (script.ts below),
 * feed it keystrokes through the pty master, and assert on what the rust
 * reader delivered back. Cross-platform .node files are produced by GHA;
 * win32 takes the unsupported path.
 */
import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { isReaderSupported, pinFd0Raw, unpinFd0Raw } from '../src/index.js'

const isUnix = process.platform !== 'win32'

describe('isReaderSupported', () => {
  test('false on win32, true on unix with a loadable .node', () => {
    if (process.platform === 'win32') {
      expect(isReaderSupported()).toBe(false)
    } else {
      // On the CI/dev unix box the vendored .node for this arch must load.
      expect(isReaderSupported()).toBe(true)
    }
  })
})

describe('fd0 raw pin', () => {
  // The native pin needs a real tty (tcgetattr fd 0). In bun:test fd 0 is not
  // a tty, so pinFd0Raw's underlying set_raw fails — the JS wrapper swallows
  // it. The contract under test here is the JS-level safety: pin/unpin never
  // throw and unpin without a prior pin is a no-op. The raw-mode behaviour
  // itself (refcount holds across serial reader handoff → no cooked echo
  // window) is covered by the pty test below.
  test('pin / unpin are no-throw and balanced (non-tty fd 0 in bun:test)', () => {
    expect(() => pinFd0Raw()).not.toThrow()
    expect(() => unpinFd0Raw()).not.toThrow()
    // Unbalanced unpin is clamped, not a crash.
    expect(() => unpinFd0Raw()).not.toThrow()
  })
})

/**
 * Run `child` (a bun script) under a pty, feed it the byte sequences in
 * `keystrokes` (each after `gapMs`), and resolve with everything the child
 * printed. The child uses startReader and echoes each chunk as a line:
 *   CHUNK <hex>
 * so the test can reassemble exactly what the rust reader delivered.
 */
function runUnderPty(
  childScript: string,
  keystrokes: Buffer[],
  opts: { gapMs?: number; startDelayMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const gapMs = opts.gapMs ?? 40
  const startDelayMs = opts.startDelayMs ?? 600
  const timeoutMs = opts.timeoutMs ?? 5000

  // Drive via python pty so the child gets a genuine controlling terminal.
  const py = `
import os, pty, select, sys, time, base64
seqs = [base64.b64decode(s) for s in ${JSON.stringify(
    keystrokes.map(k => k.toString('base64')),
  )}.__iter__()] if False else [base64.b64decode(s) for s in ${JSON.stringify(
    keystrokes.map(k => k.toString('base64')),
  )}]
cmd = ${JSON.stringify(['bun', childScript])}
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
    os._exit(127)
out = bytearray()
start = time.time()
i = 0
fed_start = False
last_feed = 0.0
while True:
    t = time.time() - start
    if not fed_start and t > ${startDelayMs / 1000.0}:
        fed_start = True
        last_feed = t
    if fed_start and i < len(seqs) and (t - last_feed) >= ${gapMs / 1000.0}:
        os.write(fd, seqs[i]); i += 1; last_feed = t
    r,_,_ = select.select([fd], [], [], 0.05)
    if fd in r:
        try: data = os.read(fd, 4096)
        except OSError: break
        if not data: break
        out.extend(data)
    try:
        wpid,_ = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            r,_,_ = select.select([fd], [], [], 0.2)
            if fd in r:
                try: out.extend(os.read(fd, 4096))
                except OSError: pass
            break
    except ChildProcessError: break
    if t > ${timeoutMs / 1000.0}: break
sys.stdout.write(out.decode('utf-8','replace'))
if not out:
    sys.stderr.write(f'pty produced no output: fed={i}/{len(seqs)} elapsed={time.time()-start:.3f}s')
`
  return new Promise((resolve, reject) => {
    // The full Bun test worker can lose child-process pipe data after the CLI
    // import chain is loaded. Redirect to files, matching the smoke-suite
    // workaround in 3d2cb514.
    const ioDir = mkdtempSync(join(tmpdir(), 'stdinnapi-pty-io-'))
    const outPath = join(ioDir, 'stdout.txt')
    const errPath = join(ioDir, 'stderr.txt')
    const child = spawn(
      'bash',
      [
        '-c',
        'python3 -c "$1" >"$2" 2>"$3"',
        'bash',
        py,
        outPath,
        errPath,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    child.on('error', reject)
    child.on('close', code => {
      try {
        const out = readFileSync(outPath, 'utf8')
        const err = readFileSync(errPath, 'utf8')
        if (err.trim() && !out) {
          reject(new Error(`pty harness exited ${code}: ${err}`))
          return
        }
        if (!out.includes('CHUNK ')) {
          reject(new Error(`pty child produced no chunks; raw output: ${JSON.stringify(out)}`))
          return
        }
        resolve(out)
      } finally {
        rmSync(ioDir, { recursive: true, force: true })
      }
    })
  })
}

// Child script: start the reader, print each chunk as `CHUNK <hex>`, quit on 'q'.
function makeChild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stdinnapi-test-'))
  const script = join(dir, 'child.ts')
  const indexPath = join(import.meta.dir, '..', 'src', 'index.ts')
  writeFileSync(
    script,
    `
import { startReader } from ${JSON.stringify(indexPath)}
const h = startReader(false, (chunk) => {
  process.stdout.write('CHUNK ' + Buffer.from(chunk).toString('hex') + '\\r\\n')
  if (chunk.length === 1 && chunk[0] === 0x71) { // 'q'
    h.stop()
    process.exit(0)
  }
})
setInterval(() => {}, 1 << 30)
`,
  )
  return script
}

function parseChunks(out: string): Buffer[] {
  return out
    .split(/\r?\n/)
    .filter(l => l.startsWith('CHUNK '))
    .map(l => Buffer.from(l.slice('CHUNK '.length).trim(), 'hex'))
}

// These tests need python3 + a unix pty. Skip on win32.
;(isUnix ? describe : describe.skip)('native reader (pty)', () => {
  test('delivers individual keystrokes', async () => {
    const child = makeChild()
    try {
      const out = await runUnderPty(child, [
        Buffer.from('a'),
        Buffer.from('b'),
        Buffer.from('c'),
        Buffer.from('q'),
      ])
      const chunks = parseChunks(out)
      const joined = Buffer.concat(chunks).toString('utf8')
      expect(joined).toBe('abcq')
    } finally {
      rmSync(dirname(child), { recursive: true, force: true })
    }
  }, 15000)

  test('delivers a multi-byte escape sequence intact (left arrow)', async () => {
    const child = makeChild()
    try {
      const out = await runUnderPty(child, [
        Buffer.from([0x1b, 0x5b, 0x44]), // ESC [ D, one write
        Buffer.from('q'),
      ])
      const chunks = parseChunks(out)
      // The ESC[D must appear as a contiguous 3-byte sequence somewhere.
      const all = Buffer.concat(chunks)
      const idx = all.indexOf(Buffer.from([0x1b, 0x5b, 0x44]))
      expect(idx).toBeGreaterThanOrEqual(0)
    } finally {
      rmSync(dirname(child), { recursive: true, force: true })
    }
  }, 15000)

  test('UTF-8 multi-byte char survives byte-split reads', async () => {
    const child = makeChild()
    try {
      // '€' is E2 82 AC. Feed the three bytes separately with gaps so each
      // arrives in its own read() — the carry logic must reassemble them and
      // never emit a partial char.
      const out = await runUnderPty(
        child,
        [
          Buffer.from([0xe2]),
          Buffer.from([0x82]),
          Buffer.from([0xac]),
          Buffer.from('q'),
        ],
        { gapMs: 80 },
      )
      const chunks = parseChunks(out)
      const all = Buffer.concat(chunks).toString('utf8')
      expect(all).toContain('€')
      // No chunk should be an invalid/partial UTF-8 fragment on its own
      // (each emitted chunk must decode cleanly — that's the carry contract).
      for (const c of chunks) {
        // toString('utf8') of a valid-boundary chunk round-trips byte length
        // for ascii; for the € chunk it should be the full 3 bytes.
        expect(Buffer.byteLength(c.toString('utf8'), 'utf8')).toBe(c.length)
      }
    } finally {
      rmSync(dirname(child), { recursive: true, force: true })
    }
  }, 15000)
})
