/**
 * image-processor-napi — sharp-shaped wrapper over the native
 * `image-processor.node` (provenance: vendor/image-processor/NOTICE.md).
 *
 * The native module exposes `processImage(buffer)` returning an
 * `ImageProcessor` instance with imperative methods (`metadata()`,
 * `resize(w,h,opts)`, `png(opts)`, `jpeg(q)`, `webp(q)`, `toBuffer()`,
 * `dispose()`) — NOT a sharp-style chainable Pipeline. Callers in this
 * codebase are sharp-shaped (`sharp(buf).resize(w,h).png().toBuffer()`),
 * so this file presents a chainable façade that buffers operations and
 * applies them in `toBuffer()` / `metadata()`.
 *
 * The shape of the façade is the minimal subset ccb actually uses
 * (see `SharpFunction`/`SharpInstance` in
 * tool-registry/.../imageProcessor.ts).
 *
 * Resolution order at first sharp() call (cached after first hit):
 *   1. `vendor/image-processor/<platform>-<arch>/image-processor.node`
 *      relative to process.execPath (standalone binary case)
 *   2. Same path relative to the source tree (dev mode)
 *   3. Same path relative to process.cwd()
 *
 * Falls back to a stub that throws when nothing loads — the resizer's
 * catch block then takes the original-buffer pass-through path when
 * the image is within size limits.
 */


interface NativeImageProcessor {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    opts?: { fit?: string; withoutEnlargement?: boolean },
  ): void
  jpeg(quality?: number): void
  png(opts?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): void
  webp(quality?: number): void
  toBuffer(): Promise<Buffer>
  dispose?(): void
}

interface NativeBinding {
  processImage(buffer: Buffer | Uint8Array): Promise<NativeImageProcessor>
  hasClipboardImage(): boolean
  readClipboardImage(
    maxWidth?: number,
    maxHeight?: number,
  ): Promise<{
    png: Buffer
    width: number
    height: number
    originalWidth: number
    originalHeight: number
  } | null>
}

let cachedNative: NativeBinding | null | undefined

function validate(mod: unknown): NativeBinding | null {
  // Module-shape validation. Centralised because each branch below uses
  // the same checks but the require() literal must be inlined per branch
  // for Bun's bundler to detect and embed.
  if (
    mod &&
    typeof mod === 'object' &&
    typeof (mod as NativeBinding).processImage === 'function' &&
    typeof (mod as NativeBinding).hasClipboardImage === 'function'
  ) {
    return mod as NativeBinding
  }
  const inner = (mod as { default?: unknown })?.default
  if (
    inner &&
    typeof inner === 'object' &&
    typeof (inner as NativeBinding).processImage === 'function' &&
    typeof (inner as NativeBinding).hasClipboardImage === 'function'
  ) {
    return inner as NativeBinding
  }
  return null
}

function loadNative(): NativeBinding | null {
  if (cachedNative !== undefined) return cachedNative

  // CRITICAL: each per-platform `require(<plain-string-literal>)` MUST be
  // a literal expression, NOT a variable, NOT a template literal, NOT
  // forwarded through a helper function. Bun's bundler analyses static
  // require() calls and embeds the corresponding files in /$bunfs/root/
  // of the standalone binary. Anything that isn't a literal is opaque
  // to the analyser and the .node won't get embedded.
  //
  // At runtime, `require('./vendor/...')` of the same literal path
  // resolves to the embedded blob inside the standalone binary. In dev
  // mode (running cli.js via `bun dist/cli.js`), the same require
  // resolves against the on-disk vendor/ directory next to dist/cli.js.
  // Both paths lead to the same require call site — no variant logic.

  let mod: unknown
  try {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-darwin/image-processor.node')
    } else if (process.platform === 'darwin' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-darwin/image-processor.node')
    } else if (process.platform === 'linux' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-linux/image-processor.node')
    } else if (process.platform === 'linux' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-linux/image-processor.node')
    } else if (process.platform === 'win32' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-win32/image-processor.node')
    }
  } catch {
    // platform-specific module not found / not loadable
  }

  let result = validate(mod)
  if (result) {
    cachedNative = result
    return cachedNative
  }

  // Dev-mode fallbacks: cwd-relative paths if the previous require failed
  // (e.g. running from a non-dist cwd in dev mode).
  const platformDir = `${process.arch}-${process.platform}`
  const cwdPath = `${process.cwd()}/vendor/image-processor/${platformDir}/image-processor.node`
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cwdMod = require(cwdPath)
    result = validate(cwdMod)
    if (result) {
      cachedNative = result
      return cachedNative
    }
  } catch {
    // not present at cwd either
  }

  cachedNative = null
  return null
}

