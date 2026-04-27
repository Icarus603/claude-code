import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk'
import { getAnthropicAuthProvider } from '../auth.js'
import { getProviderHostBindings } from '../host.js'
import { getProviderNetworkLayer } from '../network.js'
import { randomUUID } from 'crypto'
import type { GoogleAuth } from 'google-auth-library'
import { readEnv } from '@claude-code/config/env'

/**
 * Environment variables for different client types:
 *
 * Direct API:
 * - ANTHROPIC_API_KEY: Required for direct API access
 *
 * AWS Bedrock:
 * - AWS credentials configured via aws-sdk defaults
 * - AWS_REGION or AWS_DEFAULT_REGION: Sets the AWS region for all models (default: us-east-1)
 * - ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: Optional. Override AWS region specifically for the small fast model (Haiku)
 *
 * Foundry (Azure):
 * - ANTHROPIC_FOUNDRY_RESOURCE: Your Azure resource name (e.g., 'my-resource')
 *   For the full endpoint: https://{resource}.services.ai.azure.com/anthropic/v1/messages
 * - ANTHROPIC_FOUNDRY_BASE_URL: Optional. Alternative to resource - provide full base URL directly
 *   (e.g., 'https://my-resource.services.ai.azure.com')
 *
 * Authentication (one of the following):
 * - ANTHROPIC_FOUNDRY_API_KEY: Your Microsoft Foundry API key (if using API key auth)
 * - Azure AD authentication: If no API key is provided, uses DefaultAzureCredential
 *   which supports multiple auth methods (environment variables, managed identity,
 *   Azure CLI, etc.). See: https://docs.microsoft.com/en-us/javascript/api/@azure/identity
 *
 * Vertex AI:
 * - Model-specific region variables (highest priority):
 *   - VERTEX_REGION_CLAUDE_3_5_HAIKU: Region for Claude 3.5 Haiku model
 *   - VERTEX_REGION_CLAUDE_HAIKU_4_5: Region for Claude Haiku 4.5 model
 *   - VERTEX_REGION_CLAUDE_3_5_SONNET: Region for Claude 3.5 Sonnet model
 *   - VERTEX_REGION_CLAUDE_3_7_SONNET: Region for Claude 3.7 Sonnet model
 * - CLOUD_ML_REGION: Optional. The default GCP region to use for all models
 *   If specific model region not specified above
 * - ANTHROPIC_VERTEX_PROJECT_ID: Required. Your GCP project ID
 * - Standard GCP credentials configured via google-auth-library
 *
 * Priority for determining region:
 * 1. Hardcoded model-specific environment variables
 * 2. Global CLOUD_ML_REGION variable
 * 3. Default region from config
 * 4. Fallback region (us-east5)
 */

