/**
 * FleetView — top-level Ink screen for the `ccb agents` TUI dashboard.
 *
 * Source: ant 5092.js BdK (line 1657) + the xd chord cascade at 2767-3115.
 * This is a faithful port of ant's behaviour:
 *
 *   - One `useInput` owns ALL key events. The dispatch buffer is rendered
 *     manually (no TextInput child) so chords never get swallowed by a
 *     focused subcomponent.
 *   - Every chord wires to a real action: pin → pinFleetJob, kill → daemon
 *     kill, rename → file-state writer, reorder → setFleetSortOrder,
 *     reply → daemon reply, dispatch → daemon spawn.
 *   - `/exit` `/quit` `q` `exit` `quit` aliases → onQuit (ant 5092.js:2962).
 *   - 2-step Ctrl+C confirms exit (ant `yH` flow).
 *   - 2-step Ctrl+X arms-then-kills (ant `$P('x', job)`).
 *   - Ctrl+R starts inline rename on the focused job.
 *   - Shift+Up/Down reorders within the bucket.
 *   - `/tui fullscreen` honoured by mountFleetView wrapping in <AlternateScreen>.
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput, useSelection, useTerminalSize } from '@anthropic/ink'

import { type Command, getCommands, getCommandName } from '@claude-code/command-runtime/runtime'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import {
  getAgentDefinitionsWithOverrides,
  getActiveAgentsFromList,
  type AgentDefinition,
} from '@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  useCopyOnSelect,
  useSelectionBgColor,
} from '../../hooks/useCopyOnSelect.js'
import {
  generateCommandSuggestions,
  isCommandInput,
} from '../../suggestions/commandSuggestions.js'
import PromptInputFooterSuggestions from '../../components/PromptInput/PromptInputFooterSuggestions.js'
import type { SuggestionItem } from '../../components/PromptInput/PromptInputFooterSuggestions.js'
import figures from 'figures'

import { renderModelSetting } from '@claude-code/provider/model.js'
import type {
  FleetJob,
  FleetPrCache,
} from '@claude-code/agent/background/fleet/fleetTypes.js'

import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { getLogoDisplayData } from '../../uiHelpers/logoV2Utils.js'
import { Clawd } from '../../components/LogoV2/Clawd.js'

import { FleetBanner } from './components/FleetBanner.js'
import { FleetFooter, type FleetFooterSelectionKind } from './components/FleetFooter.js'
import { FleetJobRow } from './components/FleetJobRow.js'
import { FleetSectionHeader } from './components/FleetSectionHeader.js'
import { HelpOverlay } from './components/HelpOverlay.js'
import { PeekPanel } from './components/PeekPanel.js'
import { VoiceAudioMeter } from './components/VoiceAudioMeter.js'
import { useVoiceState } from '@claude-code/voice/voiceContext.js'
import {
  VoiceIndicator,
  VoiceWarmupHint,
} from '../../components/PromptInput/VoiceIndicator.js'

import { formatJobAge } from './helpers/elapsed.js'
import { deriveBand } from './helpers/deriveBand.js'
import { deriveChildSummaries } from './helpers/deriveChildSummaries.js'

import { useFleetActions } from './hooks/useFleetActions.js'
import { useFleetPolling } from './hooks/useFleetPolling.js'
import {
  type FleetGroupMode,
  type FleetRow,
  useFleetRows,
} from './hooks/useFleetRows.js'

export interface FleetViewProps {
  /** Current foreground session id (drives "current session" labelling). */
  currentSessionId: string
  /** Optional seed jobs to render before first poll completes. */
  seedJobs?: readonly FleetJob[]
  /** Called on /exit /quit / Ctrl+C confirm. */
  onQuit?: () => void
  /** Called when user presses Enter on a focused job row. */
  onAttach?: (short: string) => void
  /** PR cache passed through from caller. */
  prCache?: FleetPrCache
  /** Called when user submits a non-command task in the dispatch box. */
  onDispatch?: (prompt: string) => void
  /**
   * Initial focused job short — passed by the agentsFleet loop on
   * remount after an attach so the user lands back on the row they
   * just detached from, not the default "Working" header.
   * Source: ant 5092.js Ot3 `z = f.job.id` carried across iterations.
   */
  initialFocusedShort?: string
}

const EXIT_ALIASES = new Set(['/exit', '/quit', 'q', 'exit', 'quit'])

const QUIT_CONFIRM_TIMEOUT_MS = 2000
const DELETE_ARM_TIMEOUT_MS = 2000

interface RenameState {
  id: string
  draft: string
}

