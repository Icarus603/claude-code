import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import { installOAuthTokens } from '@claude-code/cli/handlers/auth.js'
import { useTerminalSize } from '@anthropic/ink'
import { setClipboard, useTerminalNotification, Box, Link, Text, KeyboardShortcutHint } from '@anthropic/ink'
import { useKeybinding } from '@anthropic/ink/keybindings'
import { getSSLErrorHint } from '@claude-code/provider/errorUtils.js'
import { sendNotification } from '../notifier.js'
import { OAuthService, runCodexOAuthFlow, saveCodexOAuthTokens } from '@claude-code/provider/oauth/index.js'
import { getOauthAccountInfo, validateForceLoginOrg } from '@claude-code/provider/authAlias.js'
import { logError } from '@claude-code/local-observability/logging'
import { getSettings, updateSettingsForSource } from '@claude-code/config/settings'
import {
  getConnections,
  saveConnection,
  removeConnection,
  toggleConnection,
  getDefaultModelsForProtocol,
  generateConnectionId,
  upsertCompatibleConnection,
  disconnectConnection,
  type ConnectionRecord,
  type ConnectionModelRecord,
} from '@claude-code/provider/connections.js'
import { Select } from './CustomSelect/select.js'
import { Spinner } from './Spinner.js'
import TextInput from './TextInput.js'
import { fi } from 'zod/v4/locales'

type Props = {
  onDone(): void
  startingMessage?: string
  mode?: 'login' | 'setup-token'
  forceLoginMethod?: 'claudeai' | 'console'
}

type OAuthStatus =
  | { state: 'idle' } // Initial state, waiting to select login method
  | { state: 'select_connection' } // Connection manager list view
  | { state: 'connection_action'; id: string } // Per-connection actions (toggle / disconnect)
  | { state: 'platform_setup' } // Show platform setup info (Bedrock/Vertex/Foundry)
  | {
      state: 'custom_platform'
      baseUrl: string
      apiKey: string
      haikuModel: string
      sonnetModel: string
      opusModel: string
      activeField: 'base_url' | 'api_key' | 'haiku_model' | 'sonnet_model' | 'opus_model'
    } // Custom platform: configure API endpoint and model names
  | {
      state: 'openai_chat_api'
      baseUrl: string
      apiKey: string
      haikuModel: string
      sonnetModel: string
      opusModel: string
      activeField: 'base_url' | 'api_key' | 'haiku_model' | 'sonnet_model' | 'opus_model'
    } // OpenAI Chat Completions API platform
  | {
      state: 'gemini_api'
      baseUrl: string
      apiKey: string
      haikuModel: string
      sonnetModel: string
      opusModel: string
      activeField: 'base_url' | 'api_key' | 'haiku_model' | 'sonnet_model' | 'opus_model'
    } // Gemini Generate Content API platform
  | { state: 'ready_to_start' } // Flow started, waiting for browser to open
  | { state: 'waiting_for_login'; url: string } // Browser opened, waiting for user to login
  | { state: 'creating_api_key' } // Got access token, creating API key
  | { state: 'about_to_retry'; nextState: OAuthStatus }
  | { state: 'success'; token?: string }
  | {
      state: 'error'
      message: string
      toRetry?: OAuthStatus
    }

