/**
 * Tests for createPermissionRequestMessage + createPermissionResponseMessage
 * + their sandbox siblings — pure factories that build the cross-process
 * permission relay messages used by the swarm permission system.
 *
 * Wrong factory output = leader/worker exchange a permission message
 * that gets dropped by the schema validator → permission decision is
 * silently NEVER applied (worker hangs waiting; leader thinks it
 * already responded).
 *
 * The discriminated union for response (success vs error) is the
 * critical contract — wrong subtype breaks the SDK's ControlResponse
 * shape downstream.
 */
import { describe, expect, test } from 'bun:test'
import {
  createPermissionRequestMessage,
  createPermissionResponseMessage,
  createSandboxPermissionRequestMessage,
  createSandboxPermissionResponseMessage,
} from '../mailbox/index.js'

describe('createPermissionRequestMessage', () => {
  test('returns permission_request type with all required fields', () => {
    const m = createPermissionRequestMessage({
      request_id: 'perm-123',
      agent_id: 'researcher',
      tool_name: 'Bash',
      tool_use_id: 'tu_456',
      description: 'Run npm install',
      input: { command: 'npm install' },
    })
    expect(m.type).toBe('permission_request')
    expect(m.request_id).toBe('perm-123')
    expect(m.agent_id).toBe('researcher')
    expect(m.tool_name).toBe('Bash')
    expect(m.tool_use_id).toBe('tu_456')
    expect(m.description).toBe('Run npm install')
    expect(m.input).toEqual({ command: 'npm install' })
  })

  test('permission_suggestions defaults to empty array when omitted', () => {
    const m = createPermissionRequestMessage({
      request_id: 'x',
      agent_id: 'a',
      tool_name: 't',
      tool_use_id: 'tu',
      description: 'd',
      input: {},
    })
    expect(m.permission_suggestions).toEqual([])
  })

  test('permission_suggestions passed through verbatim', () => {
    const suggestions = [{ rule: 'Bash(npm install)' }]
    const m = createPermissionRequestMessage({
      request_id: 'x',
      agent_id: 'a',
      tool_name: 't',
      tool_use_id: 'tu',
      description: 'd',
      input: {},
      permission_suggestions: suggestions,
    })
    expect(m.permission_suggestions).toEqual(suggestions)
  })

  test('input field held by reference (not cloned)', () => {
    const input = { command: 'echo hi', env: { X: '1' } }
    const m = createPermissionRequestMessage({
      request_id: 'x',
      agent_id: 'a',
      tool_name: 't',
      tool_use_id: 'tu',
      description: 'd',
      input,
    })
    expect(m.input).toBe(input)
  })

  test('uses snake_case field names (SDK compat)', () => {
    // Documented contract: shapes mirror SDK's can_use_tool which
    // uses snake_case. Refactor must not switch to camelCase.
    const m = createPermissionRequestMessage({
      request_id: 'x',
      agent_id: 'a',
      tool_name: 't',
      tool_use_id: 'tu',
      description: 'd',
      input: {},
    })
    expect(Object.keys(m).sort()).toEqual([
      'agent_id',
      'description',
      'input',
      'permission_suggestions',
      'request_id',
      'tool_name',
      'tool_use_id',
      'type',
    ])
  })
})

