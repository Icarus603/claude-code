/**
 * Miscellaneous subcommand handlers — extracted from main.tsx for lazy loading.
 * setup-token, doctor, install
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { cwd } from 'process'
import React from 'react'
import { WelcomeV2 } from '@claude-code/repl/components/LogoV2/WelcomeV2.js'
import { useManagePlugins } from '@claude-code/repl/hooks/useManagePlugins.js'
import type { Root } from '@anthropic/ink'
import { Box, Text } from '@anthropic/ink'
import { KeybindingSetup } from '@claude-code/repl/keybindings/KeybindingProviderSetup.js'
import { logEvent } from '@claude-code/local-observability'
import { MCPConnectionManager } from 'src/services/mcp/MCPConnectionManager.js'
import { AppStateProvider } from '../appStateShim.js'
import { onChangeAppState } from 'src/state/onChangeAppState.js'
import { isAnthropicAuthEnabled } from 'src/utils/auth.js'

export async function setupTokenHandler(root: Root): Promise<void> {
  logEvent('tengu_setup_token_command', {})

  const showAuthWarning = !isAnthropicAuthEnabled()
  const { ConsoleOAuthFlow } = await import(
    '@claude-code/repl/components/ConsoleOAuthFlow.js'
  )
  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider onChangeAppState={onChangeAppState}>
        <KeybindingSetup>
          <Box flexDirection="column" gap={1}>
            <WelcomeV2 />
            {showAuthWarning && (
              <Box flexDirection="column">
                <Text color="warning">
                  Warning: You already have authentication configured via
                  environment variable or API key helper.
                </Text>
                <Text color="warning">
                  The setup-token command will create a new OAuth token which
                  you can use instead.
                </Text>
              </Box>
            )}
            <ConsoleOAuthFlow
              onDone={() => {
                void resolve()
              }}
              mode="setup-token"
              startingMessage="This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required."
            />
          </Box>
        </KeybindingSetup>
      </AppStateProvider>,
    )
  })
  root.unmount()
  process.exit(0)
}

// DoctorWithPlugins wrapper + doctor handler
const DoctorLazy = React.lazy(() =>
  import('@claude-code/repl/screens/Doctor.js').then(m => ({ default: m.Doctor })),
)

function DoctorWithPlugins({
  onDone,
}: {
  onDone: () => void
}): React.ReactNode {
  useManagePlugins()
  return (
    <React.Suspense fallback={null}>
      <DoctorLazy onDone={onDone} />
    </React.Suspense>
  )
}

export async function doctorHandler(root: Root): Promise<void> {
  logEvent('tengu_doctor_command', {})

  await new Promise<void>(resolve => {
    root.render(
      <AppStateProvider>
        <KeybindingSetup>
          <MCPConnectionManager
            dynamicMcpConfig={undefined}
            isStrictMcpConfig={false}
          >
            <DoctorWithPlugins
              onDone={() => {
                void resolve()
              }}
            />
          </MCPConnectionManager>
        </KeybindingSetup>
      </AppStateProvider>,
    )
  })
  root.unmount()
  process.exit(0)
}

// install handler
export async function installHandler(
  target: string | undefined,
  options: { force?: boolean },
): Promise<void> {
  const { setup } = await import('src/setup.js')
  await setup(cwd(), 'default', false, false, undefined, false)
  const { install } = await import('src/commands/install.js')
  await new Promise<void>(resolve => {
    const args: string[] = []
    if (target) args.push(target)
    if (options.force) args.push('--force')

    void install.call(
      result => {
        void resolve()
        process.exit(result.includes('failed') ? 1 : 0)
      },
      {},
      args,
    )
  })
}