const PASTE_HERE_MSG = 'Paste code here if prompted > '
export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp,
}: Props): React.ReactNode {
  const settings = getSettings() || {}
  const forceLoginMethod = forceLoginMethodProp ?? settings.forceLoginMethod
  const orgUUID = settings.forceLoginOrgUUID
  const forcedMethodMessage =
    forceLoginMethod === 'claudeai'
      ? 'Login method pre-selected: Subscription Plan (Claude Pro/Max)'
      : forceLoginMethod === 'console'
        ? 'Login method pre-selected: API Usage Billing (Anthropic Console)'
        : null

  const terminal = useTerminalNotification()

  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>(() => {
    if (mode === 'setup-token') {
      return { state: 'ready_to_start' }
    }
    if (forceLoginMethod === 'claudeai' || forceLoginMethod === 'console') {
      return { state: 'ready_to_start' }
    }
    // Show connection manager if connections exist
    if (getConnections().length > 0) {
      return { state: 'select_connection' }
    }
    return { state: 'idle' }
  })

  const [pastedCode, setPastedCode] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [oauthService] = useState(() => new OAuthService())
  const [loginWithClaudeAi, setLoginWithClaudeAi] = useState(() => {
    // Use Claude AI auth for setup-token mode to support user:inference scope
    return mode === 'setup-token' || forceLoginMethod === 'claudeai'
  })
  const [loginWithCodex, setLoginWithCodex] = useState(false)
  // Track which protocol the user is creating a connection for (API key forms)
  const [connectionProtocol, setConnectionProtocol] = useState<
    'anthropic' | 'openai' | 'codex' | 'gemini' | null
  >(null)
  // Name for new API key connections
  const [connectionName, setConnectionName] = useState('')

  // Helper: save a connection record. `models` overrides the hardcoded
  // default — used by the Codex flow to persist the live `/models` list
  // returned by the backend (the hardcoded list is wrong for the
  // ChatGPT-account tier).
  const upsertProtocolConnection = useCallback(
    (
      protocol: 'anthropic' | 'codex',
      name: string,
      endpoint: string,
      models?: ConnectionModelRecord[],
    ) => {
      const existing = getConnections().find(
        c => c.protocol === protocol && c.auth.type === 'oauth',
      )
      const conn: ConnectionRecord = {
        id: existing?.id ?? generateConnectionId(),
        name,
        protocol,
        endpoint,
        auth: { type: 'oauth', source: protocol === 'codex' ? 'codex' : 'claude-ai' },
        enabled: true,
        models:
          models && models.length > 0
            ? models
            : getDefaultModelsForProtocol(protocol),
        createdAt: existing?.createdAt ?? Date.now(),
      }
      saveConnection(conn)
    },
    [],
  )
  // After a few seconds we suggest the user to copy/paste url if the
  // browser did not open automatically. In this flow we expect the user to
  // copy the code from the browser and paste it in the terminal
  const [showPastePrompt, setShowPastePrompt] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [pastePromptExitHint, setPastePromptExitHint] = useState(false)
  const pastePromptExitTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const codexManualInputResolverRef = useRef<((value: string) => void) | null>(
    null,
  )

  const textInputColumns = useTerminalSize().columns - PASTE_HERE_MSG.length - 1

  // Log forced login method on mount
  useEffect(() => {
    if (forceLoginMethod === 'claudeai') {
      logEvent('tengu_oauth_claudeai_forced', {})
    } else if (forceLoginMethod === 'console') {
      logEvent('tengu_oauth_console_forced', {})
    }
  }, [forceLoginMethod])

  // Retry logic
  useEffect(() => {
    if (oauthStatus.state === 'about_to_retry') {
      const timer = setTimeout(setOAuthStatus, 1000, oauthStatus.nextState)
      return () => clearTimeout(timer)
    }
  }, [oauthStatus])

  // Handle Enter to continue on success state
  useKeybinding(
    'confirm:yes',
    () => {
      logEvent('tengu_oauth_success', { loginWithClaudeAi })
      onDone()
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'success' && mode !== 'setup-token',
    },
  )

  // Handle Enter to continue from platform setup
  useKeybinding(
    'confirm:yes',
    () => {
      setOAuthStatus({ state: 'idle' })
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'platform_setup',
    },
  )

  // Handle Enter to retry on error state
  useKeybinding(
    'confirm:yes',
    () => {
      if (oauthStatus.state === 'error' && oauthStatus.toRetry) {
        setPastedCode('')
        setOAuthStatus({
          state: 'about_to_retry',
          nextState: oauthStatus.toRetry,
        })
      }
    },
    {
      context: 'Confirmation',
      isActive: oauthStatus.state === 'error' && !!oauthStatus.toRetry,
    },
  )

  useEffect(() => {
    if (
      pastedCode === 'c' &&
      oauthStatus.state === 'waiting_for_login' &&
      showPastePrompt &&
      !urlCopied
    ) {
      void setClipboard(oauthStatus.url).then(raw => {
        if (raw) process.stdout.write(raw)
        setUrlCopied(true)
        setTimeout(setUrlCopied, 2000, false)
      })
      setPastedCode('')
    }
  }, [pastedCode, oauthStatus, showPastePrompt, urlCopied])

  async function handleSubmitCode(value: string, url: string) {
    try {
      if (codexManualInputResolverRef.current) {
        logEvent('tengu_oauth_codex_manual_entry', {})
        codexManualInputResolverRef.current(value)
        codexManualInputResolverRef.current = null
        setPastedCode('')
        return
      }

      // Expecting format "authorizationCode#state" from the authorization callback URL
      const [authorizationCode, state] = value.split('#')

      if (!authorizationCode || !state) {
        setOAuthStatus({
          state: 'error',
          message: 'Invalid code. Please make sure the full code was copied',
          toRetry: { state: 'waiting_for_login', url },
        })
        return
      }

      // Track which path the user is taking (manual code entry)
      logEvent('tengu_oauth_manual_entry', {})
      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state,
      })
    } catch (err: unknown) {
      logError(err)
      setOAuthStatus({
        state: 'error',
        message: (err as Error).message,
        toRetry: { state: 'waiting_for_login', url },
      })
    }
  }

  const startOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_flow_start', { loginWithClaudeAi })

      const result = await oauthService
        .startOAuthFlow(
          async url => {
            setOAuthStatus({ state: 'waiting_for_login', url })
            setTimeout(setShowPastePrompt, 3000, true)
          },
          {
            loginWithClaudeAi,
            inferenceOnly: mode === 'setup-token',
            expiresIn: mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined, // 1 year for setup-token
            orgUUID,
          },
        )
        .catch(err => {
          const isTokenExchangeError = err.message.includes(
            'Token exchange failed',
          )
          // Enterprise TLS proxies (Zscaler et al.) intercept the token
          // exchange POST and cause cryptic SSL errors. Surface an
          // actionable hint so the user isn't stuck in a login loop.
          const sslHint = getSSLErrorHint(err)
          setOAuthStatus({
            state: 'error',
            message:
              sslHint ??
              (isTokenExchangeError
                ? 'Failed to exchange authorization code for access token. Please try again.'
                : err.message),
            toRetry:
              mode === 'setup-token'
                ? { state: 'ready_to_start' }
                : { state: 'idle' },
          })
          logEvent('tengu_oauth_token_exchange_error', {
            error: err.message,
            ssl_error: sslHint !== null,
          })
          throw err
        })

      if (mode === 'setup-token') {
        // For setup-token mode, return the OAuth access token directly (it can be used as an API key)
        // Don't save to keychain - the token is displayed for manual use with CLAUDE_CODE_OAUTH_TOKEN
        setOAuthStatus({ state: 'success', token: result.accessToken })
      } else {
        await installOAuthTokens(result)

        const orgResult = await validateForceLoginOrg()
        if (!orgResult.valid) {
          throw new Error(orgResult.message)
        }
        // V7 §11.6 — connection records are the single source of truth.
        // Don't write `settings.modelType`; routing is now per-connection
        // via getProviderForModel(). Writing global modelType from one
        // login flow used to clobber other configured providers.
        upsertProtocolConnection(
          'anthropic',
          'Claude Account',
          'https://api.anthropic.com',
        )

        setOAuthStatus({ state: 'success' })
        // notification:ungated reason=user just authenticated, this is the success ack
        void sendNotification({ message: 'Claude Code login successful', notificationType: 'auth_success' }, terminal)
      }
    } catch (err) {
      const errorMessage = (err as Error).message
      const sslHint = getSSLErrorHint(err)
      setOAuthStatus({
        state: 'error',
        message: sslHint ?? errorMessage,
        toRetry: {
          state: mode === 'setup-token' ? 'ready_to_start' : 'idle',
        },
      })
      logEvent('tengu_oauth_error', {
        error:
          errorMessage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ssl_error: sslHint !== null,
      })
    }
  }, [oauthService, setShowPastePrompt, loginWithClaudeAi, mode, orgUUID])

  // Codex-specific OAuth flow — completely separate from the Anthropic OAuthService
  const startCodexOAuth = useCallback(async () => {
    try {
      logEvent('tengu_oauth_codex_flow_start', {})
      const codexTokens = await runCodexOAuthFlow(
        async url => {
          setOAuthStatus({ state: 'waiting_for_login', url })
          setTimeout(setShowPastePrompt, 3000, true)
        },
        () =>
          new Promise<string>(resolve => {
            codexManualInputResolverRef.current = resolve
          }),
      )
      // Save directly via saveCodexOAuthTokens (bypasses installOAuthTokens Anthropic path)
      saveCodexOAuthTokens(codexTokens)
      // Codex models come from the static mirror in
      // getDefaultModelsForProtocol('codex'). We tried dynamic /models
      // discovery; it requires impersonating the openai/codex Rust CLI's
      // version space and returned a tier-filtered list that varied
      // unpredictably with `client_version`. Static-list-as-mirror is
      // both more correct and less fragile.
      //
      // Routing happens per-model via the connection record; do NOT set
      // CLAUDE_CODE_USE_OPENAI here — that env var globally forces every
      // request (including Claude models on a coexisting Claude Account
      // connection) into the OpenAI adapter, which then 401s against
      // api.openai.com.
      upsertProtocolConnection(
        'codex',
        'ChatGPT Codex',
        'https://chatgpt.com/backend-api/codex/responses',
      )
      logEvent('tengu_oauth_codex_success', {})
      setOAuthStatus({ state: 'success' })
      // notification:ungated reason=user just authenticated, this is the success ack
      void sendNotification({ message: 'Codex login successful', notificationType: 'auth_success' }, terminal)
    } catch (err) {
      const msg = (err as Error).message
      logEvent('tengu_oauth_codex_error', {
        error: msg as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      setOAuthStatus({ state: 'error', message: msg, toRetry: { state: 'idle' } })
    }
  }, [setShowPastePrompt, terminal])

  const pendingOAuthStartRef = useRef(false)

  useEffect(() => {
    if (
      oauthStatus.state === 'ready_to_start' &&
      !pendingOAuthStartRef.current
    ) {
      pendingOAuthStartRef.current = true
      const flow = loginWithCodex ? startCodexOAuth() : startOAuth()
      void flow.finally(() => {
        pendingOAuthStartRef.current = false
      })
    }
  }, [oauthStatus.state, startOAuth, startCodexOAuth, loginWithCodex])

  // Auto-exit for setup-token mode
  useEffect(() => {
    if (mode === 'setup-token' && oauthStatus.state === 'success') {
      // Delay to ensure static content is fully rendered before exiting
      const timer = setTimeout(
        (loginWithClaudeAi, onDone) => {
          logEvent('tengu_oauth_success', { loginWithClaudeAi })
          // Don't clear terminal so the token remains visible
          onDone()
        },
        500,
        loginWithClaudeAi,
        onDone,
      )
      return () => clearTimeout(timer)
    }
  }, [mode, oauthStatus, loginWithClaudeAi, onDone])

  function handlePastePromptExit() {
    if (pastePromptExitHint) {
      onDone()
      return
    }
    setPastePromptExitHint(true)
    if (pastePromptExitTimeoutRef.current) {
      clearTimeout(pastePromptExitTimeoutRef.current)
    }
    pastePromptExitTimeoutRef.current = setTimeout(
      setPastePromptExitHint,
      800,
      false,
    )
  }

  // Cleanup OAuth service when component unmounts
  useEffect(() => {
    return () => {
      codexManualInputResolverRef.current = null
      if (pastePromptExitTimeoutRef.current) {
        clearTimeout(pastePromptExitTimeoutRef.current)
      }
      oauthService.cleanup()
    }
  }, [oauthService])

  return (
    <Box flexDirection="column" gap={1}>
      {oauthStatus.state === 'waiting_for_login' && showPastePrompt && (
        <Box flexDirection="column" key="urlToCopy" gap={1} paddingBottom={1}>
          <Box paddingX={1}>
            <Text dimColor>
              Browser didn&apos;t open? Use the url below to sign in{' '}
            </Text>
            {urlCopied ? (
              <Text color="success">(Copied!)</Text>
            ) : (
              <Text dimColor>
                <KeyboardShortcutHint shortcut="c" action="copy" parens />
              </Text>
            )}
          </Box>
          <Link url={oauthStatus.url}>
            <Text dimColor>{oauthStatus.url}</Text>
          </Link>
        </Box>
      )}
      {mode === 'setup-token' &&
        oauthStatus.state === 'success' &&
        oauthStatus.token && (
          <Box key="tokenOutput" flexDirection="column" gap={1} paddingTop={1}>
            <Text color="success">
              ✓ Long-lived authentication token created successfully!
            </Text>
            <Box flexDirection="column" gap={1}>
              <Text>Your OAuth token (valid for 1 year):</Text>
              <Text color="warning">{oauthStatus.token}</Text>
              <Text dimColor>
                Store this token securely. You won&apos;t be able to see it
                again.
              </Text>
              <Text dimColor>
                Use this token by setting: export
                CLAUDE_CODE_OAUTH_TOKEN=&lt;token&gt;
              </Text>
            </Box>
          </Box>
        )}
      <Box paddingLeft={1} flexDirection="column" gap={1}>
        <OAuthStatusMessage
          oauthStatus={oauthStatus}
          mode={mode}
          startingMessage={startingMessage}
          forcedMethodMessage={forcedMethodMessage}
          showPastePrompt={showPastePrompt}
          pastedCode={pastedCode}
          setPastedCode={setPastedCode}
          cursorOffset={cursorOffset}
          setCursorOffset={setCursorOffset}
          textInputColumns={textInputColumns}
          pastePromptExitHint={pastePromptExitHint}
          handlePastePromptExit={handlePastePromptExit}
          setPastePromptExitHint={setPastePromptExitHint}
          handleSubmitCode={handleSubmitCode}
          setOAuthStatus={setOAuthStatus}
          setLoginWithClaudeAi={setLoginWithClaudeAi}
          setLoginWithCodex={setLoginWithCodex}
          onDone={onDone}
          connectionName={connectionName}
          setConnectionName={setConnectionName}
        />
      </Box>
    </Box>
  )
}

type OAuthStatusMessageProps = {
  oauthStatus: OAuthStatus
  mode: 'login' | 'setup-token'
  startingMessage: string | undefined
  forcedMethodMessage: string | null
  showPastePrompt: boolean
  pastedCode: string
  setPastedCode: (value: string) => void
  cursorOffset: number
  onDone: () => void
  setCursorOffset: (offset: number) => void
  textInputColumns: number
  pastePromptExitHint: boolean
  handlePastePromptExit: () => void
  setPastePromptExitHint: (value: boolean) => void
  handleSubmitCode: (value: string, url: string) => void
  setOAuthStatus: (status: OAuthStatus) => void
  setLoginWithClaudeAi: (value: boolean) => void
  setLoginWithCodex: (value: boolean) => void
  /** Display name for newly-created compatible-provider connections. */
  connectionName: string
  setConnectionName: (value: string) => void
}

function OAuthStatusMessage({
  oauthStatus,
  mode,
  startingMessage,
  forcedMethodMessage,
  showPastePrompt,
  pastedCode,
  setPastedCode,
  cursorOffset,
  setCursorOffset,
  textInputColumns,
  pastePromptExitHint,
  handlePastePromptExit,
  setPastePromptExitHint,
  handleSubmitCode,
  setOAuthStatus,
  setLoginWithClaudeAi,
  setLoginWithCodex,
  onDone,
  connectionName,
  setConnectionName,
}: OAuthStatusMessageProps): React.ReactNode {
  switch (oauthStatus.state) {
    case 'select_connection': {
      const connections = getConnections()
      const protocolLabel: Record<ConnectionRecord['protocol'], string> = {
        anthropic: 'anthropic',
        openai: 'openai',
        codex: 'codex',
        gemini: 'gemini',
      }
      const connOptions = connections.map(c => {
        const authBadge =
          c.auth.type === 'oauth' ? `OAuth · ${c.auth.source}` : 'API key'
        return {
          label: (
            <Text>
              {c.enabled ? '✓ ' : '⊘ '}
              <Text bold>{c.name}</Text>
              {'\n'}
              <Text dimColor>
                {protocolLabel[c.protocol]} · {authBadge} · {c.endpoint}
                {'\n'}
                {c.models.length > 0
                  ? `${c.models.length} model${c.models.length === 1 ? '' : 's'}: ${c.models
                      .map(m => m.label)
                      .join(', ')}`
                  : 'no models'}
              </Text>
            </Text>
          ),
          value: c.id,
        }
      })

      connOptions.push({
        label: (
          <Text>
            ─────────────────────
            {'\n'}
            <Text bold>+ Add new connection</Text>
            {'\n'}
          </Text>
        ),
        value: '__add__',
      })

      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>Connections</Text>
          <Text dimColor>
            Each row is an independent provider. Multiple OpenAI Compatible /
            Anthropic Compatible connections can coexist.
          </Text>

          <Box>
            <Select
              options={connOptions}
              onChange={value => {
                if (value === '__add__') {
                  setOAuthStatus({ state: 'idle' })
                } else {
                  setOAuthStatus({ state: 'connection_action', id: value })
                }
              }}
            />
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              <Text bold>Enter</Text> manage · <Text bold>Esc</Text> back
            </Text>
          </Box>
        </Box>
      )
    }
    case 'connection_action': {
      const conn = getConnections().find(c => c.id === oauthStatus.id)
      if (!conn) {
        // Connection vanished underneath us (race) — bounce back to list.
        setOAuthStatus({ state: 'select_connection' })
        return null
      }
      const actions = [
        {
          label: (
            <Text>
              {conn.enabled ? '⊘ Disable' : '✓ Enable'}{' '}
              <Text dimColor>(keep credentials, stop routing to it)</Text>
            </Text>
          ),
          value: 'toggle',
        },
        {
          label: (
            <Text color="error">
              ✗ Disconnect{' '}
              <Text dimColor>
                (delete this connection
                {conn.auth.type === 'oauth' ? ' + clear OAuth tokens' : ''})
              </Text>
            </Text>
          ),
          value: 'disconnect',
        },
        {
          label: <Text dimColor>← Cancel</Text>,
          value: 'cancel',
        },
      ]
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>{conn.name}</Text>
          <Text dimColor>
            {conn.protocol} ·{' '}
            {conn.auth.type === 'oauth' ? 'OAuth' : 'API key'} · {conn.endpoint}
          </Text>
          <Box marginTop={1}>
            <Select
              options={actions}
              onChange={async value => {
                if (value === 'toggle') {
                  toggleConnection(conn.id)
                } else if (value === 'disconnect') {
                  await disconnectConnection(conn.id)
                }
                setOAuthStatus({ state: 'select_connection' })
              }}
            />
          </Box>
        </Box>
      )
    }
    case 'idle':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>
            {startingMessage
              ? startingMessage
              : `Claude Code can be used with your Claude subscription or billed based on API usage through your Console account.`}
          </Text>

          <Text>Select login method:</Text>

          <Box>
            <Select
              options={[
                {
                  label: (
                    <Text>
                      Claude account with subscription ·{' '}
                      <Text dimColor>Pro, Max, Team, or Enterprise</Text>
                      {process.env.USER_TYPE === 'ant' && (
                        <Text>
                          {'\n'}
                          <Text color="warning">[ANT-ONLY]</Text>{' '}
                          <Text dimColor>
                            Please use this option unless you need to login to a
                            special org for accessing sensitive data (e.g.
                            customer data, HIPI data) with the Console option
                          </Text>
                        </Text>
                      )}
                      {'\n'}
                    </Text>
                  ),
                  value: 'claudeai',
                },
                {
                  label: (
                    <Text>
                      OpenAI Codex account ·{' '}
                      <Text dimColor>ChatGPT Plus/Pro subscription</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'codex',
                },
                {
                  label: (
                    <Text>
                      Anthropic Console account ·{' '}
                      <Text dimColor>API usage billing</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'console',
                },
                {
                  label: (
                    <Text>
                      3rd-party platform ·{' '}
                      <Text dimColor>
                        Amazon Bedrock, Microsoft Foundry, or Vertex AI
                      </Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'platform',
                },
                {
                  label: (
                    <Text>
                      Anthropic Compatible ·{' '}
                      <Text dimColor>Configure your own API endpoint</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'custom_platform',
                },
                {
                  label: (
                    <Text>
                      OpenAI Compatible ·{' '}
                      <Text dimColor>
                        Ollama, DeepSeek, vLLM, One API, etc.
                      </Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'openai_chat_api',
                },
                {
                  label: (
                    <Text>
                      Gemini API ·{' '}
                      <Text dimColor>Google Gemini native REST/SSE</Text>
                      {'\n'}
                    </Text>
                  ),
                  value: 'gemini_api',
                },
              ]}
              onChange={value => {
                if (value === 'codex') {
                  logEvent('tengu_oauth_codex_selected', {})
                  setLoginWithCodex(true)
                  setLoginWithClaudeAi(false)
                  setOAuthStatus({ state: 'ready_to_start' })
                } else if (value === 'custom_platform') {
                  logEvent('tengu_custom_platform_selected', {})
                  setOAuthStatus({
                    state: 'custom_platform',
                    baseUrl: process.env.ANTHROPIC_BASE_URL ?? '',
                    apiKey: process.env.ANTHROPIC_AUTH_TOKEN ?? '',
                    haikuModel: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? '',
                    sonnetModel: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '',
                    opusModel: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? '',
                    activeField: 'base_url',
                  })
                } else if (value === 'openai_chat_api') {
                  logEvent('tengu_openai_chat_api_selected', {})
                  setOAuthStatus({
                    state: 'openai_chat_api',
                    baseUrl: process.env.OPENAI_BASE_URL ?? '',
                    apiKey: process.env.OPENAI_API_KEY ?? '',
                    haikuModel: process.env.OPENAI_DEFAULT_HAIKU_MODEL ?? '',
                    sonnetModel: process.env.OPENAI_DEFAULT_SONNET_MODEL ?? '',
                    opusModel: process.env.OPENAI_DEFAULT_OPUS_MODEL ?? '',
                    activeField: 'base_url',
                  })
                } else if (value === 'gemini_api') {
                  logEvent('tengu_gemini_api_selected', {})
                  setOAuthStatus({
                    state: 'gemini_api',
                    baseUrl: process.env.GEMINI_BASE_URL ?? '',
                    apiKey: process.env.GEMINI_API_KEY ?? '',
                    haikuModel: process.env.GEMINI_DEFAULT_HAIKU_MODEL ?? '',
                    sonnetModel: process.env.GEMINI_DEFAULT_SONNET_MODEL ?? '',
                    opusModel: process.env.GEMINI_DEFAULT_OPUS_MODEL ?? '',
                    activeField: 'base_url',
                  })
                } else if (value === 'platform') {
                  logEvent('tengu_oauth_platform_selected', {})
                  setOAuthStatus({ state: 'platform_setup' })
                } else {
                  setOAuthStatus({ state: 'ready_to_start' })
                  if (value === 'claudeai') {
                    logEvent('tengu_oauth_claudeai_selected', {})
                    setLoginWithClaudeAi(true)
                  } else {
                    logEvent('tengu_oauth_console_selected', {})
                    setLoginWithClaudeAi(false)
                  }
                }
              }}
            />
          </Box>
        </Box>
      )

    case 'custom_platform':
      {
        type Field = 'base_url' | 'api_key' | 'haiku_model' | 'sonnet_model' | 'opus_model'
        const FIELDS: Field[] = ['base_url', 'api_key', 'haiku_model', 'sonnet_model', 'opus_model']
        const cp = oauthStatus as {
          state: 'custom_platform'
          activeField: Field
          baseUrl: string
          apiKey: string
          haikuModel: string
          sonnetModel: string
          opusModel: string
        }
        const { activeField, baseUrl, apiKey, haikuModel, sonnetModel, opusModel } = cp
        const displayValues: Record<Field, string> = {
          base_url: baseUrl,
          api_key: apiKey,
          haiku_model: haikuModel,
          sonnet_model: sonnetModel,
          opus_model: opusModel,
        }

        const [inputValue, setInputValue] = useState(() => displayValues[activeField])
        const [inputCursorOffset, setInputCursorOffset] = useState(
          () => displayValues[activeField].length,
        )

        const buildState = useCallback(
          (field: Field, value: string, newActive?: Field) => {
            const s = {
              state: 'custom_platform' as const,
              activeField: newActive ?? activeField,
              baseUrl,
              apiKey,
              haikuModel,
              sonnetModel,
              opusModel,
            }
            switch (field) {
              case 'base_url':
                return { ...s, baseUrl: value }
              case 'api_key':
                return { ...s, apiKey: value }
              case 'haiku_model':
                return { ...s, haikuModel: value }
              case 'sonnet_model':
                return { ...s, sonnetModel: value }
              case 'opus_model':
                return { ...s, opusModel: value }
            }
          },
          [activeField, baseUrl, apiKey, haikuModel, sonnetModel, opusModel],
        )

        const switchTo = useCallback(
          (target: Field) => {
            setOAuthStatus(buildState(activeField, inputValue, target))
            setInputValue(displayValues[target] ?? '')
            setInputCursorOffset((displayValues[target] ?? '').length)
          },
          [activeField, inputValue, displayValues, buildState, setOAuthStatus],
        )

        const doSave = useCallback(() => {
          const finalVals = { ...displayValues, [activeField]: inputValue }

          if (!finalVals.base_url) {
            setOAuthStatus({
              state: 'error',
              message: 'Base URL is required for Anthropic Compatible.',
              toRetry: {
                state: 'custom_platform',
                baseUrl: finalVals.base_url ?? '',
                apiKey: finalVals.api_key ?? '',
                haikuModel: finalVals.haiku_model ?? '',
                sonnetModel: finalVals.sonnet_model ?? '',
                opusModel: finalVals.opus_model ?? '',
                activeField: 'base_url',
              },
            })
            return
          }
          try {
            new URL(finalVals.base_url)
          } catch {
            setOAuthStatus({
              state: 'error',
              message:
                'Invalid base URL: please enter a full URL including protocol (e.g., https://api.example.com)',
              toRetry: {
                state: 'custom_platform',
                baseUrl: '',
                apiKey: '',
                haikuModel: '',
                sonnetModel: '',
                opusModel: '',
                activeField: 'base_url',
              },
            })
            return
          }

          // Build the model list. User's overrides win over defaults; if they
          // didn't supply any, fall back to the protocol default list so the
          // model picker has something to show.
          const models: ConnectionModelRecord[] = []
          if (finalVals.opus_model) {
            models.push({
              id: finalVals.opus_model,
              label: `Opus (${finalVals.opus_model})`,
              description: 'Opus tier',
            })
          }
          if (finalVals.sonnet_model) {
            models.push({
              id: finalVals.sonnet_model,
              label: `Sonnet (${finalVals.sonnet_model})`,
              description: 'Sonnet tier',
            })
          }
          if (finalVals.haiku_model) {
            models.push({
              id: finalVals.haiku_model,
              label: `Haiku (${finalVals.haiku_model})`,
              description: 'Haiku tier',
            })
          }

          // Connection name: use user-provided if available; default to the
          // host portion of the URL so multiple custom proxies are
          // distinguishable in the picker.
          const url = new URL(finalVals.base_url)
          const name = connectionName.trim() || url.host

          try {
            upsertCompatibleConnection({
              protocol: 'anthropic',
              name,
              endpoint: finalVals.base_url,
              apiKey: finalVals.api_key ?? '',
              models: models.length > 0 ? models : undefined,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setOAuthStatus({
              state: 'error',
              message: msg,
              toRetry: {
                state: 'custom_platform',
                baseUrl: finalVals.base_url ?? '',
                apiKey: finalVals.api_key ?? '',
                haikuModel: finalVals.haiku_model ?? '',
                sonnetModel: finalVals.sonnet_model ?? '',
                opusModel: finalVals.opus_model ?? '',
                activeField: 'base_url',
              },
            })
            return
          }
          setOAuthStatus({ state: 'success' })
          void onDone()
        }, [
          activeField,
          inputValue,
          displayValues,
          connectionName,
          setOAuthStatus,
          onDone,
        ])

        const handleEnter = useCallback(() => {
          const idx = FIELDS.indexOf(activeField)
          if (idx === FIELDS.length - 1) {
            setOAuthStatus(buildState(activeField, inputValue))
            doSave()
          } else {
            const next = FIELDS[idx + 1]!
            setOAuthStatus(buildState(activeField, inputValue, next))
            setInputValue(displayValues[next] ?? '')
            setInputCursorOffset((displayValues[next] ?? '').length)
          }
        }, [activeField, inputValue, buildState, doSave, displayValues, setOAuthStatus])

        useKeybinding(
          'tabs:next',
          () => {
            const idx = FIELDS.indexOf(activeField)
            if (idx < FIELDS.length - 1) {
              setOAuthStatus(buildState(activeField, inputValue, FIELDS[idx + 1]))
              setInputValue(displayValues[FIELDS[idx + 1]!] ?? '')
              setInputCursorOffset((displayValues[FIELDS[idx + 1]!] ?? '').length)
            }
          },
          { context: 'FormField' },
        )
        useKeybinding(
          'tabs:previous',
          () => {
            const idx = FIELDS.indexOf(activeField)
            if (idx > 0) {
              setOAuthStatus(buildState(activeField, inputValue, FIELDS[idx - 1]))
              setInputValue(displayValues[FIELDS[idx - 1]!] ?? '')
              setInputCursorOffset((displayValues[FIELDS[idx - 1]!] ?? '').length)
            }
          },
          { context: 'FormField' },
        )
        useKeybinding(
          'confirm:no',
          () => {
            setOAuthStatus({ state: 'idle' })
          },
          { context: 'Confirmation' },
        )

        const columns = useTerminalSize().columns - 20

        const renderRow = (
          field: Field,
          label: string,
          opts?: { mask?: boolean; placeholder?: string },
        ) => {
          const active = activeField === field
          const val = displayValues[field]
          return (
            <Box>
              <Text
                backgroundColor={active ? 'suggestion' : undefined}
                color={active ? 'inverseText' : undefined}
              >
                {` ${label} `}
              </Text>
              <Text> </Text>
              {active ? (
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={handleEnter}
                  cursorOffset={inputCursorOffset}
                  onChangeCursorOffset={setInputCursorOffset}
                  columns={columns}
                  mask={opts?.mask ? '*' : undefined}
                  focus={true}
                />
              ) : val ? (
                <Text color="success">
                  {opts?.mask
                    ? val.slice(0, 8) + '\u00b7'.repeat(Math.max(0, val.length - 8))
                    : val}
                </Text>
              ) : null}
            </Box>
          )
        }

        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Anthropic Compatible Setup</Text>
            <Box flexDirection="column" gap={1}>
              {renderRow('base_url', 'Base URL ')}
              {renderRow('api_key', 'API Key  ', { mask: true })}
              {renderRow('haiku_model', 'Haiku    ')}
              {renderRow('sonnet_model', 'Sonnet   ')}
              {renderRow('opus_model', 'Opus     ')}
            </Box>
            <Text dimColor>
              ↑↓/Tab to switch · Enter on last field to save · Esc to go back
            </Text>
          </Box>
        )
      }

    case 'openai_chat_api':
      {
        type OpenAIField = 'base_url' | 'api_key' | 'haiku_model' | 'sonnet_model' | 'opus_model'
        const OPENAI_FIELDS: OpenAIField[] = [
          'base_url',
          'api_key',
          'haiku_model',
          'sonnet_model',
          'opus_model',
        ]
        const op = oauthStatus as {
          state: 'openai_chat_api'
          activeField: OpenAIField
          baseUrl: string
          apiKey: string
          haikuModel: string
          sonnetModel: string
          opusModel: string
        }
        const { activeField, baseUrl, apiKey, haikuModel, sonnetModel, opusModel } = op
        const openaiDisplayValues: Record<OpenAIField, string> = {
          base_url: baseUrl,
          api_key: apiKey,
          haiku_model: haikuModel,
          sonnet_model: sonnetModel,
          opus_model: opusModel,
        }

        const [openaiInputValue, setOpenaiInputValue] = useState(
          () => openaiDisplayValues[activeField],
        )
        const [openaiInputCursorOffset, setOpenaiInputCursorOffset] = useState(
          () => openaiDisplayValues[activeField].length,
        )

        const buildOpenAIState = useCallback(
          (field: OpenAIField, value: string, newActive?: OpenAIField) => {
            const s = {
              state: 'openai_chat_api' as const,
              activeField: newActive ?? activeField,
              baseUrl,
              apiKey,
              haikuModel,
              sonnetModel,
              opusModel,
            }
            switch (field) {
              case 'base_url':
                return { ...s, baseUrl: value }
              case 'api_key':
                return { ...s, apiKey: value }
              case 'haiku_model':
                return { ...s, haikuModel: value }
              case 'sonnet_model':
                return { ...s, sonnetModel: value }
              case 'opus_model':
                return { ...s, opusModel: value }
            }
          },
          [activeField, baseUrl, apiKey, haikuModel, sonnetModel, opusModel],
        )

        const doOpenAISave = useCallback(() => {
          const finalVals = {
            ...openaiDisplayValues,
            [activeField]: openaiInputValue,
          }

          if (!finalVals.base_url) {
            setOAuthStatus({
              state: 'error',
              message: 'Base URL is required for OpenAI Compatible.',
              toRetry: {
                state: 'openai_chat_api',
                baseUrl: finalVals.base_url ?? '',
                apiKey: finalVals.api_key ?? '',
                haikuModel: finalVals.haiku_model ?? '',
                sonnetModel: finalVals.sonnet_model ?? '',
                opusModel: finalVals.opus_model ?? '',
                activeField: 'base_url',
              },
            })
            return
          }
          try {
            new URL(finalVals.base_url)
          } catch {
            setOAuthStatus({
              state: 'error',
              message:
                'Invalid base URL: please enter a full URL including protocol (e.g., https://api.example.com)',
              toRetry: {
                state: 'openai_chat_api',
                baseUrl: '',
                apiKey: '',
                haikuModel: '',
                sonnetModel: '',
                opusModel: '',
                activeField: 'base_url',
              },
            })
            return
          }

          const models: ConnectionModelRecord[] = []
          if (finalVals.opus_model) {
            models.push({
              id: finalVals.opus_model,
              label: finalVals.opus_model,
              description: 'Opus tier',
            })
          }
          if (finalVals.sonnet_model) {
            models.push({
              id: finalVals.sonnet_model,
              label: finalVals.sonnet_model,
              description: 'Sonnet tier',
            })
          }
          if (finalVals.haiku_model) {
            models.push({
              id: finalVals.haiku_model,
              label: finalVals.haiku_model,
              description: 'Haiku tier',
            })
          }

          const url = new URL(finalVals.base_url)
          const name = connectionName.trim() || url.host

          try {
            upsertCompatibleConnection({
              protocol: 'openai',
              name,
              endpoint: finalVals.base_url,
              apiKey: finalVals.api_key ?? '',
              models: models.length > 0 ? models : undefined,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setOAuthStatus({
              state: 'error',
              message: msg,
              toRetry: {
                state: 'openai_chat_api',
                baseUrl: finalVals.base_url ?? '',
                apiKey: finalVals.api_key ?? '',
                haikuModel: finalVals.haiku_model ?? '',
                sonnetModel: finalVals.sonnet_model ?? '',
                opusModel: finalVals.opus_model ?? '',
                activeField: 'base_url',
              },
            })
            return
          }
          setOAuthStatus({ state: 'success' })
          void onDone()
        }, [
          activeField,
          openaiInputValue,
          openaiDisplayValues,
          connectionName,
          setOAuthStatus,
          onDone,
        ])

        const handleOpenAIEnter = useCallback(() => {
          const idx = OPENAI_FIELDS.indexOf(activeField)
          if (idx === OPENAI_FIELDS.length - 1) {
            setOAuthStatus(buildOpenAIState(activeField, openaiInputValue))
            doOpenAISave()
          } else {
            const next = OPENAI_FIELDS[idx + 1]!
            setOAuthStatus(buildOpenAIState(activeField, openaiInputValue, next))
            setOpenaiInputValue(openaiDisplayValues[next] ?? '')
            setOpenaiInputCursorOffset((openaiDisplayValues[next] ?? '').length)
          }
        }, [
          activeField,
          openaiInputValue,
          buildOpenAIState,
          doOpenAISave,
          openaiDisplayValues,
          setOAuthStatus,
        ])

        useKeybinding(
          'tabs:next',
          () => {
            const idx = OPENAI_FIELDS.indexOf(activeField)
            if (idx < OPENAI_FIELDS.length - 1) {
              setOAuthStatus(
                buildOpenAIState(activeField, openaiInputValue, OPENAI_FIELDS[idx + 1]),
              )
              setOpenaiInputValue(openaiDisplayValues[OPENAI_FIELDS[idx + 1]!] ?? '')
              setOpenaiInputCursorOffset(
                (openaiDisplayValues[OPENAI_FIELDS[idx + 1]!] ?? '').length,
              )
            }
          },
          { context: 'FormField' },
        )
        useKeybinding(
          'tabs:previous',
          () => {
            const idx = OPENAI_FIELDS.indexOf(activeField)
            if (idx > 0) {
              setOAuthStatus(
                buildOpenAIState(activeField, openaiInputValue, OPENAI_FIELDS[idx - 1]),
              )
              setOpenaiInputValue(openaiDisplayValues[OPENAI_FIELDS[idx - 1]!] ?? '')
              setOpenaiInputCursorOffset(
                (openaiDisplayValues[OPENAI_FIELDS[idx - 1]!] ?? '').length,
              )
            }
          },
          { context: 'FormField' },
        )
        useKeybinding(
          'confirm:no',
          () => {
            setOAuthStatus({ state: 'idle' })
          },
          { context: 'Confirmation' },
        )

        const openaiColumns = useTerminalSize().columns - 20

        const renderOpenAIRow = (
          field: OpenAIField,
          label: string,
          opts?: { mask?: boolean },
        ) => {
          const active = activeField === field
          const val = openaiDisplayValues[field]
          return (
            <Box>
              <Text
                backgroundColor={active ? 'suggestion' : undefined}
                color={active ? 'inverseText' : undefined}
              >
                {` ${label} `}
              </Text>
              <Text> </Text>
              {active ? (
                <TextInput
                  value={openaiInputValue}
                  onChange={setOpenaiInputValue}
                  onSubmit={handleOpenAIEnter}
                  cursorOffset={openaiInputCursorOffset}
                  onChangeCursorOffset={setOpenaiInputCursorOffset}
                  columns={openaiColumns}
                  mask={opts?.mask ? '*' : undefined}
                  focus={true}
                />
              ) : val ? (
                <Text color="success">
                  {opts?.mask
                    ? val.slice(0, 8) + '\u00b7'.repeat(Math.max(0, val.length - 8))
                    : val}
                </Text>
              ) : null}
            </Box>
          )
        }

        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>OpenAI Compatible API Setup</Text>
            <Text dimColor>
              Configure an OpenAI Chat Completions compatible endpoint (e.g.
              Ollama, DeepSeek, vLLM).
            </Text>
            <Box flexDirection="column" gap={1}>
              {renderOpenAIRow('base_url', 'Base URL ')}
              {renderOpenAIRow('api_key', 'API Key  ', { mask: true })}
              {renderOpenAIRow('haiku_model', 'Haiku    ')}
              {renderOpenAIRow('sonnet_model', 'Sonnet   ')}
              {renderOpenAIRow('opus_model', 'Opus     ')}
            </Box>
            <Text dimColor>
              ↑↓/Tab to switch · Enter on last field to save · Esc to go back
            </Text>
          </Box>
        )
      }

    case 'gemini_api':
      {
        type GeminiField = 'base_url' | 'api_key' | 'haiku_model' | 'sonnet_model' | 'opus_model'
        const GEMINI_FIELDS: GeminiField[] = [
          'base_url',
          'api_key',
          'haiku_model',
          'sonnet_model',
          'opus_model',
        ]
        const gp = oauthStatus as {
          state: 'gemini_api'
          activeField: GeminiField
          baseUrl: string
          apiKey: string
          haikuModel: string
          sonnetModel: string
          opusModel: string
        }
        const { activeField, baseUrl, apiKey, haikuModel, sonnetModel, opusModel } = gp
        const geminiDisplayValues: Record<GeminiField, string> = {
          base_url: baseUrl,
          api_key: apiKey,
          haiku_model: haikuModel,
          sonnet_model: sonnetModel,
          opus_model: opusModel,
        }

        const [geminiInputValue, setGeminiInputValue] = useState(
          () => geminiDisplayValues[activeField],
        )
        const [geminiInputCursorOffset, setGeminiInputCursorOffset] = useState(
          () => geminiDisplayValues[activeField].length,
        )

        const buildGeminiState = useCallback(
          (field: GeminiField, value: string, newActive?: GeminiField) => {
            const s = {
              state: 'gemini_api' as const,
              activeField: newActive ?? activeField,
              baseUrl,
              apiKey,
              haikuModel,
              sonnetModel,
              opusModel,
            }
            switch (field) {
              case 'base_url':
                return { ...s, baseUrl: value }
              case 'api_key':
                return { ...s, apiKey: value }
              case 'haiku_model':
                return { ...s, haikuModel: value }
              case 'sonnet_model':
                return { ...s, sonnetModel: value }
              case 'opus_model':
                return { ...s, opusModel: value }
            }
          },
          [activeField, baseUrl, apiKey, haikuModel, sonnetModel, opusModel],
        )

        const doGeminiSave = useCallback(() => {
          const finalVals = {
            ...geminiDisplayValues,
            [activeField]: geminiInputValue,
          }
          if (
            !finalVals.haiku_model ||
            !finalVals.sonnet_model ||
            !finalVals.opus_model
          ) {
            setOAuthStatus({
              state: 'error',
              message: 'Gemini setup requires Haiku, Sonnet, and Opus model names.',
              toRetry: {
                state: 'gemini_api',
                baseUrl: finalVals.base_url,
                apiKey: finalVals.api_key,
                haikuModel: finalVals.haiku_model,
                sonnetModel: finalVals.sonnet_model,
                opusModel: finalVals.opus_model,
                activeField,
              },
            })
            return
          }

          const models: ConnectionModelRecord[] = [
            {
              id: finalVals.opus_model,
              label: finalVals.opus_model,
              description: 'Opus tier',
            },
            {
              id: finalVals.sonnet_model,
              label: finalVals.sonnet_model,
              description: 'Sonnet tier',
            },
            {
              id: finalVals.haiku_model,
              label: finalVals.haiku_model,
              description: 'Haiku tier',
            },
          ]

          const endpoint =
            finalVals.base_url ||
            'https://generativelanguage.googleapis.com/v1beta'
          const url = (() => {
            try {
              return new URL(endpoint)
            } catch {
              return null
            }
          })()
          const name =
            connectionName.trim() || (url ? url.host : 'Gemini API')

          try {
            upsertCompatibleConnection({
              protocol: 'gemini',
              name,
              endpoint,
              apiKey: finalVals.api_key ?? '',
              models,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            setOAuthStatus({
              state: 'error',
              message: msg,
              toRetry: {
                state: 'gemini_api',
                baseUrl: finalVals.base_url ?? '',
                apiKey: finalVals.api_key ?? '',
                haikuModel: finalVals.haiku_model ?? '',
                sonnetModel: finalVals.sonnet_model ?? '',
                opusModel: finalVals.opus_model ?? '',
                activeField: 'base_url',
              },
            })
            return
          }
          setOAuthStatus({ state: 'success' })
          void onDone()
        }, [
          activeField,
          geminiInputValue,
          geminiDisplayValues,
          connectionName,
          onDone,
          setOAuthStatus,
        ])

        const handleGeminiEnter = useCallback(() => {
          const idx = GEMINI_FIELDS.indexOf(activeField)
          if (idx === GEMINI_FIELDS.length - 1) {
            setOAuthStatus(buildGeminiState(activeField, geminiInputValue))
            doGeminiSave()
          } else {
            const next = GEMINI_FIELDS[idx + 1]!
            setOAuthStatus(buildGeminiState(activeField, geminiInputValue, next))
            setGeminiInputValue(geminiDisplayValues[next] ?? '')
            setGeminiInputCursorOffset((geminiDisplayValues[next] ?? '').length)
          }
        }, [
          activeField,
          buildGeminiState,
          doGeminiSave,
          geminiDisplayValues,
          geminiInputValue,
          setOAuthStatus,
        ])

        useKeybinding(
          'tabs:next',
          () => {
            const idx = GEMINI_FIELDS.indexOf(activeField)
            if (idx < GEMINI_FIELDS.length - 1) {
              setOAuthStatus(
                buildGeminiState(activeField, geminiInputValue, GEMINI_FIELDS[idx + 1]),
              )
              setGeminiInputValue(geminiDisplayValues[GEMINI_FIELDS[idx + 1]!] ?? '')
              setGeminiInputCursorOffset(
                (geminiDisplayValues[GEMINI_FIELDS[idx + 1]!] ?? '').length,
              )
            }
          },
          { context: 'FormField' },
        )
        useKeybinding(
          'tabs:previous',
          () => {
            const idx = GEMINI_FIELDS.indexOf(activeField)
            if (idx > 0) {
              setOAuthStatus(
                buildGeminiState(activeField, geminiInputValue, GEMINI_FIELDS[idx - 1]),
              )
              setGeminiInputValue(geminiDisplayValues[GEMINI_FIELDS[idx - 1]!] ?? '')
              setGeminiInputCursorOffset(
                (geminiDisplayValues[GEMINI_FIELDS[idx - 1]!] ?? '').length,
              )
            }
          },
          { context: 'FormField' },
        )
        useKeybinding(
          'confirm:no',
          () => {
            setOAuthStatus({ state: 'idle' })
          },
          { context: 'Confirmation' },
        )

        const geminiColumns = useTerminalSize().columns - 20

        const renderGeminiRow = (
          field: GeminiField,
          label: string,
          opts?: { mask?: boolean },
        ) => {
          const active = activeField === field
          const val = geminiDisplayValues[field]
          return (
            <Box>
              <Text
                backgroundColor={active ? 'suggestion' : undefined}
                color={active ? 'inverseText' : undefined}
              >
                {` ${label} `}
              </Text>
              <Text> </Text>
              {active ? (
                <TextInput
                  value={geminiInputValue}
                  onChange={setGeminiInputValue}
                  onSubmit={handleGeminiEnter}
                  cursorOffset={geminiInputCursorOffset}
                  onChangeCursorOffset={setGeminiInputCursorOffset}
                  columns={geminiColumns}
                  mask={opts?.mask ? '*' : undefined}
                  focus={true}
                />
              ) : val ? (
                <Text color="success">
                  {opts?.mask
                    ? val.slice(0, 8) + '\u00b7'.repeat(Math.max(0, val.length - 8))
                    : val}
                </Text>
              ) : null}
            </Box>
          )
        }

        return (
          <Box flexDirection="column" gap={1}>
            <Text bold>Gemini API Setup</Text>
            <Text dimColor>
              Configure a Gemini Generate Content compatible endpoint. Base URL is
              optional and defaults to Google&apos;s v1beta API.
            </Text>
            <Box flexDirection="column" gap={1}>
              {renderGeminiRow('base_url', 'Base URL ')}
              {renderGeminiRow('api_key', 'API Key  ', { mask: true })}
              {renderGeminiRow('haiku_model', 'Haiku    ')}
              {renderGeminiRow('sonnet_model', 'Sonnet   ')}
              {renderGeminiRow('opus_model', 'Opus     ')}
            </Box>
            <Text dimColor>
              ↑↓/Tab to switch · Enter on last field to save · Esc to go back
            </Text>
          </Box>
        )
      }

    case 'platform_setup':
      return (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text bold>Using 3rd-party platforms</Text>

          <Box flexDirection="column" gap={1}>
            <Text>
              Claude Code supports Amazon Bedrock, Microsoft Foundry, and Vertex
              AI. Set the required environment variables, then restart Claude
              Code.
            </Text>

            <Text>
              If you are part of an enterprise organization, contact your
              administrator for setup instructions.
            </Text>

            <Box flexDirection="column" marginTop={1}>
              <Text bold>Documentation:</Text>
              <Text>
                · Amazon Bedrock:{' '}
                <Link url="https://code.claude.com/docs/en/amazon-bedrock">
                  https://code.claude.com/docs/en/amazon-bedrock
                </Link>
              </Text>
              <Text>
                · Microsoft Foundry:{' '}
                <Link url="https://code.claude.com/docs/en/microsoft-foundry">
                  https://code.claude.com/docs/en/microsoft-foundry
                </Link>
              </Text>
              <Text>
                · Vertex AI:{' '}
                <Link url="https://code.claude.com/docs/en/google-vertex-ai">
                  https://code.claude.com/docs/en/google-vertex-ai
                </Link>
              </Text>
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text bold>Enter</Text> to go back to login options.
              </Text>
            </Box>
          </Box>
        </Box>
      )

    case 'waiting_for_login':
      return (
        <Box flexDirection="column" gap={1}>
          {forcedMethodMessage && (
            <Box>
              <Text dimColor>{forcedMethodMessage}</Text>
            </Box>
          )}

          {!showPastePrompt && (
            <Box>
              <Spinner />
              <Text>Opening browser to sign in…</Text>
            </Box>
          )}

          {showPastePrompt && (
            <Box>
              <Text>{PASTE_HERE_MSG}</Text>
              <TextInput
                value={pastedCode}
                onChange={setPastedCode}
                onSubmit={(value: string) =>
                  handleSubmitCode(value, oauthStatus.url)
                }
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                columns={textInputColumns}
                mask="*"
                onExit={handlePastePromptExit}
                onExitMessage={setPastePromptExitHint}
              />
            </Box>
          )}

          {showPastePrompt && pastePromptExitHint && (
            <Text dimColor>Press Ctrl-C again to exit</Text>
          )}
        </Box>
      )

    case 'creating_api_key':
      return (
        <Box flexDirection="column" gap={1}>
          <Box>
            <Spinner />
            <Text>Creating API key for Claude Code…</Text>
          </Box>
        </Box>
      )

    case 'about_to_retry':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="permission">Retrying…</Text>
        </Box>
      )

    case 'success':
      return (
        <Box flexDirection="column">
          {mode === 'setup-token' && oauthStatus.token ? null : (
            <>
              {getOauthAccountInfo()?.emailAddress ? (
                <Text dimColor>
                  Logged in as{' '}
                  <Text>{getOauthAccountInfo()?.emailAddress}</Text>
                </Text>
              ) : null}
              <Text color="success">
                Login successful. Press <Text bold>Enter</Text> to continue…
              </Text>
            </>
          )}
        </Box>
      )

    case 'error':
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">OAuth error: {oauthStatus.message}</Text>

          {oauthStatus.toRetry && (
            <Box marginTop={1}>
              <Text color="permission">
                Press <Text bold>Enter</Text> to retry.
              </Text>
            </Box>
          )}
        </Box>
      )

    default:
      return null
  }
}