/** Top-level FleetView. Source: ant BdK + xd. */
export function FleetView(props: FleetViewProps): React.ReactNode {
  const {
    currentSessionId,
    seedJobs,
    onQuit,
    onAttach,
    prCache,
    onDispatch,
    initialFocusedShort,
  } = props

  const terminalWidth = useTerminalSize().columns

  // Banner data — self-resolved from ccb state (ant 5092.js:3210-3215).
  const model = useMainLoopModel()
  const modelLabel = renderModelSetting(model)
  const { version, cwd: cwdLabel } = getLogoDisplayData()
  const versionLabel = `v${version}`

  const { jobs, presence, refresh: refreshJobs } = useFleetPolling(seedJobs)
  const actions = useFleetActions({ currentSessionId })

  // Copy-on-select wiring. Source: ant 5092.js FleetView body —
  //   let yw = BzH()              // useSelection
  //   JZ6(yw, true, ...)          // useCopyOnSelect with toast on copy
  //   DZ6(yw)                     // useSelectionBgColor
  //
  // Without these, mouse drag-selection in FleetView builds the selection
  // overlay (via Ink's dispatchClick/handleSelectionDrag) but the drag-end
  // never writes to the clipboard — ccb's REPL wires the same hooks via
  // ScrollKeybindingHandler, but FleetView is a separate Ink root that
  // never mounted that handler. Silent copy here (no toast) matches the
  // useCopyOnSelect API's "onCopied omitted → silent" mode — FleetView's
  // own footer doesn't have a notification slot wired in yet.
  const selection = useSelection()
  useCopyOnSelect(selection, true)
  useSelectionBgColor(selection)

  // ── core UI state ──────────────────────────────────────────────────
  const [groupMode, setGroupMode] = useState<FleetGroupMode>('state')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [selectionIndex, setSelectionIndex] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [peekOpen, setPeekOpen] = useState(false)
  const [peekDraft, setPeekDraft] = useState('')
  const [peekCursor, setPeekCursor] = useState(0)
  const [armedDeleteId, setArmedDeleteId] = useState<string | undefined>(undefined)
  const [renameState, setRenameState] = useState<RenameState | undefined>(undefined)
  const [pendingQuitConfirm, setPendingQuitConfirm] = useState(false)
  const [errorToast, setErrorToast] = useState<string | undefined>(undefined)
  // Dispatch buffer (ant `j_.current`) — what the user is typing.
  const [dispatchBuf, setDispatchBuf] = useState('')
  // Cursor offset within the dispatch buffer (ant `U_` / `setU` in
  // 5092.js — passed as `cursorOffset` / `onCursorOffsetChange` to PN
  // SearchInput). Without this, typed text can only be appended at end
  // and backspace only deletes the last char.
  const [dispatchCursor, setDispatchCursor] = useState(0)

  // Clamp cursor whenever the buffer shrinks (programmatic clears, paste
  // truncation, etc.) so we never index past the end.
  useEffect(() => {
    setDispatchCursor(c => Math.min(c, dispatchBuf.length))
  }, [dispatchBuf.length])
  // Slash-command suggestion state. Source: ant 5092.js `Fs3()` result +
  // `j3`/`Rj` (selection index) — when the dispatch buffer starts with
  // `/`, popup lists matching skills/commands; Tab/Enter accepts the
  // currently highlighted entry.
  const [commands, setCommands] = useState<readonly Command[]>([])
  const [agents, setAgents] = useState<readonly AgentDefinition[]>([])
  const [worktreeRepos, setWorktreeRepos] = useState<Record<string, string>>({})
  const [suggestionIndex, setSuggestionIndex] = useState(0)

  // Load commands + agents + sibling worktree repos once on mount.
  // ant 5092.js Fs3 has three @-axis sources:
  //   _ = agents (active, non-built-in)            — ant `_.filter(WRH)`
  //   q = nested skill teammates                   — _$
  //   K = worktree repos {name: path}              — ant `LvK(parentDir)`
  // ccb wires (_) and (K). Nested skill teammates (q) require the swarm
  // hierarchy hook which FleetView doesn't have direct access to.
  useEffect(() => {
    let cancelled = false
    const cwd = getCwd()
    void getCommands(cwd)
      .then(list => {
        if (!cancelled) setCommands(list)
      })
      .catch(() => {})
    // Source: ant 4774.js RvK — getAgentDefinitionsWithOverrides + filter
    // out built-in / plugin agents (ant `WRH` = source !== "built-in" &&
    // source !== "plugin"). Built-in agents like general-purpose are
    // available everywhere, no point in @-mentioning them by name.
    void getAgentDefinitionsWithOverrides(cwd)
      .then(({ allAgents }) => {
        if (cancelled) return
        const active = getActiveAgentsFromList(allAgents)
        setAgents(
          active.filter(a => a.source !== 'built-in' && a.source !== 'plugin'),
        )
      })
      .catch(() => {})
    // Source: ant 4774.js LvK — scan parent dir for sibling dirs that
    // are git repos; returns {name: absolutePath}. Used as `@<reponame>`
    // suggestion targets in the dispatch buffer (selecting one sets the
    // cwd for the new bg session to that repo).
    void (async () => {
      try {
        const parent = dirname(cwd)
        const entries = await readdir(parent, { withFileTypes: true })
        const repos: Record<string, string> = {}
        await Promise.all(
          entries
            .filter(
              e =>
                (e.isDirectory() || e.isSymbolicLink()) &&
                !e.name.startsWith('.') &&
                !/\s/.test(e.name),
            )
            .map(async e => {
              const full = join(parent, e.name)
              try {
                await stat(join(full, '.git'))
                repos[e.name] = full
              } catch {
                /* not a git repo */
              }
            }),
        )
        if (!cancelled) setWorktreeRepos(repos)
      } catch {
        /* parent unreadable — leave empty */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Detect a trailing `@<token>` for agent mentions. Source: ant 5092.js
  // `Y = H.match(/(?:^|\s)@(\S*)$/)` — the popup activates whenever the
  // cursor is somewhere in or right after an @-token.
  const atMatch = useMemo(() => {
    const m = dispatchBuf.match(/(?:^|\s)@(\S*)$/)
    return m ? { token: m[1] ?? '', start: m.index! + m[0].length - (m[1] ?? '').length - 1 } : null
  }, [dispatchBuf])

  // Suggestion list. Source: ant 5092.js Fs3 result:
  //   - `Y` (@<token>) match  → agents/skills/repos filtered by token
  //   - `f` (/<token>) match  → slash commands filtered by token
  //   - empty buffer + flagged → recent agents
  //   - generic single-word    → all of the above prefix-matched
  // ccb's first cut implements the @<token> + /<token> branches.
  const suggestions = useMemo<SuggestionItem[]>(() => {
    if (atMatch !== null) {
      // ant 5092.js Fs3 @-branch:
      //   M = [
      //     ...XdK(_).filter(prefix).map(cn8),         // agents (recent-first)
      //     ...q.filter(prefix).sort(name),            // nested skills (omitted)
      //     ...D.filter(prefix).sort().map(repo),      // worktree repos
      //   ]
      // ccb does agents + repos. Don't double-list a repo whose name
      // collides with an agent name (ant: `let j = ... zi8(...) !== void 0`
      // then `j ? [] : D.filter(...)` — drops repos when an at-mention has
      // already resolved an agent in the buffer; simpler heuristic here is
      // to dedupe by name).
      const q = atMatch.token.toLowerCase()
      const agentItems = agents
        .filter(a => a.agentType.toLowerCase().startsWith(q))
        .sort((a, b) => a.agentType.localeCompare(b.agentType))
        .map<SuggestionItem>(a => ({
          id: `agent:${a.agentType}`,
          displayText: `@${a.agentType}`,
          description: a.whenToUse,
          metadata: { kind: 'agent', name: a.agentType },
        }))
      const agentNames = new Set(
        agentItems.map(i => i.displayText.slice(1).toLowerCase()),
      )
      const repoItems = Object.entries(worktreeRepos)
        .filter(
          ([name]) =>
            name.toLowerCase().startsWith(q) &&
            !agentNames.has(name.toLowerCase()),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map<SuggestionItem>(([name, path]) => ({
          id: `repo:${name}`,
          displayText: `@${name}`,
          description: path,
          metadata: { kind: 'repo', name, path },
        }))
      return [...agentItems, ...repoItems]
    }
    if (!isCommandInput(dispatchBuf)) return []
    return generateCommandSuggestions(dispatchBuf, commands as Command[])
  }, [dispatchBuf, commands, agents, worktreeRepos, atMatch])
  useEffect(() => {
    if (suggestions.length === 0) {
      if (suggestionIndex !== 0) setSuggestionIndex(0)
      return
    }
    if (suggestionIndex >= suggestions.length) {
      setSuggestionIndex(Math.max(0, suggestions.length - 1))
    }
  }, [suggestions.length, suggestionIndex])

  // Accept the currently highlighted suggestion. Source: ant 5092.js
  // `M8(vA[j3] ?? vA[0])` (Tab / Enter accept) where the suggestion is
  // inserted via `ps3(buf, sigil, name)` — replace the trailing
  // `/<token>` or `@<token>` with `<sigil><name> `. ant's M8:
  //   let Dq = l6.kind === "skill" ? "/" : "@"
  //   w_(kM||Fz ? ps3(bH, Dq, l6.name) : `${Dq}${l6.name} `)
  const acceptSuggestion = useCallback(() => {
    const pick = suggestions[suggestionIndex] ?? suggestions[0]
    if (!pick) return false
    const meta = pick.metadata as
      | { kind: 'agent' | 'skill' | 'repo'; name: string }
      | Command
      | undefined
    let sigil = '/'
    let name: string
    if (meta && typeof meta === 'object' && 'kind' in meta) {
      sigil = meta.kind === 'agent' || meta.kind === 'repo' ? '@' : '/'
      name = meta.name
    } else if (meta) {
      // Command metadata (slash command).
      sigil = '/'
      name = getCommandName(meta as Command)
    } else {
      // Fallback: parse sigil from displayText.
      sigil = pick.displayText.startsWith('@') ? '@' : '/'
      name = pick.displayText.replace(/^[/@]/, '')
    }
    setDispatchBuf(prev => prev.replace(/[@/]\S*$/, `${sigil}${name} `))
    setSuggestionIndex(0)
    return true
  }, [suggestions, suggestionIndex])

  // Auto-clear armed-delete after 2s — ant `mJ(() => oK(null), tq ? 2000 : null, [tq])`.
  useEffect(() => {
    if (armedDeleteId === undefined) return
    const t = setTimeout(() => setArmedDeleteId(undefined), DELETE_ARM_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [armedDeleteId])

  // Auto-clear quit confirm after 2s.
  useEffect(() => {
    if (!pendingQuitConfirm) return
    const t = setTimeout(() => setPendingQuitConfirm(false), QUIT_CONFIRM_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pendingQuitConfirm])

  // Auto-clear error toast after 4s.
  useEffect(() => {
    if (errorToast === undefined) return
    const t = setTimeout(() => setErrorToast(undefined), 4000)
    return () => clearTimeout(t)
  }, [errorToast])

  // The dispatch buffer is ONLY for composing a new task — it is NOT a
  // session filter (user explicitly confirmed). No row filtering by
  // typed text. Filter stays empty.
  const filterText = ''
  const { rows, bucketCounts, groupCounts } = useFleetRows({
    jobs,
    filterText,
    groupMode,
    presence,
    prCache,
    collapsedGroups,
    currentSessionId,
  })

  // After rows are computed, jump selection to the initialFocusedShort
  // row exactly once on mount. ant 5092.js Ot3 carries `z = f.job.id`
  // across loop iterations so the user lands back on the row they just
  // detached from; ccb's loop passes the value into props and this
  // effect resolves it to a concrete row index after the first poll.
  const initialFocusAppliedRef = useRef(false)
  useEffect(() => {
    if (initialFocusAppliedRef.current) return
    if (!initialFocusedShort) return
    if (rows.length === 0) return
    const idx = rows.findIndex(
      r => r.kind === 'job' && r.job.id === initialFocusedShort,
    )
    if (idx >= 0) {
      setSelectionIndex(idx)
      initialFocusAppliedRef.current = true
    }
  }, [rows, initialFocusedShort])

  const clampedIndex = rows.length === 0 ? 0 : Math.min(selectionIndex, rows.length - 1)
  const focused = rows[clampedIndex]
  const focusedJob = focused?.kind === 'job' ? focused.job : undefined

  const labelWidth = useMemo(() => 24, [])
  const ageWidth = useMemo(() => 6, [])

  // Banner band counts use uyH (deriveBand) — 3 buckets.
  const bandCounts = useMemo(() => {
    const counts = { blocked: 0, active: 0, completed: 0 }
    for (const job of jobs) {
      const band = deriveBand(job.state, presence.get(job.id))
      if (band === 'blocked') counts.blocked += 1
      else if (band === 'active') counts.active += 1
      else counts.completed += 1
    }
    return counts
  }, [jobs, presence])

  void bucketCounts
  void groupCounts

  // ── voice state ────────────────────────────────────────────────────
  const voiceState = useVoiceState(s => s.voiceState)
  const voiceWarmingUp = useVoiceState(s => s.voiceWarmingUp)
  const showVoiceWarmup = voiceWarmingUp
  const showVoiceIndicator = !voiceWarmingUp && voiceState !== 'idle'
  const showVoiceMeter = voiceState === 'recording'

  // ── action helpers ─────────────────────────────────────────────────
  const dispatchActive = !peekOpen && !helpOpen && renameState === undefined

  const handleQuit = useCallback((): void => {
    if (onQuit !== undefined) onQuit()
  }, [onQuit])

  /** Source: ant Id step-helper — skip past header rows when navigating. */
  const stepIndex = useCallback(
    (from: number, delta: number): number => {
      if (rows.length === 0) return 0
      let next = from + delta
      while (next >= 0 && next < rows.length && rows[next]?.kind === 'header' && delta !== 0) {
        next += delta
      }
      return Math.max(0, Math.min(rows.length - 1, next))
    },
    [rows],
  )

  const handleMove = useCallback(
    (delta: number): void => {
      setSelectionIndex(prev => stepIndex(prev, delta))
    },
    [stepIndex],
  )

  /** Source: ant wx — shift+up/down reorder. */
  const handleReorder = useCallback(
    (delta: -1 | 1): void => {
      if (focusedJob === undefined) return
      // Find the next job (skip headers/folds) and swap sortOrders.
      let neighborIdx = clampedIndex + delta
      while (neighborIdx >= 0 && neighborIdx < rows.length && rows[neighborIdx]?.kind !== 'job') {
        neighborIdx += delta
      }
      const neighbor = rows[neighborIdx]
      if (neighbor?.kind !== 'job') return
      // Optimistic: bump the focused job to the neighbor's sort position.
      const target = neighbor.job.state.sortOrder ?? Date.parse(neighbor.job.state.createdAt)
      void actions.reorder(focusedJob.id, target + (delta < 0 ? -1 : 1)).then(r => {
        if (r.ok === false) setErrorToast(`Reorder failed: ${r.error}`)
        else refreshJobs()
      })
      setSelectionIndex(neighborIdx)
    },
    [focusedJob, clampedIndex, rows, actions],
  )

  const handleSpacePeek = useCallback((): void => {
    if (focused?.kind !== 'job') return
    setPeekOpen(true)
  }, [focused])

  /**
   * Ctrl+X handler. Source: ant $P (5092.js:2613-2641) +
   * Gs3 action table (5092.js:290-376).
   *
   *   1st press on active/blocked → 'stop' (daemon kill + state.json
   *                                  marked stopped) AND arm delete.
   *   2nd press on same job        → 'delete' (rm -rf job dir).
   *   1st press on completed/stopped → 'delete' immediately
   *                                  (skip the arm step).
   */
  const handleArmDelete = useCallback((): void => {
    if (focusedJob === undefined) return
    const band = deriveBand(focusedJob.state, presence.get(focusedJob.id))

    // Path 1: already armed for THIS row → run delete.
    if (armedDeleteId === focusedJob.id) {
      void actions.remove(focusedJob.id).then(r => {
        if (r.ok === false) setErrorToast(`Delete failed: ${r.error}`)
        else refreshJobs()
      })
      setArmedDeleteId(undefined)
      return
    }

    // Path 2: row is completed/stopped → delete immediately (no arm step).
    if (band === 'completed') {
      void actions.remove(focusedJob.id).then(r => {
        if (r.ok === false) setErrorToast(`Delete failed: ${r.error}`)
        else refreshJobs()
      })
      return
    }

    // Path 3: row is active/blocked → stop the worker + arm delete.
    void actions.stop(focusedJob.id).then(r => {
      if (r.ok === false) setErrorToast(`Stop failed: ${r.error}`)
      else refreshJobs()
    })
    setArmedDeleteId(focusedJob.id)
  }, [focusedJob, armedDeleteId, presence, actions, refreshJobs])

  const handleTogglePin = useCallback((): void => {
    if (focusedJob === undefined) return
    const next = focusedJob.state.pinned !== true
    void actions.togglePin(focusedJob.id, next).then(r => {
      if (r.ok === false) setErrorToast(`${next ? 'Pin' : 'Unpin'} failed: ${r.error}`)
      else refreshJobs()
    })
  }, [focusedJob, actions])

  const handleToggleGroupMode = useCallback((): void => {
    setGroupMode(prev => (prev === 'state' ? 'directory' : 'state'))
  }, [])

  const handleStartRename = useCallback((): void => {
    if (focusedJob === undefined) return
    setRenameState({ id: focusedJob.id, draft: focusedJob.state.name ?? '' })
  }, [focusedJob])

  const handleCancelRename = useCallback((): void => {
    setRenameState(undefined)
  }, [])

  const handleCommitRename = useCallback((): void => {
    if (renameState === undefined) return
    const job = jobs.find(j => j.id === renameState.id)
    if (job !== undefined) {
      void actions.rename(job.state.sessionId, renameState.draft.trim()).then(r => {
        if (r.ok === false) setErrorToast(`Rename failed: ${r.error}`)
        else refreshJobs()
      })
    }
    setRenameState(undefined)
  }, [renameState, jobs, actions])

  const handleToggleCollapse = useCallback((group: string): void => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }, [])

  const handleExpandFold = useCallback((group: string): void => {
    setCollapsedGroups(prev => {
      if (!prev.has(group)) return prev
      const next = new Set(prev)
      next.delete(group)
      return next
    })
  }, [])

  const handleSubmitDispatch = useCallback((): void => {
    const text = dispatchBuf.trim()
    setDispatchBuf('')
    if (text === '') {
      // No buffer text — "open / expand" based on focus.
      if (focused?.kind === 'header') {
        handleToggleCollapse(focused.group)
        return
      }
      if (focused?.kind === 'fold') {
        handleExpandFold(focused.group)
        return
      }
      if (focused?.kind === 'job') {
        onAttach?.(focused.job.id)
        return
      }
      return
    }
    onDispatch?.(text)
    // Kick a refresh on the next tick so the optimistic state.json
    // written by spawnBgPty surfaces immediately, not on the 1s poll.
    // Mirrors ant's `Wj((LJ) => [...LJ, b3])` (5092.js:3070-3082).
    setTimeout(() => refreshJobs(), 50)
  }, [dispatchBuf, focused, handleToggleCollapse, handleExpandFold, onAttach, onDispatch, refreshJobs])

  const handlePeekSubmit = useCallback(
    (text: string): void => {
      if (focusedJob !== undefined) {
        void actions.reply(focusedJob.id, text).then(r => {
          if (r.ok === false) setErrorToast(`Reply failed: ${r.error}`)
        })
      }
      setPeekOpen(false)
      setPeekDraft('')
      setPeekCursor(0)
    },
    [focusedJob, actions],
  )

  const handlePeekClose = useCallback((): void => {
    setPeekOpen(false)
    setPeekDraft('')
    setPeekCursor(0)
  }, [])

  // ── key router (ant xd at 5092.js:2767-3115) ────────────────────────
  useInput((input, key) => {
    // Renaming intercepts everything.
    if (renameState !== undefined) {
      if (key.ctrl && input === 'c') {
        handleCancelRename()
        return
      }
      if (key.return) {
        handleCommitRename()
        return
      }
      if (key.escape) {
        handleCancelRename()
        return
      }
      if (key.backspace || key.delete) {
        setRenameState(s => (s ? { ...s, draft: s.draft.slice(0, -1) } : s))
        return
      }
      if (input !== '' && !key.ctrl && !key.meta) {
        setRenameState(s => (s ? { ...s, draft: s.draft + input } : s))
      }
      return
    }

    // PeekPanel handles its own input via its TextInput child.
    if (peekOpen) {
      if (key.escape || (key.ctrl && input === 'c')) handlePeekClose()
      return
    }

    // Ctrl+C — 2-step confirm.
    if (key.ctrl && input === 'c') {
      if (helpOpen) {
        setHelpOpen(false)
        return
      }
      if (dispatchBuf !== '') {
        setDispatchBuf('')
        return
      }
      if (pendingQuitConfirm) {
        handleQuit()
        return
      }
      setPendingQuitConfirm(true)
      return
    }

    // Escape — cascade close.
    if (key.escape) {
      if (helpOpen) {
        setHelpOpen(false)
        return
      }
      // ant 5092.js: closing the suggestion popup is a step before
      // clearing the buffer (`if (vA.length > 0) { Kz(false); return }`
      // analogue — ccb's popup auto-clears when buffer no longer
      // matches, so simply clearing the buffer collapses both).
      if (dispatchBuf !== '') {
        setDispatchBuf('')
        return
      }
      if (armedDeleteId !== undefined) {
        setArmedDeleteId(undefined)
        return
      }
      handleQuit()
      return
    }

    // Tab — accept the highlighted slash suggestion. ant 5092.js:
    //   if (W_.key === "tab") { if (vA.length > 0) M8(vA[j3] ?? vA[0]) }
    if (key.tab) {
      if (suggestions.length > 0 && acceptSuggestion()) return
    }

    // Most keys close the help overlay (mirrors ant 2803-2810).
    if (
      helpOpen &&
      input !== '?' &&
      !key.upArrow &&
      !key.downArrow &&
      !(key.ctrl && (input === 'p' || input === 'n'))
    ) {
      setHelpOpen(false)
    }

    // Shift+Up / Shift+Down — reorder.
    if (key.shift && (key.upArrow || key.downArrow)) {
      handleReorder(key.upArrow ? -1 : 1)
      return
    }

    // Ctrl+R — rename.
    if (key.ctrl && input === 'r') {
      handleStartRename()
      return
    }

    // Ctrl+S — toggle group mode.
    if (key.ctrl && input === 's') {
      handleToggleGroupMode()
      return
    }

    // Ctrl+T — pin/unpin.
    if (key.ctrl && input === 't') {
      handleTogglePin()
      return
    }

    // Up / Ctrl+P — navigate suggestion popup when visible, else row up.
    // Source: ant 5092.js `if (W_.key === "up" ...) { if (vA.length > 0)
    //   { Rj((l6) => Math.max(0, l6 - 1)); return } }` — popup
    // intercepts arrow keys before they reach the list nav.
    if (key.upArrow || (key.ctrl && input === 'p')) {
      if (suggestions.length > 0) {
        setSuggestionIndex(i => Math.max(0, i - 1))
        return
      }
      handleMove(-1)
      return
    }

    // Down / Ctrl+N — navigate suggestion popup when visible, else row down.
    if (key.downArrow || (key.ctrl && input === 'n')) {
      if (suggestions.length > 0) {
        setSuggestionIndex(i => Math.min(suggestions.length - 1, i + 1))
        return
      }
      handleMove(1)
      return
    }

    // Left arrow — when dispatch buffer non-empty, move cursor within it.
    // ant 4205.js PN consumes left/right inside the input naturally;
    // ccb's InlineDispatchBuffer doesn't, so we route through here.
    if (key.leftArrow && dispatchBuf !== '') {
      setDispatchCursor(c => Math.max(0, c - 1))
      return
    }

    // Right arrow on a job row — open/attach. Source: ant 2941-2944.
    if (key.rightArrow && dispatchBuf === '' && focused?.kind === 'job') {
      onAttach?.(focused.job.id)
      return
    }

    // Right arrow — when dispatch buffer non-empty, move cursor right.
    if (key.rightArrow && dispatchBuf !== '') {
      setDispatchCursor(c => Math.min(dispatchBuf.length, c + 1))
      return
    }

    // Alt/Cmd + 1-9 — quick-open the Nth job row. Source: ant 5092.js
    //   if ((W_.meta||W_.superKey) && W_.key >= "1" && W_.key <= "9") {
    //     let l6 = Number(W_.key);
    //     let Dq = cH.find(K9 => K9.kind === "job" && K9.origin === TP && --l6 === 0);
    //     if (Dq?.kind === "job") US(Dq.job);
    //   }
    // ccb skips the origin filter (cross-cwd attach is rare here) and
    // just picks the Nth job in display order.
    if (key.meta && input >= '1' && input <= '9') {
      const n = Number(input)
      let i = 0
      for (const row of rows) {
        if (row.kind !== 'job') continue
        if (++i === n) {
          onAttach?.(row.job.id)
          return
        }
      }
      return
    }

    // Return — /exit/quit aliases, accept suggestion, dispatch, or open.
    if (key.return) {
      const trimmed = dispatchBuf.trim().toLowerCase()
      if (EXIT_ALIASES.has(trimmed)) {
        setDispatchBuf('')
        handleQuit()
        return
      }
      // ant 5092.js `if (vA.length > 0) { M8(vA[j3] ?? vA[0]); Kz(false); return }`
      // — Enter with the suggestion popup open accepts the highlight
      // and DOES NOT submit. User has to press Enter again on the
      // expanded `/<command> ` buffer to actually run it.
      if (suggestions.length > 0 && acceptSuggestion()) return
      handleSubmitDispatch()
      return
    }

    // Ctrl+X — armed delete.
    if (key.ctrl && input === 'x') {
      handleArmDelete()
      return
    }

    // ? — toggle help (only when buffer empty).
    if (input === '?' && dispatchBuf === '') {
      setHelpOpen(prev => !prev)
      return
    }

    // Space — peek (only when buffer empty AND focused job).
    if (input === ' ' && dispatchBuf === '' && focused?.kind === 'job') {
      handleSpacePeek()
      return
    }

    // Backspace — delete char before cursor (or last char when cursor
    // is at end). Source: ant 4205.js PN useTextInput.backspace.
    if (key.backspace || key.delete) {
      setDispatchBuf(prev => {
        if (prev === '') return prev
        const c = Math.min(dispatchCursor, prev.length)
        if (c === 0) return prev
        const next = prev.slice(0, c - 1) + prev.slice(c)
        setDispatchCursor(c - 1)
        return next
      })
      return
    }

    // Free typing — insert chars at cursor.
    if (input !== '' && !key.ctrl && !key.meta) {
      setDispatchBuf(prev => {
        const c = Math.min(dispatchCursor, prev.length)
        const next = prev.slice(0, c) + input + prev.slice(c)
        setDispatchCursor(c + input.length)
        return next
      })
    }
  })

  // ── derived UI state ───────────────────────────────────────────────
  const selectionKind: FleetFooterSelectionKind =
    focused === undefined
      ? 'none'
      : focused.kind === 'job'
        ? 'job'
        : focused.kind === 'header'
          ? 'header'
          : 'fold'

  const isHeaderCollapsed =
    focused?.kind === 'header' ? collapsedGroups.has(focused.group) : false

  const hasDeletableJobs = useMemo(
    () => jobs.some(j => j.state.tempo === 'idle' || j.state.state === 'failed'),
    [jobs],
  )

  const hasAnyJobRow = useMemo(() => rows.some(r => r.kind === 'job'), [rows])
  const showEmptyHint = !hasAnyJobRow && filterText === ''
  const showNoMatchHint = !hasAnyJobRow && filterText !== ''
  // ant 5092.js: `wk = O$.some(W_ => W_.id === _)` — true when the
  // current session id matches one of the listed jobs (i.e., we're
  // viewing the fleet from inside an existing session). When true the
  // empty-state hint becomes "Press → to return to your session
  // anytime". Falls back to the generic "Type a task below to start a
  // background session." text when the current session isn't in view.
  const currentSessionInRows = useMemo(
    () =>
      currentSessionId !== '' &&
      rows.some(r => r.kind === 'job' && r.job.id === currentSessionId),
    [rows, currentSessionId],
  )

  // ── render ─────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box gap={2} marginBottom={1}>
        {terminalWidth >= 70 ? <Clawd /> : null}
        <FleetBanner
          versionLabel={versionLabel}
          modelLabel={modelLabel}
          cwdLabel={cwdLabel}
          bandCounts={bandCounts}
        />
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column">
          {rows.map((row, idx) => (
            <Row
              key={rowKey(row, idx)}
              row={row}
              focused={idx === clampedIndex}
              currentSessionId={currentSessionId}
              armedDeleteId={armedDeleteId}
              terminalWidth={terminalWidth}
              labelWidth={labelWidth}
              ageWidth={ageWidth}
              collapsed={row.kind === 'header' && collapsedGroups.has(row.group)}
              renameState={renameState}
              prCache={prCache}
              onMouseEnter={() => setSelectionIndex(idx)}
              onClick={() => {
                setSelectionIndex(idx)
                if (row.kind === 'job') {
                  onAttach?.(row.job.id)
                } else if (row.kind === 'header') {
                  handleToggleCollapse(row.group)
                } else if (row.kind === 'fold') {
                  handleExpandFold(row.group)
                }
              }}
            />
          ))}
        </Box>
        {showEmptyHint ? (
          <Box paddingLeft={2} marginTop={1} flexDirection="column" gap={1}>
            <Text dimColor>
              {currentSessionInRows
                ? 'Press → to return to your session anytime. Type a task below to dispatch a session alongside it. Sessions keep running even after you close the terminal.'
                : 'Type a task below to start a background session. It keeps running even after you close this terminal.'}
            </Text>
            <Text dimColor>
              Try: paste a PR or issue URL · "investigate why test/auth.test.ts is flaky" · "address the review comments on #1234"
            </Text>
          </Box>
        ) : null}
        {showNoMatchHint ? (
          <Box paddingLeft={2} marginTop={1}>
            <Text dimColor>no sessions match</Text>
          </Box>
        ) : null}
      </Box>
      {/* Slash-command suggestion popup. Source: ant 5092.js
          `ZB = vA.length>0 ? <B paddingLeft=2 marginBottom=1><SZH .../></B> : null`
          — ABOVE the input box (just before the border), so the
          highlight scans visually upward from the user's `/<token>` and
          the list grows up into the row area instead of pushing the
          footer down. */}
      {suggestions.length > 0 ? (
        <Box paddingLeft={2} marginBottom={1}>
          <PromptInputFooterSuggestions
            suggestions={suggestions}
            selectedSuggestion={suggestionIndex}
            maxColumnWidth={35}
          />
        </Box>
      ) : null}
      {/* Dispatch input. Source: ant PN at 5092.js:3395-3419. */}
      <Box
        flexShrink={0}
        flexDirection="row"
        marginTop={1}
        borderStyle="round"
        borderLeft={false}
        borderRight={false}
        borderDimColor
      >
        <Box flexShrink={0} paddingRight={1}>
          <Text dimColor={!dispatchActive}>{figures.pointer}</Text>
        </Box>
        <Box flexGrow={1}>
          <InlineDispatchBuffer
            buffer={dispatchBuf}
            placeholder="start a task in the background"
            focused={dispatchActive}
            cursor={dispatchCursor}
          />
        </Box>
      </Box>
      {showVoiceWarmup || showVoiceIndicator || showVoiceMeter ? (
        <Box marginTop={1} flexDirection="row">
          {showVoiceWarmup ? <VoiceWarmupHint /> : null}
          {showVoiceIndicator ? <VoiceIndicator voiceState={voiceState} /> : null}
          {showVoiceMeter ? (
            <>
              <Box width={1} />
              <VoiceAudioMeter />
            </>
          ) : null}
        </Box>
      ) : null}
      {peekOpen && focusedJob !== undefined ? (
        <Box marginTop={1}>
          <PeekPanel
            job={focusedJob}
            value={peekDraft}
            onValueChange={setPeekDraft}
            cursorOffset={peekCursor}
            onCursorChange={setPeekCursor}
            onSubmit={handlePeekSubmit}
            onClose={handlePeekClose}
            columns={terminalWidth}
          />
        </Box>
      ) : null}
      {helpOpen ? (
        <Box marginTop={1}>
          <HelpOverlay
            focusedPinned={focusedJob?.state.pinned === true}
            canReorder={focused?.kind === 'job'}
            canRename={focused?.kind === 'job'}
            canPin={focused?.kind === 'job'}
            canMention={false}
            altOpenCount={0}
          />
        </Box>
      ) : null}
      {/* Status line. Priority: quit-confirm > error > footer chord cascade. */}
      {pendingQuitConfirm ? (
        <Box flexShrink={0} paddingLeft={2} height={1}>
          <Text dimColor>Press Ctrl-C again to exit</Text>
        </Box>
      ) : errorToast !== undefined ? (
        <Box flexShrink={0} paddingLeft={2} height={1}>
          <Text color="error" wrap="truncate-end">{errorToast}</Text>
        </Box>
      ) : (
        <FleetFooter
          terminalWidth={terminalWidth}
          selectionKind={peekOpen ? 'job' : selectionKind}
          filterText={filterText}
          isCurrentSession={focusedJob?.state.sessionId === currentSessionId}
          isRenaming={renameState !== undefined}
          isTransitional={false}
          isHeaderCollapsed={isHeaderCollapsed}
          jobEnterAction={peekOpen ? 'close' : 'open'}
          hasDeletableJobs={hasDeletableJobs}
          isArmedToDelete={armedDeleteId !== undefined}
          isGrouped={groupMode === 'directory'}
        />
      )}
    </Box>
  )
}

/**
 * Hand-rolled dispatch buffer renderer — keeps focus invariant simple.
 *
 * Source: ant 4205.js PN (SearchInput) default cursor rendering — when
 * `cursorChar` is undefined, ant renders the first placeholder character
 * (or character at cursor position) wrapped in `<V inverse>` for a
 * STEADY inverse-block cursor. NO blink interval.
 *
 * ccb previously had a `setInterval(setBlink, 500)` here that flashed
 * the cursor every half-second. ant doesn't blink — terminals already
 * blink the native cursor based on user preference, and the inverse
 * block is a render-time visual marker that should stay solid.
 */
function InlineDispatchBuffer({
  buffer,
  placeholder,
  focused,
  cursor,
}: {
  buffer: string
  placeholder: string
  focused: boolean
  /** Cursor offset within `buffer` (0..buffer.length). */
  cursor: number
}): React.ReactNode {
  const showCursor = focused
  if (buffer === '') {
    // Empty buffer + focused: render placeholder with first char as
    // inverse cursor (ant 4205.js PN line: `<V inverse>{P.charAt(0)}</V>`).
    if (showCursor && placeholder.length > 0) {
      return (
        <Box>
          <Text inverse>{placeholder.charAt(0)}</Text>
          <Text dimColor>{placeholder.slice(1)}</Text>
        </Box>
      )
    }
    return (
      <Box>
        <Text dimColor>{placeholder}</Text>
      </Box>
    )
  }
  // Non-empty + focused: split around the cursor offset so the inverse
  // block sits at the correct character. Source: ant cursor.ts render:
  //   beforeCursor + invert(charAtCursor) + afterCursor
  // Cursor at end → trailing inverse space.
  if (!showCursor) {
    return (
      <Box>
        <Text>{buffer}</Text>
      </Box>
    )
  }
  const c = Math.min(Math.max(0, cursor), buffer.length)
  const before = buffer.slice(0, c)
  const atCursor = buffer[c] ?? ' '
  const after = c < buffer.length ? buffer.slice(c + 1) : ''
  return (
    <Box>
      <Text>{before}</Text>
      <Text inverse>{atCursor}</Text>
      <Text>{after}</Text>
    </Box>
  )
}

function rowKey(row: FleetRow, idx: number): string {
  if (row.kind === 'header') return `h:${row.group}`
  if (row.kind === 'fold') return `f:${row.group}`
  return `j:${row.job.id}:${idx}`
}

interface RowProps {
  row: FleetRow
  focused: boolean
  currentSessionId: string
  armedDeleteId: string | undefined
  terminalWidth: number
  labelWidth: number
  ageWidth: number
  collapsed: boolean
  renameState: RenameState | undefined
  prCache: FleetPrCache | undefined
  onMouseEnter: () => void
  onClick: () => void
}

function Row({
  row,
  focused,
  currentSessionId,
  armedDeleteId,
  terminalWidth,
  labelWidth,
  ageWidth,
  collapsed,
  renameState,
  prCache,
  onMouseEnter,
  onClick,
}: RowProps): React.ReactNode {
  if (row.kind === 'header') {
    return (
      <Box onMouseEnter={onMouseEnter} onClick={onClick}>
        <FleetSectionHeader
          label={row.label}
          rowCount={row.rowCount}
          collapsed={collapsed}
          focused={focused}
          width={terminalWidth}
        />
      </Box>
    )
  }
  if (row.kind === 'fold') {
    return (
      <Box paddingLeft={2} onMouseEnter={onMouseEnter} onClick={onClick}>
        <FleetSectionHeader
          label={`… ${row.hidden} more`}
          rowCount={row.hidden}
          collapsed={false}
          focused={focused}
          width={terminalWidth}
        />
      </Box>
    )
  }
  const isCurrent = row.job.state.sessionId === currentSessionId
  const renaming =
    renameState !== undefined && renameState.id === row.job.id
      ? { draft: renameState.draft, cursor: renameState.draft.length }
      : undefined
  // Source: ant 5092.js `GBK(B9.state.children, M)` — map per-row
  // children + PR cache into FleetJobRow's ChildRollup display data.
  const childSummaries = deriveChildSummaries(row.job.state.children, prCache)
  return (
    <Box onMouseEnter={onMouseEnter} onClick={onClick}>
      <FleetJobRow
        state={row.job.state}
        activity={row.activity}
        presence={undefined}
        isCurrentSession={isCurrent}
        focused={focused}
        attaching={false}
        deleteArmed={armedDeleteId === row.job.id ? { justKilled: false } : undefined}
        renaming={renaming}
        childSummaries={childSummaries}
        age={formatJobAge(row.job)}
        labelWidth={labelWidth}
        ageWidth={ageWidth}
      />
    </Box>
  )
}
