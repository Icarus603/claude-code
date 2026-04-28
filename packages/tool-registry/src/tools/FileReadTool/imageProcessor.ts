import type { Buffer } from 'buffer'
import { isInBundledMode } from '@claude-code/config/bundledMode'

export type SharpInstance = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

export type SharpFunction = (input: Buffer) => SharpInstance

type SharpCreatorOptions = {
  create: {
    width: number
    height: number
    channels: 3 | 4
    background: { r: number; g: number; b: number }
  }
}

type SharpCreator = (options: SharpCreatorOptions) => SharpInstance

let imageProcessorModule: { default: SharpFunction } | null = null
let imageCreatorModule: { default: SharpCreator } | null = null

export async function getImageProcessor(): Promise<SharpFunction> {
  if (imageProcessorModule) {
    return imageProcessorModule.default
  }

  // Always try the native image-processor first regardless of bundled mode.
  // npm `sharp` fails to load both in `bun dist/cli.js` (no platform binary
  // resolution) and in `bun build --compile` standalone bundles (binary not
  // embedded). The native .node from vendor/image-processor/ works in both
  // cases. See packages/image-processor-napi/src/index.ts for the resolver.
  // The `isInBundledMode()` import is kept for callers that may still want
  // it elsewhere, but the gate is removed here.
  void isInBundledMode  // referenced to retain import; gate is intentionally not used
  try {
    const imageProcessor = await import('image-processor-napi')
    const sharpFn = (imageProcessor.sharp ?? imageProcessor.default) as SharpFunction
    if (typeof sharpFn === 'function') {
      imageProcessorModule = { default: sharpFn }
      return sharpFn
    }
  } catch {
    // image-processor-napi failed (no native .node for this platform AND
    // npm sharp also failed). Fall through to direct sharp import.
    console.warn(
      'Native image processor not available, falling back to sharp',
    )
  }

  // Last-resort direct sharp import. Same caveat — sharp's platform binary
  // may not be available in all runtime configurations, in which case the
  // resizer's catch block falls through to the original buffer pass-through.
  // Single structural cast: our SharpFunction is a subset of sharp's actual type surface.
  const imported = (await import(
    'sharp'
  )) as unknown as MaybeDefault<SharpFunction>
  const sharp = unwrapDefault(imported)
  imageProcessorModule = { default: sharp }
  return sharp
}

/**
 * Get image creator for generating new images from scratch.
 * Note: image-processor-napi doesn't support image creation,
 * so this always uses sharp directly.
 */
export async function getImageCreator(): Promise<SharpCreator> {
  if (imageCreatorModule) {
    return imageCreatorModule.default
  }

  const imported = (await import(
    'sharp'
  )) as unknown as MaybeDefault<SharpCreator>
  const sharp = unwrapDefault(imported)
  imageCreatorModule = { default: sharp }
  return sharp
}

// Dynamic import shape varies by module interop mode — ESM yields { default: fn }, CJS yields fn directly.
type MaybeDefault<T> = T | { default: T }

function unwrapDefault<T extends (...args: never[]) => unknown>(
  mod: MaybeDefault<T>,
): T {
  return typeof mod === 'function' ? mod : mod.default
}
