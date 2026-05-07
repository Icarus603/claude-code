import { describe, expect, test } from 'bun:test'
import {
  CTRL_TAG,
  DATA_TAG,
  FRAME_HEADER_BYTES,
  createFrameDecoder,
  encodeCtrlFrame,
  encodeDataFrame,
  type DecodedFrame,
} from '../bg/ptyFrame.js'

describe('encodeDataFrame', () => {
  test('writes length BE + tag 0 + payload', () => {
    const frame = encodeDataFrame(Buffer.from('hi'))
    expect(frame.readUInt32BE(0)).toBe(2)
    expect(frame.readUInt8(4)).toBe(DATA_TAG)
    expect(frame.subarray(FRAME_HEADER_BYTES).toString()).toBe('hi')
    expect(frame.length).toBe(FRAME_HEADER_BYTES + 2)
  })

  test('accepts string payload (utf8 encoded)', () => {
    const frame = encodeDataFrame('héllo')
    expect(frame.readUInt32BE(0)).toBe(Buffer.from('héllo', 'utf8').length)
  })

  test('handles empty payload', () => {
    const frame = encodeDataFrame(Buffer.alloc(0))
    expect(frame.readUInt32BE(0)).toBe(0)
    expect(frame.readUInt8(4)).toBe(DATA_TAG)
    expect(frame.length).toBe(FRAME_HEADER_BYTES)
  })
})

describe('encodeCtrlFrame', () => {
  test('writes length BE + tag 1 + utf8 JSON', () => {
    const frame = encodeCtrlFrame({ t: 'live' })
    const body = frame.subarray(FRAME_HEADER_BYTES).toString('utf8')
    expect(JSON.parse(body)).toEqual({ t: 'live' })
    expect(frame.readUInt8(4)).toBe(CTRL_TAG)
  })

  test('hello frame includes replPid + version', () => {
    const frame = encodeCtrlFrame({
      t: 'hello',
      replPid: 12345,
      version: '2.1.131',
    })
    const obj = JSON.parse(
      frame.subarray(FRAME_HEADER_BYTES).toString('utf8'),
    )
    expect(obj.replPid).toBe(12345)
    expect(obj.version).toBe('2.1.131')
  })

  test('exit frame with optional signal', () => {
    const f1 = encodeCtrlFrame({ t: 'exit', code: 0 })
    expect(JSON.parse(f1.subarray(FRAME_HEADER_BYTES).toString())).toEqual({
      t: 'exit',
      code: 0,
    })
    const f2 = encodeCtrlFrame({ t: 'exit', code: 137, signal: 'SIGKILL' })
    expect(JSON.parse(f2.subarray(FRAME_HEADER_BYTES).toString())).toEqual({
      t: 'exit',
      code: 137,
      signal: 'SIGKILL',
    })
  })
})

