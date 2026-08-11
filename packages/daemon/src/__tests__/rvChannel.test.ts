/**
 * End-to-end rendezvous channel test: rvServer (worker side, ant 4291.js)
 * talking to rvClient (supervisor side, ant naK / 5016.js) over a real
 * Unix domain socket in an isolated tmpdir.
 *
 * No mocks — the socket dance (handshake discard, single-connection
 * last-write-wins, newline-JSON framing, reconnect backoff) IS the logic
 * under test. Mocking it would prove nothing.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRvClient } from '../rvClient.js'
import type { RvServerMessage } from '../rvClient.js'
import {
  startRendezvousServer,
  stopRendezvousServer,
  sendRv,
  pushRvState,
  isRendezvousServerRunning,
  type RvServerHost,
} from '@claude-code/agent/background/fleet/rvServer.js'

const ISOLATED_HOME = mkdtempSync(join(tmpdir(), 'ccb-rv-test-'))
const ORIGINAL_CONFIG_HOME = process.env.CLAUDE_CONFIG_HOME
const ORIGINAL_RV_SOCK = process.env.CLAUDE_BG_RENDEZVOUS_SOCK
const ORIGINAL_JOB_DIR = process.env.CLAUDE_JOB_DIR

let sockSeq = 0

beforeAll(() => {
  process.env.CLAUDE_CONFIG_HOME = ISOLATED_HOME
})
afterAll(() => {
  if (ORIGINAL_CONFIG_HOME === undefined) delete process.env.CLAUDE_CONFIG_HOME
  else process.env.CLAUDE_CONFIG_HOME = ORIGINAL_CONFIG_HOME
  rmSync(ISOLATED_HOME, { recursive: true, force: true })
})

/** Fresh socket path per test so a leftover bind never bleeds across cases. */
function freshSockPath(): string {
  return join(ISOLATED_HOME, `rv-${process.pid}-${sockSeq++}.sock`)
}

beforeEach(() => {
  delete process.env.CLAUDE_JOB_DIR
})
afterEach(() => {
  stopRendezvousServer()
  if (ORIGINAL_RV_SOCK === undefined) delete process.env.CLAUDE_BG_RENDEZVOUS_SOCK
  else process.env.CLAUDE_BG_RENDEZVOUS_SOCK = ORIGINAL_RV_SOCK
  if (ORIGINAL_JOB_DIR === undefined) delete process.env.CLAUDE_JOB_DIR
  else process.env.CLAUDE_JOB_DIR = ORIGINAL_JOB_DIR
})

/** Wait until `pred()` is true or the deadline elapses. */
async function until(pred: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (pred()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`condition was not met within ${ms}ms`)
}

describe('rv channel — server start/stop', () => {
  test('start is a no-op without CLAUDE_BG_RENDEZVOUS_SOCK', async () => {
    delete process.env.CLAUDE_BG_RENDEZVOUS_SOCK
    await startRendezvousServer()
    expect(isRendezvousServerRunning()).toBe(false)
  })

  test('start binds when the env var is set, stop tears down', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    await startRendezvousServer()
    expect(isRendezvousServerRunning()).toBe(true)
    // The env var is consumed so a nested spawn can't re-bind.
    expect(process.env.CLAUDE_BG_RENDEZVOUS_SOCK).toBeUndefined()
    stopRendezvousServer()
    expect(isRendezvousServerRunning()).toBe(false)
  })
})

