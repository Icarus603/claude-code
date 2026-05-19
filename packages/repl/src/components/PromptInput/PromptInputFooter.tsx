import { feature } from 'bun:bundle'
import * as React from 'react'
import { memo, type ReactNode, useMemo, useRef } from 'react'
import { isBridgeEnabled } from '@claude-code/bridge/bridgeEnabled.js'
import { getBridgeStatus } from '@claude-code/bridge/bridgeStatusUtil.js'
import { useSetPromptOverlay } from '../../promptOverlayContext.js'
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js'
import type { IDESelection } from '@claude-code/ide/hooks/useIdeSelection.js'
import { useSettings } from '../../hooks/useSettings.js'
import { useTerminalSize } from '@anthropic/ink'
import { Box, Text } from '@anthropic/ink'
import type { MCPServerConnection } from '@claude-code/mcp-runtime/types.js'
import { useAppState } from '../../appStateHooks.js'
import type { ToolPermissionContext } from '@claude-code/tool-registry/Tool.js'
import type { Message } from '@claude-code/agent/messageShapes'
import type { PromptInputMode, VimMode } from '../../textInputTypes.js'
import type { AutoUpdaterResult } from '@claude-code/updater/autoUpdater.js'
import { isFullscreenEnvEnabled } from '../../fullscreen.js'
import { isUndercover } from '@claude-code/tool-registry/undercover.js'
import {
  CoordinatorTaskPanel,
  useCoordinatorTaskCount,
} from '../CoordinatorAgentStatus.js'
import {
  getLastAssistantMessageId,
  StatusLine,
  statusLineShouldDisplay,
} from '../StatusLine.js'
import { Notifications, useNotificationsVisible } from './Notifications.js'
import { PromptInputFooterLeftSide } from './PromptInputFooterLeftSide.js'
import { GoalActiveIndicator } from '../goal/GoalActiveIndicator.js'
import {
  PromptInputFooterSuggestions,
  type SuggestionItem,
} from './PromptInputFooterSuggestions.js'
import { PromptInputHelpMenu } from './PromptInputHelpMenu.js'

type Props = {
  apiKeyStatus: VerificationStatus
  debug: boolean
  exitMessage: {
    show: boolean
    key?: string
  }
  vimMode: VimMode | undefined
  mode: PromptInputMode
  autoUpdaterResult: AutoUpdaterResult | null
  isAutoUpdating: boolean
  verbose: boolean
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void
  onChangeIsUpdating: (isUpdating: boolean) => void
  suggestions: SuggestionItem[]
  selectedSuggestion: number
  maxColumnWidth?: number
  toolPermissionContext: ToolPermissionContext
  helpOpen: boolean
  suppressHint: boolean
  isLoading: boolean
  tasksSelected: boolean
  teamsSelected: boolean
  bridgeSelected: boolean
  tmuxSelected: boolean
  teammateFooterIndex?: number
  ideSelection: IDESelection | undefined
  mcpClients?: MCPServerConnection[]
  isPasting?: boolean
  isInputWrapped?: boolean
  messages: Message[]
  isSearching: boolean
  historyQuery: string
  setHistoryQuery: (query: string) => void
  historyFailedMatch: boolean
  onOpenTasksDialog?: (taskId?: string) => void
}