describe('createPermissionResponseMessage — discriminated union', () => {
  test('success branch: includes response object', () => {
    const m = createPermissionResponseMessage({
      request_id: 'perm-1',
      subtype: 'success',
      updated_input: { command: 'safer command' },
      permission_updates: [{ rule: 'Bash' }],
    })
    expect(m.type).toBe('permission_response')
    expect(m.request_id).toBe('perm-1')
    expect(m.subtype).toBe('success')
    if (m.subtype === 'success') {
      expect(m.response?.updated_input).toEqual({ command: 'safer command' })
      expect(m.response?.permission_updates).toEqual([{ rule: 'Bash' }])
    }
  })

  test('success without optional fields: response is empty object', () => {
    const m = createPermissionResponseMessage({
      request_id: 'perm-1',
      subtype: 'success',
    })
    expect(m.subtype).toBe('success')
    if (m.subtype === 'success') {
      expect(m.response?.updated_input).toBeUndefined()
      expect(m.response?.permission_updates).toBeUndefined()
    }
  })

  test('error branch: includes error string, NO response object', () => {
    const m = createPermissionResponseMessage({
      request_id: 'perm-1',
      subtype: 'error',
      error: 'User denied',
    })
    expect(m.subtype).toBe('error')
    if (m.subtype === 'error') {
      expect(m.error).toBe('User denied')
    }
    // response field should NOT be on error variant
    expect((m as never as { response?: unknown }).response).toBeUndefined()
  })

  test('error without explicit error message: defaults to "Permission denied"', () => {
    const m = createPermissionResponseMessage({
      request_id: 'perm-1',
      subtype: 'error',
    })
    if (m.subtype === 'error') {
      expect(m.error).toBe('Permission denied')
    }
  })

  test('subtype discriminator is unique', () => {
    const success = createPermissionResponseMessage({
      request_id: 'x',
      subtype: 'success',
    })
    const error = createPermissionResponseMessage({
      request_id: 'x',
      subtype: 'error',
    })
    expect(success.subtype).not.toBe(error.subtype)
  })
})

describe('createSandboxPermissionRequestMessage', () => {
  test('returns sandbox_permission_request with all fields', () => {
    const m = createSandboxPermissionRequestMessage({
      requestId: 'sandbox-1',
      workerId: 'researcher@team',
      workerName: 'researcher',
      workerColor: 'blue',
      host: 'api.openai.com',
    })
    expect(m.type).toBe('sandbox_permission_request')
    expect(m.requestId).toBe('sandbox-1')
    expect(m.workerId).toBe('researcher@team')
    expect(m.workerName).toBe('researcher')
    expect(m.workerColor).toBe('blue')
    expect(m.hostPattern).toEqual({ host: 'api.openai.com' })
  })

  test('workerColor is optional', () => {
    const m = createSandboxPermissionRequestMessage({
      requestId: 'x',
      workerId: 'w',
      workerName: 'n',
      host: 'h',
    })
    expect(m.workerColor).toBeUndefined()
  })

  test('createdAt is set to current time (number)', () => {
    const before = Date.now()
    const m = createSandboxPermissionRequestMessage({
      requestId: 'x',
      workerId: 'w',
      workerName: 'n',
      host: 'h',
    })
    const after = Date.now()
    expect(m.createdAt).toBeGreaterThanOrEqual(before)
    expect(m.createdAt).toBeLessThanOrEqual(after)
  })
})

describe('createSandboxPermissionResponseMessage', () => {
  test('allow=true → emits with allow=true', () => {
    const m = createSandboxPermissionResponseMessage({
      requestId: 'sandbox-1',
      host: 'api.openai.com',
      allow: true,
    })
    expect(m.type).toBe('sandbox_permission_response')
    expect(m.requestId).toBe('sandbox-1')
    expect(m.host).toBe('api.openai.com')
    expect(m.allow).toBe(true)
  })

  test('allow=false → emits with allow=false', () => {
    const m = createSandboxPermissionResponseMessage({
      requestId: 'sandbox-1',
      host: 'api.openai.com',
      allow: false,
    })
    expect(m.allow).toBe(false)
  })

  test('timestamp is ISO string', () => {
    const m = createSandboxPermissionResponseMessage({
      requestId: 'x',
      host: 'h',
      allow: true,
    })
    expect(m.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

describe('cross-factory type discriminator uniqueness', () => {
  test('all 4 factories emit distinct `type` literals', () => {
    const types = new Set<string>()
    types.add(
      createPermissionRequestMessage({
        request_id: 'x',
        agent_id: 'a',
        tool_name: 't',
        tool_use_id: 'tu',
        description: 'd',
        input: {},
      }).type,
    )
    types.add(
      createPermissionResponseMessage({
        request_id: 'x',
        subtype: 'success',
      }).type,
    )
    types.add(
      createSandboxPermissionRequestMessage({
        requestId: 'x',
        workerId: 'w',
        workerName: 'n',
        host: 'h',
      }).type,
    )
    types.add(
      createSandboxPermissionResponseMessage({
        requestId: 'x',
        host: 'h',
        allow: true,
      }).type,
    )
    expect(types.size).toBe(4)
  })
})
