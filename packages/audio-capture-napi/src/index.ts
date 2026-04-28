
type AudioCaptureNapi = {
  startRecording(
    onData: (data: Buffer) => void,
    onEnd: () => void,
  ): boolean
  stopRecording(): void
  isRecording(): boolean
  startPlayback(sampleRate: number, channels: number): boolean
  writePlaybackData(data: Buffer): void
  stopPlayback(): void
  isPlaying(): boolean
  // TCC microphone authorization status (macOS only):
  // 0 = notDetermined, 1 = restricted, 2 = denied, 3 = authorized.
  // Linux: always returns 3 (authorized) — no system-level microphone permission API.
  // Windows: returns 3 (authorized) if registry key absent or allowed,
  //          2 (denied) if microphone access is explicitly denied.
  microphoneAuthorizationStatus?(): number
}

let cachedModule: AudioCaptureNapi | null = null
let loadAttempted = false

function loadModule(): AudioCaptureNapi | null {
  if (loadAttempted) {
    return cachedModule
  }
  loadAttempted = true

  // CRITICAL: each per-platform `require(<plain-string-literal>)` MUST be
  // a literal expression, NOT a variable, NOT a template literal, NOT
  // forwarded through a helper. Bun's bundler analyses static require()
  // calls and embeds the corresponding files in /$bunfs/root/ of the
  // standalone binary. See packages/image-processor-napi/src/index.ts
  // for the mirror pattern that documents this requirement.
  //
  // The .node files MUST live under packages/audio-capture-napi/vendor/
  // so `../vendor/...` from this file (packages/audio-capture-napi/src/)
  // resolves correctly during bundling.
  let mod: unknown
  try {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-darwin/audio-capture.node')
    } else if (process.platform === 'darwin' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-darwin/audio-capture.node')
    } else if (process.platform === 'linux' && process.arch === 'arm64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/arm64-linux/audio-capture.node')
    } else if (process.platform === 'linux' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-linux/audio-capture.node')
    } else if (process.platform === 'win32' && process.arch === 'x64') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../vendor/x64-win32/audio-capture.node')
    }
  } catch {
    // platform-specific module not loadable
  }

  if (mod && typeof (mod as AudioCaptureNapi).startRecording === 'function') {
    cachedModule = mod as AudioCaptureNapi
    return cachedModule
  }

  // Dev-mode fallback: cwd-relative path in case running outside dist.
  const platformDir = `${process.arch}-${process.platform}`
  const cwdPath = `${process.cwd()}/packages/audio-capture-napi/vendor/${platformDir}/audio-capture.node`
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cwdMod = require(cwdPath) as AudioCaptureNapi
    if (cwdMod && typeof cwdMod.startRecording === 'function') {
      cachedModule = cwdMod
      return cachedModule
    }
  } catch {
    // not found at cwd
  }

  return null
}

export function isNativeAudioAvailable(): boolean {
  return loadModule() !== null
}

export function startNativeRecording(
  onData: (data: Buffer) => void,
  onEnd: () => void,
): boolean {
  const mod = loadModule()
  if (!mod) {
    return false
  }
  return mod.startRecording(onData, onEnd)
}

export function stopNativeRecording(): void {
  const mod = loadModule()
  if (!mod) {
    return
  }
  mod.stopRecording()
}

export function isNativeRecordingActive(): boolean {
  const mod = loadModule()
  if (!mod) {
    return false
  }
  return mod.isRecording()
}

export function startNativePlayback(
  sampleRate: number,
  channels: number,
): boolean {
  const mod = loadModule()
  if (!mod) {
    return false
  }
  return mod.startPlayback(sampleRate, channels)
}

export function writeNativePlaybackData(data: Buffer): void {
  const mod = loadModule()
  if (!mod) {
    return
  }
  mod.writePlaybackData(data)
}

export function stopNativePlayback(): void {
  const mod = loadModule()
  if (!mod) {
    return
  }
  mod.stopPlayback()
}

export function isNativePlaying(): boolean {
  const mod = loadModule()
  if (!mod) {
    return false
  }
  return mod.isPlaying()
}

// Returns the microphone authorization status.
// On macOS, returns the TCC status: 0=notDetermined, 1=restricted, 2=denied, 3=authorized.
// On Linux, always returns 3 (authorized) — no system-level mic permission API.
// On Windows, returns 3 (authorized) if registry key absent or allowed, 2 (denied) if explicitly denied.
// Returns 0 (notDetermined) if the native module is unavailable.
export function microphoneAuthorizationStatus(): number {
  const mod = loadModule()
  if (!mod || !mod.microphoneAuthorizationStatus) {
    return 0
  }
  return mod.microphoneAuthorizationStatus()
}