function createStderrLogger(): ClientOptions['logger'] {
  return {
    error: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[Anthropic SDK ERROR]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    warn: (msg, ...args) => console.error('[Anthropic SDK WARN]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    info: (msg, ...args) => console.error('[Anthropic SDK INFO]', msg, ...args),
    debug: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[Anthropic SDK DEBUG]', msg, ...args),
  }
}

export async function getAnthropicClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
  signal,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
  signal?: AbortSignal
}): Promise<Anthropic> {
  const authProvider = getAnthropicAuthProvider()
  const networkLayer = getProviderNetworkLayer()
  const { anthropic } = getProviderHostBindings()
  const containerId = readEnv('CLAUDE_CODE_CONTAINER_ID')
  const remoteSessionId = readEnv('CLAUDE_CODE_REMOTE_SESSION_ID')
  const clientApp = readEnv('CLAUDE_AGENT_SDK_CLIENT_APP')
  const customHeaders = getCustomHeaders()
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': anthropic.getUserAgent(),
    'X-Claude-Code-Session-Id': anthropic.getSessionId(),
    ...customHeaders,
    ...(containerId ? { 'x-claude-remote-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-claude-remote-session-id': remoteSessionId }
      : {}),
    // SDK consumers can identify their app/library for backend analytics
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
  }

  // Log API client configuration for HFI debugging
  anthropic.logForDebugging(
    `[API:request] Creating client, ANTHROPIC_CUSTOM_HEADERS present: ${!!readEnv('ANTHROPIC_CUSTOM_HEADERS')}, has Authorization header: ${!!customHeaders['Authorization']}`,
  )

  // Add additional protection header if enabled via env var
  const additionalProtectionEnabled = anthropic.isEnvTruthy(
    readEnv('CLAUDE_CODE_ADDITIONAL_PROTECTION'),
  )
  if (additionalProtectionEnabled) {
    defaultHeaders['x-anthropic-additional-protection'] = 'true'
  }

  anthropic.logForDebugging('[API:auth] OAuth token check starting')
  await authProvider.refresh()
  anthropic.logForDebugging('[API:auth] OAuth token check complete')

  const authCredentials = await authProvider.getCredentials({
    apiKeyOverride: apiKey,
    isNonInteractiveSession: anthropic.getIsNonInteractiveSession(),
  })

  if (!authCredentials.subscriber && authCredentials.authorizationHeader) {
    defaultHeaders['Authorization'] = authCredentials.authorizationHeader
  }

  const resolvedFetch = buildFetch(fetchOverride, source)

  const ARGS = {
    defaultHeaders,
    maxRetries,
    timeout: parseInt(readEnv('API_TIMEOUT_MS') || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    fetchOptions: networkLayer.getProxyFetchOptions({
      forAnthropicAPI: true,
    }) as ClientOptions['fetchOptions'],
    ...(resolvedFetch && {
      fetch: resolvedFetch,
    }),
  }
  if (anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_USE_BEDROCK'))) {
    const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
    // Use region override for small fast model if specified
    const awsRegion =
      model === anthropic.getSmallFastModel() &&
      readEnv('ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION')
        ? readEnv('ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION')
        : anthropic.getAWSRegion()

    const bedrockArgs: Record<string, unknown> = {
      ...ARGS,
      awsRegion,
      ...(anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_SKIP_BEDROCK_AUTH')) && {
        skipAuth: true,
      }),
      ...(anthropic.isDebugToStdErr() && { logger: createStderrLogger() }),
    }

    // Add API key authentication if available
    if (readEnv('AWS_BEARER_TOKEN_BEDROCK')) {
      bedrockArgs.skipAuth = true
      // Add the Bearer token for Bedrock API key authentication
      bedrockArgs.defaultHeaders = {
        ...(bedrockArgs.defaultHeaders as Record<string, string> | undefined),
        Authorization: `Bearer ${readEnv('AWS_BEARER_TOKEN_BEDROCK')}`,
      }
    } else if (
      !anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_SKIP_BEDROCK_AUTH'))
    ) {
      // Refresh auth and get credentials with cache clearing
      const cachedCredentials = await anthropic.refreshAndGetAwsCredentials()
      if (cachedCredentials) {
        bedrockArgs.awsAccessKey = cachedCredentials.accessKeyId
        bedrockArgs.awsSecretKey = cachedCredentials.secretAccessKey
        bedrockArgs.awsSessionToken = cachedCredentials.sessionToken
      }
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicBedrock(bedrockArgs) as unknown as Anthropic
  }
  if (anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_USE_FOUNDRY'))) {
    const { AnthropicFoundry } = await import('@anthropic-ai/foundry-sdk')
    // Determine Azure AD token provider based on configuration
    // SDK reads ANTHROPIC_FOUNDRY_API_KEY by default
    let azureADTokenProvider: (() => Promise<string>) | undefined
    if (!readEnv('ANTHROPIC_FOUNDRY_API_KEY')) {
      if (anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_SKIP_FOUNDRY_AUTH'))) {
        // Mock token provider for testing/proxy scenarios (similar to Vertex mock GoogleAuth)
        azureADTokenProvider = () => Promise.resolve('')
      } else {
        // Use real Azure AD authentication with DefaultAzureCredential
        const {
          DefaultAzureCredential: AzureCredential,
          getBearerTokenProvider,
        } = await import('@azure/identity')
        azureADTokenProvider = getBearerTokenProvider(
          new AzureCredential(),
          'https://cognitiveservices.azure.com/.default',
        )
      }
    }

    const foundryArgs: ConstructorParameters<typeof AnthropicFoundry>[0] = {
      ...ARGS,
      ...(azureADTokenProvider && { azureADTokenProvider }),
      ...(anthropic.isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicFoundry(foundryArgs) as unknown as Anthropic
  }
  if (anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_USE_VERTEX'))) {
    // Refresh GCP credentials if gcpAuthRefresh is configured and credentials are expired
    // This is similar to how we handle AWS credential refresh for Bedrock
    if (!anthropic.isEnvTruthy(readEnv('CLAUDE_CODE_SKIP_VERTEX_AUTH'))) {
      await anthropic.refreshGcpCredentialsIfNeeded()
    }

    const [{ AnthropicVertex }, { GoogleAuth }] = await Promise.all([
      import('@anthropic-ai/vertex-sdk'),
      import('google-auth-library'),
    ])
    // TODO: Cache either GoogleAuth instance or AuthClient to improve performance
    // Currently we create a new GoogleAuth instance for every getAnthropicClient() call
    // This could cause repeated authentication flows and metadata server checks
    // However, caching needs careful handling of:
    // - Credential refresh/expiration
    // - Environment variable changes (GOOGLE_APPLICATION_CREDENTIALS, project vars)
    // - Cross-request auth state management
    // See: https://github.com/googleapis/google-auth-library-nodejs/issues/390 for caching challenges

    // Prevent metadata server timeout by providing projectId as fallback
    // google-auth-library checks project ID in this order:
    // 1. Environment variables (GCLOUD_PROJECT, GOOGLE_CLOUD_PROJECT, etc.)
    // 2. Credential files (service account JSON, ADC file)
    // 3. gcloud config
    // 4. GCE metadata server (causes 12s timeout outside GCP)
    //
    // We only set projectId if user hasn't configured other discovery methods
    // to avoid interfering with their existing auth setup

    // Check project environment variables in same order as google-auth-library
    // See: https://github.com/googleapis/google-auth-library-nodejs/blob/main/src/auth/googleauth.ts
    const hasProjectEnvVar =
      readEnv('GCLOUD_PROJECT') ||
      readEnv('GOOGLE_CLOUD_PROJECT') ||
      readEnv('gcloud_project') ||
      readEnv('google_cloud_project')

    // Check for credential file paths (service account or ADC)
    // Note: We're checking both standard and lowercase variants to be safe,
    // though we should verify what google-auth-library actually checks
    const hasKeyFile =
      readEnv('GOOGLE_APPLICATION_CREDENTIALS') ||
      readEnv('google_application_credentials')

    const googleAuth = anthropic.isEnvTruthy(
      readEnv('CLAUDE_CODE_SKIP_VERTEX_AUTH'),
    )
      ? ({
          // Mock GoogleAuth for testing/proxy scenarios
          getClient: () => ({
            getRequestHeaders: () => ({}),
          }),
        } as unknown as GoogleAuth)
      : new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
          // Only use ANTHROPIC_VERTEX_PROJECT_ID as last resort fallback
          // This prevents the 12-second metadata server timeout when:
          // - No project env vars are set AND
          // - No credential keyfile is specified AND
          // - ADC file exists but lacks project_id field
          //
          // Risk: If auth project != API target project, this could cause billing/audit issues
          // Mitigation: Users can set GOOGLE_CLOUD_PROJECT to override
          ...(hasProjectEnvVar || hasKeyFile
            ? {}
            : {
                projectId: readEnv('ANTHROPIC_VERTEX_PROJECT_ID'),
              }),
        })

    const vertexArgs: ConstructorParameters<typeof AnthropicVertex>[0] = {
      ...ARGS,
      region: anthropic.getVertexRegionForModel(model),
      googleAuth: googleAuth as any,
      ...(anthropic.isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    // we have always been lying about the return type - this doesn't support batching or models
    return new AnthropicVertex(vertexArgs) as unknown as Anthropic
  }

  // V7 §11.6 — when an Anthropic Compatible connection matches the
  // requested model, override apiKey + baseURL with the connection's
  // values. This keeps Claude Account OAuth (api.anthropic.com + OAuth
  // token) and Anthropic Compatible (user-supplied URL + api_key) from
  // colliding through global ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN.
  // Resolution is per-call: each query consults the connection registry
  // for the active model; no shared global state.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveConnectionForModel } = require(
    '../providers.js',
  ) as typeof import('../providers.js')
  const conn = model ? resolveConnectionForModel(model) : undefined

  // V7 §11.6 — Codex routing seam.
  //
  // When the active connection is Codex (ChatGPT-account auth against
  // chatgpt.com/backend-api/codex/responses), we install a custom
  // `fetch` on the Anthropic SDK client that intercepts `/v1/messages`
  // calls, translates the Anthropic-shape body to Codex's `/responses`
  // shape, and translates the SSE stream back to Anthropic events.
  //
  // This is the SAME architectural pattern openai/codex's TUI uses for
  // its provider impedance match, and it solves the problems our prior
  // queryStream-level codex branch hit:
  //   • The SDK already normalized everything (system, tools,
  //     output_config.effort, BetaMessageParam[]) — fetch sees the
  //     final wire body, not the upstream `Message[]` wrapper.
  //   • Errors come back as Response objects → SDK converts to
  //     `APIError` automatically; no need to wrap thrown Errors as
  //     `SystemAPIErrorMessage`.
  //   • All Anthropic-side preprocessing (cache_control hints, beta
  //     headers, etc.) flows through unchanged; codex backend ignores
  //     what doesn't apply.
  if (conn?.protocol === 'codex' && conn.auth.type === 'oauth') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCodexFetch } = require(
      '../codex/fetchAdapter.js',
    ) as typeof import('../codex/fetchAdapter.js')
    const codexClientConfig: ConstructorParameters<typeof Anthropic>[0] = {
      // The SDK requires `apiKey` to be a non-empty string — our fetch
      // adapter handles real auth via the codex Bearer token, so this
      // value is never sent on the wire.
      apiKey: 'codex-via-fetch-adapter',
      ...ARGS,
      fetch: createCodexFetch(),
      ...(anthropic.isDebugToStdErr() && { logger: createStderrLogger() }),
    }
    return new Anthropic(codexClientConfig)
  }

  const useCompatibleConn =
    conn?.protocol === 'anthropic' && conn.auth.type === 'api_key'

  // Determine authentication method based on available tokens
  const clientConfig: ConstructorParameters<typeof Anthropic>[0] = {
    apiKey: useCompatibleConn
      ? conn?.auth.type === 'api_key'
        ? conn.auth.key
        : null
      : authCredentials.apiKey,
    authToken: useCompatibleConn ? undefined : authCredentials.authToken ?? undefined,
    ...(useCompatibleConn
      ? conn?.endpoint
        ? { baseURL: conn.endpoint }
        : {}
      : authCredentials.baseURL
        ? { baseURL: authCredentials.baseURL }
        : {}),
    ...ARGS,
    ...(anthropic.isDebugToStdErr() && { logger: createStderrLogger() }),
  }

  // For compatible-api connections, also set the Authorization header
  // explicitly — the SDK's apiKey behavior assumes Anthropic Console;
  // proxies that follow the Anthropic protocol expect the same shape.
  if (useCompatibleConn && conn?.auth.type === 'api_key' && conn.auth.key) {
    // Override the OAuth Authorization header from earlier; api_key path
    // uses x-api-key (set by the SDK from `apiKey:` above). Drop any
    // OAuth Bearer header so the proxy doesn't see two auth methods.
    delete clientConfig.defaultHeaders?.['Authorization']
  }

  return new Anthropic(clientConfig)
}

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = readEnv('ANTHROPIC_CUSTOM_HEADERS')

  if (!customHeadersEnv) return customHeaders

  // Split by newlines to support multiple headers
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    // Parse header in format "Name: Value" (curl style). Split on first `:`
    // then trim — avoids regex backtracking on malformed long header lines.
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

function buildFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  const { anthropic } = getProviderHostBindings()
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const inner = fetchOverride ?? globalThis.fetch
  // Only send to the first-party API — Bedrock/Vertex/Foundry don't log it
  // and unknown headers risk rejection by strict proxies (inc-4029 class).
  const injectClientRequestId =
    getProviderHostBindings().getAPIProvider() === 'firstParty' &&
    anthropic.isFirstPartyAnthropicBaseUrl()
  return (input, init) => {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const headers = new Headers(init?.headers)
    // Generate a client-side request ID so timeouts (which return no server
    // request ID) can still be correlated with server logs by the API team.
    // Callers that want to track the ID themselves can pre-set the header.
    if (injectClientRequestId && !headers.has(CLIENT_REQUEST_ID_HEADER)) {
      headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID())
    }
    try {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const url = input instanceof Request ? input.url : String(input)
      const id = headers.get(CLIENT_REQUEST_ID_HEADER)
      anthropic.logForDebugging(
        `[API REQUEST] ${new URL(url).pathname}${id ? ` ${CLIENT_REQUEST_ID_HEADER}=${id}` : ''} source=${source ?? 'unknown'}`,
      )
    } catch {
      // never let logging crash the fetch
    }
    return inner(input, { ...init, headers })
  }
}
