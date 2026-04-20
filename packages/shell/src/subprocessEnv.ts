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

// Registered by init.ts after the upstreamproxy module is dynamically imported
// in CCR sessions.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

export function subprocessEnv(): NodeJS.ProcessEnv {
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}

  if (!isEnvTruthy(readEnv('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'))) {
    return Object.keys(proxyEnv).length > 0
      ? { ...getAllEnv(), ...proxyEnv }
      : (getAllEnv() as NodeJS.ProcessEnv)
  }
  const env = { ...getAllEnv(), ...proxyEnv }
  for (const k of GHA_SUBPROCESS_SCRUB) {
    delete env[k]
    delete env[`INPUT_${k}`]
  }
  return env as NodeJS.ProcessEnv
}