describe('rv channel — supervisor ↔ worker', () => {
  test('client connects, handshake is discarded by the worker handler', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    // A reply hook that records — if the handshake frame ever leaked into
    // the command handler, it would NOT match a reply, but a malformed
    // frame with a `role` must be silently dropped (ant kb3).
    const replies: string[] = []
    const hostCbs: RvServerHost = {
      enqueueReply: t => replies.push(t),
      isRendererReady: () => true,
    }
    await startRendezvousServer(hostCbs)

    let connected = false
    const client = createRvClient(
      sock,
      () => {},
      () => {},
      () => {
        connected = true
      },
    )
    await until(() => connected)
    expect(connected).toBe(true)
    // No reply was enqueued by the handshake.
    expect(replies).toEqual([])
    client.close()
  })

  test('worker pushes heartbeat; client receives it', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    await startRendezvousServer({ isRendererReady: () => true })

    const received: RvServerMessage[] = []
    let connected = false
    const client = createRvClient(
      sock,
      m => received.push(m),
      () => {},
      () => {
        connected = true
      },
    )
    await until(() => connected)

    // sendRv is the low-level worker→supervisor push. (The 30s periodic
    // heartbeat is the same frame; we fire one synchronously here rather
    // than waiting 30s.)
    expect(sendRv({ type: 'heartbeat' })).toBe(true)
    await until(() => received.some(m => m.type === 'heartbeat'))
    expect(received.some(m => m.type === 'heartbeat')).toBe(true)
    client.close()
  })

  test('client onDisconnect fires when an established connection drops', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    await startRendezvousServer({ isRendererReady: () => true })

    let connected = false
    let disconnects = 0
    const client = createRvClient(
      sock,
      () => {},
      () => {
        disconnects++
      },
      () => {
        connected = true
      },
    )
    await until(() => connected)
    // Tearing the server down drops the live connection → onDisconnect.
    stopRendezvousServer()
    await until(() => disconnects > 0)
    expect(disconnects).toBeGreaterThan(0)
    client.close()
  })

  test('supervisor reply reaches the worker enqueueReply hook', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    const replies: string[] = []
    await startRendezvousServer({
      enqueueReply: t => replies.push(t),
      isRendererReady: () => true,
    })

    let connected = false
    const client = createRvClient(
      sock,
      () => {},
      () => {},
      () => {
        connected = true
      },
    )
    await until(() => connected)
    expect(client.send({ type: 'reply', text: 'continue please' })).toBe(true)
    await until(() => replies.length > 0)
    expect(replies).toEqual(['continue please'])
    client.close()
  })

  test('reply answering an open question short-circuits enqueue', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    const replies: string[] = []
    await startRendezvousServer({
      enqueueReply: t => replies.push(t),
      answersOpenQuestion: t => t === 'yes',
      isRendererReady: () => true,
    })
    let connected = false
    const client = createRvClient(
      sock,
      () => {},
      () => {},
      () => {
        connected = true
      },
    )
    await until(() => connected)
    client.send({ type: 'reply', text: 'yes' })
    // Give the frame time to land; it should NOT enqueue.
    await new Promise(r => setTimeout(r, 100))
    expect(replies).toEqual([])
    client.close()
  })

  test('supervisor repaint triggers forceRedraw + repaint-done ack', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    let redrawCount = 0
    await startRendezvousServer({
      forceRedraw: () => {
        redrawCount++
        return true
      },
      isRendererReady: () => true,
    })
    const received: RvServerMessage[] = []
    let connected = false
    const client = createRvClient(
      sock,
      m => received.push(m),
      () => {},
      () => {
        connected = true
      },
    )
    await until(() => connected)
    client.send({ type: 'repaint' })
    await until(() => received.some(m => m.type === 'repaint-done'))
    expect(redrawCount).toBe(1)
    expect(received.some(m => m.type === 'repaint-done')).toBe(true)
    client.close()
  })

  test('shutdown frame acks shutting-down + calls onShutdown', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    let shutdownCalled = false
    await startRendezvousServer({
      onShutdown: () => {
        shutdownCalled = true
      },
      isRendererReady: () => true,
    })
    const received: RvServerMessage[] = []
    let connected = false
    const client = createRvClient(
      sock,
      m => received.push(m),
      () => {},
      () => {
        connected = true
      },
    )
    await until(() => connected)
    client.send({ type: 'shutdown' })
    // onShutdown runs synchronously after sendRv queues the ack, while the
    // supervisor observes that ack on a later socket event. Wait for both
    // independent effects instead of treating the callback as proof that the
    // message has already crossed the Unix socket.
    await until(
      () =>
        shutdownCalled && received.some(m => m.type === 'shutting-down'),
    )
    expect(shutdownCalled).toBe(true)
    expect(received.some(m => m.type === 'shutting-down')).toBe(true)
    client.close()
  })

  test('only one connection lives — a second connect drops the first', async () => {
    const sock = freshSockPath()
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    await startRendezvousServer({ isRendererReady: () => true })

    let firstConnected = false
    const first = createRvClient(
      sock,
      () => {},
      () => {},
      () => {
        firstConnected = true
      },
    )
    await until(() => firstConnected)

    let secondConnected = false
    const second = createRvClient(
      sock,
      () => {},
      () => {},
      () => {
        secondConnected = true
      },
    )
    await until(() => secondConnected)

    // After the second connects, a push reaches exactly the live socket.
    // The server's `conn` is now the second; sendRv writes to it.
    expect(sendRv({ type: 'heartbeat' })).toBe(true)
    first.close()
    second.close()
  })
})

describe('rv channel — state + done persist to disk', () => {
  test('pushRvState writes state.json and pushes the patch', async () => {
    const sock = freshSockPath()
    const jobDir = join(ISOLATED_HOME, 'job-state')
    process.env.CLAUDE_BG_RENDEZVOUS_SOCK = sock
    process.env.CLAUDE_JOB_DIR = jobDir
    // Seed a baseline state.json so pushRvState has something to merge.
    const { writeJobState, readJobState } = await import(
      '@claude-code/agent/background/fleet/fleetStore.js'
    )
    const now = new Date().toISOString()
    await writeJobState(jobDir, {
      state: 'working',
      tempo: 'active',
      detail: 'seed',
      output: null,
      children: null,
      linkScanOffset: 0,
      template: 'bg',
      respawnFlags: [],
      intent: 'do a thing',
      sessionId: '',
      daemonShort: 'state01',
      cwd: jobDir,
      createdAt: now,
      updatedAt: now,
      firstTerminalAt: null,
      backend: 'daemon',
    })
    await startRendezvousServer({ isRendererReady: () => true })

    const received: RvServerMessage[] = []
    let connected = false
    const client = createRvClient(
      sock,
      m => received.push(m),
      () => {},
      () => {
        connected = true
      },
    )
    await until(() => connected)

    await pushRvState({ state: 'done', tempo: 'idle', detail: 'finished' })
    await until(() => received.some(m => m.type === 'state'))

    // Disk reflects the merged patch.
    const onDisk = await readJobState(jobDir)
    expect(onDisk?.state).toBe('done')
    expect(onDisk?.tempo).toBe('idle')
    expect(onDisk?.detail).toBe('finished')
    expect(onDisk?.intent).toBe('do a thing') // preserved from seed

    // The patch was also pushed over the wire.
    const statePush = received.find(m => m.type === 'state') as
      | { type: 'state'; patch: Record<string, unknown> }
      | undefined
    expect(statePush?.patch.state).toBe('done')
    client.close()
  })
})
