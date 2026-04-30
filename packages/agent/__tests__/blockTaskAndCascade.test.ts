/**
 * Tests for the dependency-graph invariants in tasks.ts:
 *
 *   - blockTask must reject cycles (self-loop, A↔B, A→B→C→A) at write
 *     time. The previous implementation accepted them silently and the
 *     cycle would deadlock claimTask.
 *   - blockTask is bipartite: every (A.blocks ∋ B) must have a matching
 *     (B.blockedBy ∋ A), and concurrent calls must not break this.
 *   - cascadeUnblockOnCompletion must scrub the completed task ID from
 *     every other task's blockedBy and report which tasks just became
 *     fully unblocked. Without this, claimTask's read-side filter
 *     papers over the symptom but TaskGet output keeps showing ghost
 *     dependencies.
 *
 * Each test runs against an isolated CLAUDE_CONFIG_DIR (mkdtemp) so it
 * cannot collide with the operator's real ~/.claude/tasks. The
 * .lock file machinery in tasks.ts is shared across files, so we run
 * tests serially (no `test.concurrent`) to avoid lock contention from
 * unrelated cases.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { TaskCycleError } from '../errors.js'
import {
  blockTask,
  cascadeUnblockOnCompletion,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from '../tasks.js'

const TASK_LIST_ID = 'block-task-tests'

let originalConfigDir: string | undefined
let tmpRoot: string

beforeEach(async () => {
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  tmpRoot = await mkdtemp(join(tmpdir(), 'ccb-tasks-'))
  process.env.CLAUDE_CONFIG_DIR = tmpRoot
})

afterEach(async () => {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await rm(tmpRoot, { recursive: true, force: true })
})

async function makeTask(subject: string): Promise<string> {
  return createTask(TASK_LIST_ID, {
    subject,
    description: subject,
    status: 'pending',
    owner: undefined,
    blocks: [],
    blockedBy: [],
  })
}

describe('blockTask — cycle detection', () => {
  test('self-loop is rejected', async () => {
    const a = await makeTask('a')
    expect(blockTask(TASK_LIST_ID, a, a)).rejects.toBeInstanceOf(TaskCycleError)
  })

  test('two-node cycle (A↔B) is rejected', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    await blockTask(TASK_LIST_ID, a, b) // ok: a → b
    expect(blockTask(TASK_LIST_ID, b, a)).rejects.toBeInstanceOf(
      TaskCycleError,
    )
  })

  test('three-node cycle (A→B→C→A) is rejected', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    const c = await makeTask('c')
    await blockTask(TASK_LIST_ID, a, b)
    await blockTask(TASK_LIST_ID, b, c)
    expect(blockTask(TASK_LIST_ID, c, a)).rejects.toBeInstanceOf(
      TaskCycleError,
    )
  })

  test('cycle error includes the offending path', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    const c = await makeTask('c')
    await blockTask(TASK_LIST_ID, a, b)
    await blockTask(TASK_LIST_ID, b, c)
    let caught: TaskCycleError | undefined
    try {
      await blockTask(TASK_LIST_ID, c, a)
    } catch (err) {
      if (err instanceof TaskCycleError) caught = err
    }
    expect(caught).toBeDefined()
    // The path begins and ends with the offending source (`c`, the
    // fromTaskId of the rejected blockTask call) — that's the cycle
    // we'd have closed by accepting the edge.
    expect(caught!.path[0]).toBe(c)
    expect(caught!.path.at(-1)).toBe(c)
    // And the chain in between visits the existing edges (a, b).
    expect(caught!.path).toContain(a)
    expect(caught!.path).toContain(b)
  })

  test('non-cyclic edge passes', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    expect(blockTask(TASK_LIST_ID, a, b)).resolves.toBe(true)
    const taskA = await getTask(TASK_LIST_ID, a)
    const taskB = await getTask(TASK_LIST_ID, b)
    expect(taskA?.blocks).toEqual([b])
    expect(taskB?.blockedBy).toEqual([a])
  })
})

describe('blockTask — bipartite invariant', () => {
  test('idempotent: calling twice does not duplicate', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    await blockTask(TASK_LIST_ID, a, b)
    await blockTask(TASK_LIST_ID, a, b)
    const taskA = await getTask(TASK_LIST_ID, a)
    const taskB = await getTask(TASK_LIST_ID, b)
    expect(taskA?.blocks).toEqual([b])
    expect(taskB?.blockedBy).toEqual([a])
  })

  test('concurrent blockTask of distinct edges keeps invariant', async () => {
    // Spread work across multiple sources/targets so the edges are
    // independent — the test is whether the list-level lock serializes
    // them well enough to keep the bipartite invariant honest. With
    // the old per-task-locking implementation, edges to the same
    // target raced and one direction could be dropped.
    const sources = await Promise.all([
      makeTask('s1'),
      makeTask('s2'),
      makeTask('s3'),
      makeTask('s4'),
    ])
    const target = await makeTask('t')

    await Promise.all(sources.map(s => blockTask(TASK_LIST_ID, s, target)))

    const all = await listTasks(TASK_LIST_ID)
    const t = all.find(x => x.id === target)!
    expect(t.blockedBy.sort()).toEqual([...sources].sort())
    for (const s of sources) {
      const sTask = all.find(x => x.id === s)!
      expect(sTask.blocks).toEqual([target])
    }
  })

  test('repairs missing reverse edge when one side already has it', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    // Manually create an inconsistent state (only forward edge).
    await updateTask(TASK_LIST_ID, a, { blocks: [b] })
    expect((await getTask(TASK_LIST_ID, b))?.blockedBy).toEqual([])

    await blockTask(TASK_LIST_ID, a, b)
    expect((await getTask(TASK_LIST_ID, b))?.blockedBy).toEqual([a])
    expect((await getTask(TASK_LIST_ID, a))?.blocks).toEqual([b])
  })
})

describe('cascadeUnblockOnCompletion', () => {
  test('removes completed task ID from other tasks blockedBy', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    const c = await makeTask('c')
    await blockTask(TASK_LIST_ID, a, b)
    await blockTask(TASK_LIST_ID, a, c)

    await updateTask(TASK_LIST_ID, a, { status: 'completed' })
    const result = await cascadeUnblockOnCompletion(TASK_LIST_ID, a)
    expect(result.newlyUnblockedIds.sort()).toEqual([b, c].sort())

    const taskB = await getTask(TASK_LIST_ID, b)
    const taskC = await getTask(TASK_LIST_ID, c)
    expect(taskB?.blockedBy).toEqual([])
    expect(taskC?.blockedBy).toEqual([])
    // The completed task's own .blocks list is also scrubbed (the
    // entries are now stale references — symmetry is restored).
    const taskA = await getTask(TASK_LIST_ID, a)
    expect(taskA?.blocks).toEqual([])
  })

  test('does not report still-blocked tasks as newly unblocked', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    const c = await makeTask('c')
    // c blocked by both a and b
    await blockTask(TASK_LIST_ID, a, c)
    await blockTask(TASK_LIST_ID, b, c)

    await updateTask(TASK_LIST_ID, a, { status: 'completed' })
    const result = await cascadeUnblockOnCompletion(TASK_LIST_ID, a)
    // c still blocked by b; should NOT be in newlyUnblockedIds
    expect(result.newlyUnblockedIds).toEqual([])

    const taskC = await getTask(TASK_LIST_ID, c)
    expect(taskC?.blockedBy).toEqual([b])
  })

  test('completing the last blocker unblocks the dependent', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    const c = await makeTask('c')
    await blockTask(TASK_LIST_ID, a, c)
    await blockTask(TASK_LIST_ID, b, c)

    await updateTask(TASK_LIST_ID, a, { status: 'completed' })
    await cascadeUnblockOnCompletion(TASK_LIST_ID, a)

    await updateTask(TASK_LIST_ID, b, { status: 'completed' })
    const result = await cascadeUnblockOnCompletion(TASK_LIST_ID, b)
    expect(result.newlyUnblockedIds).toEqual([c])
  })
})

describe('deleteTask cascade', () => {
  test('removes references from both blocks and blockedBy', async () => {
    const a = await makeTask('a')
    const b = await makeTask('b')
    const c = await makeTask('c')
    await blockTask(TASK_LIST_ID, a, b)
    await blockTask(TASK_LIST_ID, b, c)

    expect(await deleteTask(TASK_LIST_ID, b)).toBe(true)
    const taskA = await getTask(TASK_LIST_ID, a)
    const taskC = await getTask(TASK_LIST_ID, c)
    expect(taskA?.blocks).toEqual([]) // b removed
    expect(taskC?.blockedBy).toEqual([]) // b removed
  })

  test('high water mark advances on delete to block ID reuse', async () => {
    // Phase S: deleteTask runs the high-water-mark write inside the
    // same list-level lock as the file delete + cascade. Without
    // this, a concurrent createTask could allocate the same ID
    // we're deleting before the cascade ran, and the new task would
    // inherit the about-to-be-scrubbed edges. We verify by deleting
    // a task and then confirming the next createTask gets a higher
    // ID (the high-water mark pulled the counter up).
    const a = await makeTask('first') // id "1"
    expect(await deleteTask(TASK_LIST_ID, a)).toBe(true)
    const b = await makeTask('second') // must NOT recycle "1"
    expect(b).not.toBe(a)
    expect(parseInt(b, 10)).toBeGreaterThan(parseInt(a, 10))
  })
})