// Sharp-shaped façade over the native processImage(buffer) → ImageProcessor
// pipeline. Operations are queued; `metadata()` / `toBuffer()` materialize
// the native instance and replay the queue.
type SharpInstance = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    opts?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(opts?: { quality?: number }): SharpInstance
  png(opts?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(opts?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

type SharpFunction = (input: Buffer | Uint8Array) => SharpInstance

function makeSharp(): SharpFunction {
  return function sharp(input) {
    const ops: Array<(p: NativeImageProcessor) => void> = []

    async function materialize(applyOps: boolean): Promise<NativeImageProcessor> {
      const native = loadNative()
      if (!native) {
        throw new Error('Native image processor module not available')
      }
      const inst = await native.processImage(input)
      if (applyOps) {
        for (const op of ops) op(inst)
      }
      return inst
    }

    const instance: SharpInstance = {
      async metadata() {
        const inst = await materialize(false)
        try {
          return await inst.metadata()
        } finally {
          inst.dispose?.()
        }
      },
      resize(width, height, opts) {
        ops.push(p => p.resize(width, height, opts))
        return instance
      },
      jpeg(opts) {
        ops.push(p => p.jpeg(opts?.quality))
        return instance
      },
      png(opts) {
        ops.push(p => p.png(opts))
        return instance
      },
      webp(opts) {
        ops.push(p => p.webp(opts?.quality))
        return instance
      },
      async toBuffer() {
        const inst = await materialize(true)
        try {
          return await inst.toBuffer()
        } finally {
          inst.dispose?.()
        }
      },
    }
    return instance
  }
}

export const sharp: SharpFunction = makeSharp()

interface ClipboardModule {
  hasClipboardImage(): boolean
  readClipboardImage(
    maxWidth?: number,
    maxHeight?: number,
  ): Promise<{
    png: Buffer
    width: number
    height: number
    originalWidth: number
    originalHeight: number
  } | null>
}

function createDarwinNativeModule(): ClipboardModule {
  // Prefer the native binding's clipboard methods when available; fall
  // back to spawning osascript otherwise. The native methods are
  // ~50× faster for the common case (warm clipboard), but the osascript
  // path keeps things working when the .node fails to load.
  const native = loadNative()
  if (native) {
    return {
      hasClipboardImage() {
        try {
          return native.hasClipboardImage()
        } catch {
          return false
        }
      },
      async readClipboardImage(maxWidth, maxHeight) {
        try {
          return await native.readClipboardImage(maxWidth, maxHeight)
        } catch {
          return null
        }
      },
    }
  }

  return {
    hasClipboardImage(): boolean {
      try {
        const result = Bun.spawnSync({
          cmd: [
            'osascript',
            '-e',
            'try\nthe clipboard as «class PNGf»\nreturn "yes"\non error\nreturn "no"\nend try',
          ],
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const output = result.stdout.toString().trim()
        return output === 'yes'
      } catch {
        return false
      }
    },

    async readClipboardImage(
      maxWidth?: number,
      maxHeight?: number,
    ) {
      try {
        // Use async Bun.spawn (not spawnSync) so the event loop stays alive
        // while osascript writes the clipboard PNG to disk. spawnSync blocks
        // the main thread and freezes the Ink/React UI ("Pasting text…" stall).
        const tmpPath = `/tmp/claude_clipboard_native_${Date.now()}.png`
        const script = `
set png_data to (the clipboard as «class PNGf»)
set fp to open for access POSIX file "${tmpPath}" with write permission
write png_data to fp
close access fp
return "${tmpPath}"
`
        const proc = Bun.spawn(['osascript', '-e', script], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        await proc.exited

        if (proc.exitCode !== 0) {
          return null
        }

        const fs = require('fs') as typeof import('fs')
        const buffer: Buffer = fs.readFileSync(tmpPath)

        try {
          fs.unlinkSync(tmpPath)
        } catch {
          // ignore cleanup errors
        }

        if (buffer.length === 0) {
          return null
        }

        // Read PNG dimensions from IHDR chunk (offset 16/20).
        let width = 0
        let height = 0
        if (buffer.length > 24 && buffer[12] === 0x49 && buffer[13] === 0x48 && buffer[14] === 0x44 && buffer[15] === 0x52) {
          width = buffer.readUInt32BE(16)
          height = buffer.readUInt32BE(20)
        }

        const originalWidth = width
        const originalHeight = height

        if (maxWidth && maxHeight) {
          if (width > maxWidth || height > maxHeight) {
            const scale = Math.min(maxWidth / width, maxHeight / height)
            width = Math.round(width * scale)
            height = Math.round(height * scale)
          }
        }

        return { png: buffer, width, height, originalWidth, originalHeight }
      } catch {
        return null
      }
    },
  }
}

export function getNativeModule(): ClipboardModule | null {
  if (process.platform === 'darwin') {
    return createDarwinNativeModule()
  }
  return null
}

export default sharp
