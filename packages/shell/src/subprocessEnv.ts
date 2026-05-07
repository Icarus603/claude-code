import { getAllEnv, isEnvTruthy, readEnv } from '@claude-code/config/env/utils'

/**
 * Env vars to strip from subprocess environments when running inside GitHub
 * Actions. Prevents prompt-injection attacks from exfiltrating secrets via
 * shell expansion in Bash tool commands.
 */
const GHA_SUBPROCESS_SCRUB = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * Env vars ant 2482.js iy() ALWAYS strips from subprocess env (regardless
 * of GHA scrub). Three categories:
 *
 * 1. Auth tokens — daemon injected these for the bg child only; they
 *    must not leak into bash subprocesses or hook scripts.
 * 2. Process-control markers — bg-session/resume tags; nested ccb
 *    invocations would otherwise be mis-tagged.
 * 3. Telemetry: all OTEL_* (handled separately by prefix match below).
 *
 * Mirrors ant 2482.js iy() lines 110-131. Cheap (~10 deletes per spawn).
 */
const ALWAYS_SCRUB = [
  // Auth — daemon-injected on macOS (4706.js xXK)
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_SUBSCRIPTION_TYPE',
  'CLAUDE_CODE_RATE_LIMIT_TIER',
  // Process-control markers
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_BG_SOURCE',
  'CLAUDE_BG_ISOLATION',
  'CLAUDE_BG_BACKEND',
  'CLAUDE_CODE_SESSION_NAME',
  'CLAUDE_CODE_BG_JOB_SHORT',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN',
  'CLAUDE_JOB_DIR',
] as const

// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

/**
 * Build subprocess env. Pass an explicit `env` to bypass real process.env
 * (used in tests — eliminates the need for mock.module on env utils, which
 * is process-wide in bun-test and pollutes other test files). Production
 * callers omit the param and the function reads from getAllEnv()/readEnv()
 * directly.
 */
export function subprocessEnv(
  env?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const baseEnv = env ?? getAllEnv()
  const scrubFlag = env ? env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB : readEnv('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB')
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}

  // ALWAYS_SCRUB applies regardless of the GHA flag — process-control
  // markers must not leak into nested subprocesses. Build a fresh
  // object only if there's actually something to strip; otherwise
  // return baseEnv unchanged for the hot path. OTEL_* matches by prefix
  // (ant 2482.js:120,132 — strip every key starting with "OTEL_").
  const needsAlwaysScrub = ALWAYS_SCRUB.some(k => k in baseEnv)
  const needsOtelScrub = Object.keys(baseEnv).some(k => k.startsWith('OTEL_'))
  const needsProxy = Object.keys(proxyEnv).length > 0
  const needsGhaScrub = isEnvTruthy(scrubFlag)

  if (!needsAlwaysScrub && !needsOtelScrub && !needsProxy && !needsGhaScrub) {
    return baseEnv as NodeJS.ProcessEnv
  }

  const merged: NodeJS.ProcessEnv = { ...baseEnv, ...proxyEnv }
  for (const k of ALWAYS_SCRUB) {
    delete merged[k]
  }
  // OTEL_* prefix scrub — ant 2482.js:132 iterates every key.
  for (const k of Object.keys(merged)) {
    if (k.startsWith('OTEL_')) delete merged[k]
  }
  if (needsGhaScrub) {
    for (const k of GHA_SUBPROCESS_SCRUB) {
      delete merged[k]
      delete merged[`INPUT_${k}`]
    }
  }
  return merged
}
