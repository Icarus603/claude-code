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
 * Process-control markers ccb sets on its own child for internal
 * coordination (bg session kind, resume hints, etc.). These should NOT
 * leak into nested subprocesses spawned by BashTool — if a hook script
 * happens to invoke `ccb` recursively, the inner ccb must not be
 * mis-tagged as a bg session or pick up a stale resume marker.
 *
 * Mirrors ant 2482.js iy() — always scrubbed regardless of
 * CLAUDE_CODE_SUBPROCESS_ENV_SCRUB. Cheap (~5 deletes per spawn).
 */
const ALWAYS_SCRUB = [
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_BG_SOURCE',
  'CLAUDE_BG_ISOLATION',
  'CLAUDE_BG_BACKEND',
  'CLAUDE_CODE_SESSION_NAME',
  'CLAUDE_CODE_BG_JOB_SHORT',
  'CLAUDE_CODE_RESUME_INTERRUPTED_TURN',
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
  // return baseEnv unchanged for the hot path.
  const needsAlwaysScrub = ALWAYS_SCRUB.some(k => k in baseEnv)
  const needsProxy = Object.keys(proxyEnv).length > 0
  const needsGhaScrub = isEnvTruthy(scrubFlag)

  if (!needsAlwaysScrub && !needsProxy && !needsGhaScrub) {
    return baseEnv as NodeJS.ProcessEnv
  }

  const merged: NodeJS.ProcessEnv = { ...baseEnv, ...proxyEnv }
  for (const k of ALWAYS_SCRUB) {
    delete merged[k]
  }
  if (needsGhaScrub) {
    for (const k of GHA_SUBPROCESS_SCRUB) {
      delete merged[k]
      delete merged[`INPUT_${k}`]
    }
  }
  return merged
}