function PromptInputFooter({
  apiKeyStatus,
  debug,
  exitMessage,
  vimMode,
  mode,
  autoUpdaterResult,
  isAutoUpdating,
  verbose,
  onAutoUpdaterResult,
  onChangeIsUpdating,
  suggestions,
  selectedSuggestion,
  maxColumnWidth,
  toolPermissionContext,
  helpOpen,
  suppressHint: suppressHintFromProps,
  isLoading,
  tasksSelected,
  teamsSelected,
  bridgeSelected,
  tmuxSelected,
  teammateFooterIndex,
  ideSelection,
  mcpClients,
  isPasting = false,
  isInputWrapped = false,
  messages,
  isSearching,
  historyQuery,
  setHistoryQuery,
  historyFailedMatch,
  onOpenTasksDialog,
}: Props): ReactNode {
  const settings = useSettings()
  const { columns, rows } = useTerminalSize()
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const lastAssistantMessageId = useMemo(
    () => getLastAssistantMessageId(messages),
    [messages],
  )
  const isNarrow = columns < 80
  // In fullscreen the bottom slot is flexShrink:0, so every row here is a row
  // stolen from the ScrollBox. Drop the optional StatusLine first. Non-fullscreen
  // has terminal scrollback to absorb overflow, so we never hide StatusLine there.
  const isFullscreen = isFullscreenEnvEnabled()
  const isShort = isFullscreen && rows < 24

  // Pill highlights when tasks is the active footer item AND no specific
  // agent row is selected. When coordinatorTaskIndex >= 0 the pointer has
  // moved into CoordinatorTaskPanel, so the pill should un-highlight.
  // coordinatorTaskCount === 0 covers the bash-only case (no agent rows
  // exist, pill is the only selectable item).
  const coordinatorTaskCount = useCoordinatorTaskCount()
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex)
  const pillSelected =
    tasksSelected && (coordinatorTaskCount === 0 || coordinatorTaskIndex < 0)

  // ant 4930.js QW6 `o` — true when the right-side notification stack
  // would render any visible content. /goal active pill uses this to
  // decide whether to prefix " · ". Without this gate the separator
  // dangles on its own (the leading "·" bug).
  const notificationsVisible = useNotificationsVisible({
    apiKeyStatus,
    autoUpdaterResult,
    isAutoUpdating,
    debug,
    verbose,
    ideSelection,
    mcpClients,
  })

  // Hide `? for shortcuts` if the user has a custom status line, or during ctrl-r
  const suppressHint =
    suppressHintFromProps || statusLineShouldDisplay(settings) || isSearching
  // Fullscreen: portal data to FullscreenLayout — see promptOverlayContext.tsx
  const overlayData = useMemo(
    () =>
      isFullscreen && suggestions.length
        ? { suggestions, selectedSuggestion, maxColumnWidth }
        : null,
    [isFullscreen, suggestions, selectedSuggestion, maxColumnWidth],
  )
  useSetPromptOverlay(overlayData)

  if (suggestions.length && !isFullscreen) {
    return (
      <Box paddingX={2} paddingY={0}>
        <PromptInputFooterSuggestions
          suggestions={suggestions}
          selectedSuggestion={selectedSuggestion}
          maxColumnWidth={maxColumnWidth}
        />
      </Box>
    )
  }

  if (helpOpen) {
    return (
      <PromptInputHelpMenu dimColor={true} fixedWidth={true} paddingX={2} />
    )
  }

  return (
    <>
      <Box
        flexDirection={isNarrow ? 'column' : 'row'}
        justifyContent={isNarrow ? 'flex-start' : 'space-between'}
        paddingX={2}
        gap={isNarrow ? 0 : 1}
      >
        <Box flexDirection="column" flexShrink={isNarrow ? 0 : 1}>
          {mode === 'prompt' &&
            !isShort &&
            !exitMessage.show &&
            !isPasting &&
            statusLineShouldDisplay(settings) && (
              <StatusLine
                messagesRef={messagesRef}
                lastAssistantMessageId={lastAssistantMessageId}
                vimMode={vimMode}
              />
            )}
          <PromptInputFooterLeftSide
            exitMessage={exitMessage}
            vimMode={vimMode}
            mode={mode}
            toolPermissionContext={toolPermissionContext}
            suppressHint={suppressHint}
            isLoading={isLoading}
            tasksSelected={pillSelected}
            teamsSelected={teamsSelected}
            teammateFooterIndex={teammateFooterIndex}
            tmuxSelected={tmuxSelected}
            isPasting={isPasting}
            isSearching={isSearching}
            historyQuery={historyQuery}
            setHistoryQuery={setHistoryQuery}
            historyFailedMatch={historyFailedMatch}
            onOpenTasksDialog={onOpenTasksDialog}
          />
        </Box>
        <Box flexShrink={1} gap={1}>
          {isFullscreen ? null : (
            <Notifications
              apiKeyStatus={apiKeyStatus}
              autoUpdaterResult={autoUpdaterResult}
              debug={debug}
              isAutoUpdating={isAutoUpdating}
              verbose={verbose}
              messages={messages}
              onAutoUpdaterResult={onAutoUpdaterResult}
              onChangeIsUpdating={onChangeIsUpdating}
              ideSelection={ideSelection}
              mcpClients={mcpClients}
              isInputWrapped={isInputWrapped}
              isNarrow={isNarrow}
            />
          )}
          {process.env.USER_TYPE === 'ant' && isUndercover() && (
            <Text dimColor>undercover</Text>
          )}
          {/*
            Port of ant v2.1.143 4925.js / 4930.js — `/goal active`
            pill lives on the right side of the footer. ant gates the
            " · " separator on `o` (any other right-side content visible);
            we mirror that via useNotificationsVisible. Without the gate
            the separator dangles on its own. Renders null when no
            active goal.
          */}
          <GoalActiveIndicator withSeparator={notificationsVisible} />
          <BridgeStatusIndicator bridgeSelected={bridgeSelected} />
        </Box>
      </Box>
      {process.env.USER_TYPE === 'ant' && <CoordinatorTaskPanel />}
    </>
  )
}

export default memo(PromptInputFooter)

type BridgeStatusProps = {
  bridgeSelected: boolean
}

function BridgeStatusIndicator({
  bridgeSelected,
}: BridgeStatusProps): React.ReactNode {
  if (!feature('BRIDGE_MODE')) return null

  const enabled = useAppState(s => s.replBridgeEnabled)
  const connected = useAppState(s => s.replBridgeConnected)
  const sessionActive = useAppState(s => s.replBridgeSessionActive)
  const reconnecting = useAppState(s => s.replBridgeReconnecting)
  const explicit = useAppState(s => s.replBridgeExplicit)

  // Failed state is surfaced via notification (useReplBridge), not a footer pill.
  if (!isBridgeEnabled() || !enabled) return null

  const status = getBridgeStatus({
    error: undefined,
    connected,
    sessionActive,
    reconnecting,
  })

  // For implicit (config-driven) remote, only show the reconnecting state
  if (!explicit && status.label !== 'Remote Control reconnecting') {
    return null
  }

  return (
    <Text
      color={bridgeSelected ? 'background' : status.color}
      inverse={bridgeSelected}
      wrap="truncate"
    >
      {status.label}
      {bridgeSelected && <Text dimColor> · Enter to view</Text>}
    </Text>
  )
}