describe('createFrameDecoder', () => {
  test('decodes a single complete data frame', () => {
    const seen: DecodedFrame[] = []
    const errors: string[] = []
    const feed = createFrameDecoder(
      f => seen.push(f),
      e => errors.push(e),
    )
    feed(encodeDataFrame(Buffer.from('hello')))
    expect(seen.length).toBe(1)
    expect(seen[0]!.kind).toBe(DATA_TAG)
    expect(
      seen[0]!.kind === DATA_TAG ? seen[0]!.payload.toString() : '',
    ).toBe('hello')
    expect(errors).toEqual([])
  })

  test('decodes a single complete ctrl frame', () => {
    const seen: DecodedFrame[] = []
    const feed = createFrameDecoder(
      f => seen.push(f),
      () => {},
    )
    feed(encodeCtrlFrame({ t: 'live' }))
    expect(seen.length).toBe(1)
    expect(seen[0]!.kind).toBe(CTRL_TAG)
  })

  test('reassembles a frame split across chunks', () => {
    const seen: DecodedFrame[] = []
    const feed = createFrameDecoder(
      f => seen.push(f),
      () => {},
    )
    const frame = encodeDataFrame(Buffer.from('split content'))
    // Split at byte 7 (header + 2 of payload).
    feed(frame.subarray(0, 7))
    expect(seen.length).toBe(0)
    feed(frame.subarray(7))
    expect(seen.length).toBe(1)
    expect(
      seen[0]!.kind === DATA_TAG ? seen[0]!.payload.toString() : '',
    ).toBe('split content')
  })

  test('decodes multiple frames from one chunk', () => {
    const seen: DecodedFrame[] = []
    const feed = createFrameDecoder(
      f => seen.push(f),
      () => {},
    )
    feed(
      Buffer.concat([
        encodeDataFrame(Buffer.from('one')),
        encodeCtrlFrame({ t: 'live' }),
        encodeDataFrame(Buffer.from('two')),
      ]),
    )
    expect(seen.length).toBe(3)
    expect(seen[0]!.kind).toBe(DATA_TAG)
    expect(seen[1]!.kind).toBe(CTRL_TAG)
    expect(seen[2]!.kind).toBe(DATA_TAG)
  })

  test('errors on frame too large', () => {
    const errors: string[] = []
    const feed = createFrameDecoder(
      () => {},
      e => errors.push(e),
    )
    // Hand-craft a header claiming 1 GiB body.
    const fakeHeader = Buffer.alloc(5)
    fakeHeader.writeUInt32BE(1024 * 1024 * 1024, 0)
    fakeHeader.writeUInt8(DATA_TAG, 4)
    feed(fakeHeader)
    expect(errors.length).toBe(1)
    expect(errors[0]!).toMatch(/frame too large/)
  })

  test('errors on bad ctrl JSON', () => {
    const errors: string[] = []
    const feed = createFrameDecoder(
      () => {},
      e => errors.push(e),
    )
    const body = Buffer.from('not-json{', 'utf8')
    const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length)
    frame.writeUInt32BE(body.length, 0)
    frame.writeUInt8(CTRL_TAG, 4)
    body.copy(frame, FRAME_HEADER_BYTES)
    feed(frame)
    expect(errors.length).toBe(1)
    expect(errors[0]!).toMatch(/bad ctrl json/)
  })

  test('errors on unknown tag', () => {
    const errors: string[] = []
    const feed = createFrameDecoder(
      () => {},
      e => errors.push(e),
    )
    const frame = Buffer.alloc(5)
    frame.writeUInt32BE(0, 0)
    frame.writeUInt8(99, 4)
    feed(frame)
    expect(errors.length).toBe(1)
    expect(errors[0]!).toMatch(/unknown frame kind 99/)
  })

  test('stops processing after an error', () => {
    const seen: DecodedFrame[] = []
    const errors: string[] = []
    const feed = createFrameDecoder(
      f => seen.push(f),
      e => errors.push(e),
    )
    // First frame: bad tag.
    const bad = Buffer.alloc(5)
    bad.writeUInt32BE(0, 0)
    bad.writeUInt8(99, 4)
    feed(bad)
    // Subsequent frame: should be ignored.
    feed(encodeDataFrame(Buffer.from('after')))
    expect(seen.length).toBe(0)
    expect(errors.length).toBe(1)
  })

  test('round-trip: encode N frames, decode N frames identically', () => {
    const inputs: DecodedFrame[] = [
      { kind: DATA_TAG, payload: Buffer.from([1, 2, 3, 4, 5]) },
      { kind: CTRL_TAG, ctrl: { t: 'hello', replPid: 100, version: '1.0' } },
      { kind: DATA_TAG, payload: Buffer.from('utf8 ✓ payload') },
      { kind: CTRL_TAG, ctrl: { t: 'resize', cols: 80, rows: 24 } },
      { kind: CTRL_TAG, ctrl: { t: 'exit', code: 0 } },
    ]
    const encoded = Buffer.concat(
      inputs.map(f =>
        f.kind === DATA_TAG ? encodeDataFrame(f.payload) : encodeCtrlFrame(f.ctrl),
      ),
    )
    const seen: DecodedFrame[] = []
    const feed = createFrameDecoder(
      f => seen.push(f),
      () => {},
    )
    feed(encoded)
    expect(seen.length).toBe(inputs.length)
    for (let i = 0; i < inputs.length; i++) {
      const a = inputs[i]!
      const b = seen[i]!
      expect(b.kind).toBe(a.kind)
      if (a.kind === DATA_TAG && b.kind === DATA_TAG) {
        expect(b.payload.equals(a.payload)).toBe(true)
      } else if (a.kind === CTRL_TAG && b.kind === CTRL_TAG) {
        expect(b.ctrl).toEqual(a.ctrl)
      }
    }
  })
})
