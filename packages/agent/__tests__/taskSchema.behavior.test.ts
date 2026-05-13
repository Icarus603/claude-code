import { describe, expect, test } from 'bun:test'

import { TASK_STATUSES, TaskSchema, TaskStatusSchema } from '../tasks.ts'

/**
 * Pin Task schema invariants. TaskCreate/TaskUpdate/TaskList tools all
 * validate against TaskSchema; any drift breaks the entire task list
 * protocol (LLM input validation, persisted JSON shape).
 */
describe('Task schema invariants', () => {
  test('TASK_STATUSES = ["pending", "in_progress", "completed"] (exact order)', () => {
    // Order is sometimes used by display layers — pin it.
    expect([...TASK_STATUSES]).toEqual(['pending', 'in_progress', 'completed'])
  })

  test('TaskStatusSchema accepts ONLY the 3 valid statuses', () => {
    const schema = TaskStatusSchema()
    expect(schema.parse('pending')).toBe('pending')
    expect(schema.parse('in_progress')).toBe('in_progress')
    expect(schema.parse('completed')).toBe('completed')
    expect(() => schema.parse('done')).toThrow()
    expect(() => schema.parse('')).toThrow()
    expect(() => schema.parse('PENDING')).toThrow()
  })

  test('TaskSchema requires id, subject, description, status, blocks, blockedBy', () => {
    const schema = TaskSchema()
    const valid = {
      id: '1',
      subject: 'Test',
      description: 'desc',
      status: 'pending' as const,
      blocks: [],
      blockedBy: [],
    }
    expect(() => schema.parse(valid)).not.toThrow()

    // Each required field, when missing, → throws
    for (const field of ['id', 'subject', 'description', 'status', 'blocks', 'blockedBy'] as const) {
      const partial = { ...valid }
      delete (partial as any)[field]
      expect(() => schema.parse(partial)).toThrow()
    }
  })

  test('blocks/blockedBy must be arrays of strings (not undefined, not nested)', () => {
    const schema = TaskSchema()
    const base = {
      id: '1',
      subject: 'T',
      description: 'D',
      status: 'pending' as const,
    }
    expect(() => schema.parse({ ...base, blocks: [], blockedBy: [] })).not.toThrow()
    expect(() => schema.parse({ ...base, blocks: ['2'], blockedBy: [] })).not.toThrow()
    expect(() => schema.parse({ ...base, blocks: [2 as any], blockedBy: [] })).toThrow()
    expect(() => schema.parse({ ...base, blocks: undefined as any, blockedBy: [] })).toThrow()
  })

  test('optional fields: activeForm, owner, metadata', () => {
    const schema = TaskSchema()
    const base = {
      id: '1',
      subject: 'T',
      description: 'D',
      status: 'pending' as const,
      blocks: [],
      blockedBy: [],
    }
    expect(() => schema.parse(base)).not.toThrow() // all optionals omitted
    expect(() =>
      schema.parse({ ...base, activeForm: 'Doing T', owner: 'agent-1', metadata: { x: 1 } }),
    ).not.toThrow()
  })

  test('metadata accepts arbitrary keys with unknown values', () => {
    const schema = TaskSchema()
    const base = {
      id: '1',
      subject: 'T',
      description: 'D',
      status: 'pending' as const,
      blocks: [],
      blockedBy: [],
    }
    // String, number, boolean, array, nested object
    expect(() =>
      schema.parse({
        ...base,
        metadata: { str: 'x', num: 1, bool: true, arr: [1, 2], obj: { nested: 'y' } },
      }),
    ).not.toThrow()
  })

  test('id is a string (NOT number) — pin so TaskCreate doesn\'t accept numeric IDs', () => {
    // The high-water-mark stores the max ID as a string; numeric IDs
    // would break the lexicographic comparison and cause collisions.
    const schema = TaskSchema()
    const base = {
      id: 1 as any,
      subject: 'T',
      description: 'D',
      status: 'pending' as const,
      blocks: [],
      blockedBy: [],
    }
    expect(() => schema.parse(base)).toThrow()
  })

  test('rejects unknown statuses ("deleted" not in core schema)', () => {
    // "deleted" is a TaskUpdate-only verb that removes the task; it's
    // not a persistent state. Pin so a "let's add deleted to the enum"
    // refactor that didn't audit all consumers doesn't slip through.
    const schema = TaskSchema()
    const base = {
      id: '1',
      subject: 'T',
      description: 'D',
      status: 'deleted' as any,
      blocks: [],
      blockedBy: [],
    }
    expect(() => schema.parse(base)).toThrow()
  })
})
