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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, instances, useInput, useSelection, useTerminalSize } from '@anthropic/ink'
import { fileURLToPath } from 'node:url'
import { openBrowser, openPath } from '@claude-code/storage/browser.js'

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

import { getGlobalConfig, saveGlobalConfig } from '@claude-code/config'
import { renderModelSetting } from '@claude-code/provider/model.js'
import type {
  FleetJob,
  FleetPrCache,
  FleetPresence,
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
import { jobLabel } from './helpers/jobLabel.js'
import { stringWidth } from './helpers/grapheme.js'
import { AGENT_COLORS } from '@claude-code/tool-registry/tools/AgentTool/agentColorManager.js'
import { deriveBand } from './helpers/deriveBand.js'
import { spawnOrigin as spawnOriginOf } from './helpers/repoGroup.js'
import { deriveChildSummaries } from './helpers/deriveChildSummaries.js'
import { needsRespawn } from './helpers/needsRespawn.js'

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
  /**
   * Called when user submits a non-command task in the dispatch box.
   * Includes optional cwd override (from `@<repo>` mention) and agent
   * name (from `@<agent>` mention). Source: ant on8 parser (5092.js)
   * returns `{ template, intent, cwd, routine }` which the dispatcher
   * passes to spawnBgPty as agent flag + cwd.
   */
  onDispatch?: (info: {
    intent: string
    cwd?: string
    agent?: string
    /**
     * Pre-allocated short id from FleetView. Source: ant 5092.js
     *   R1 = A7 ? AP.sessionId : PdK.randomUUID()
     *   r4 = R1.slice(0, 8)
     *   B_.current = r4
     *   Wj(LJ => [...LJ, {id: r4, ...}])
     *   ... spawn uses r4 ...
     *
     * FleetView generates r4 and passes it down so the optimistic row
     * id, follow-id, and the spawned worker's id all agree. Without
     * this the row's tempId never resolves to a real attach target.
     */
    short: string
  }) => void
  /**
   * Sync probe for the spare pool's current slot. ant uses `Cg8()` —
   * `let AP = Cg8()` is read synchronously in the dispatch path so r4
   * can be set to AP.sessionId when a spare matches. ccb's spare pool
   * lives in @claude-code/cli; FleetView gets it through this callback
   * provided by the agentsFleet handler. Returns undefined when no
   * spare is currently ready or cwd doesn't match.
   */
  peekSpare?: (cwd: string) => { short: string; sessionId?: string } | undefined
  /**
   * Initial focused job short — passed by the agentsFleet loop on
   * remount after an attach so the user lands back on the row they
   * just detached from, not the default "Working" header.
   * Source: ant 5092.js Ot3 `z = f.job.id` carried across iterations.
   */
  initialFocusedShort?: string
  /**
   * Error message carried over from the previous iteration's attach
   * attempt (e.g., daemon timeout, ENOJOB). Surfaces as a 4s toast
   * on mount so the user sees why the attach didn't land them in
   * a session. Source: ant 5092.js Ot3 `initialError: J` prop.
   */
  initialError?: string
}

// Source: ant 4668.js `bX6 = ["exit", "quit", ":q", ":q!", ":wq", ":wq!"]`
// — vim-style quit aliases honored alongside the `/exit /quit` slash
// commands so muscle-memory works. ccb adds the slash variants since
// they're how the user explicitly invokes the slash-command.
/**
 * Recency tracker for the agents drawer + @-mention popup.
 *
 * Source: ant 5092.js Fs3 `XdK` recency sort + bootstrap+dispatch writes:
 *   - XdK reads `v_().agentLastUsed ?? {}` and sorts agents by descending
 *     ms-since-epoch (ties broken by name).
 *   - Bootstrap scan (ant 5092.js Ot3 useEffect): on FleetView mount,
 *     scans existing jobs and seeds `agentLastUsed[template] =
 *     Date.parse(createdAt)` for any template not already present. Skips
 *     the default "claude" template (a1H.name).
 *   - Dispatch write: 60-second debounce — only writes if the previous
 *     timestamp is older than 60 000 ms (or absent).
 *
 * Persisted in GlobalConfig.agentLastUsed so muscle-memory survives
 * across `ccb agents` invocations and process restarts.
 */
const AGENT_LAST_USED_DEBOUNCE_MS = 60_000

function readAgentLastUsed(): Record<string, number> {
  try {
    return getGlobalConfig().agentLastUsed ?? {}
  } catch {
    return {}
  }
}

function markAgentUsed(name: string): void {
  // 60s debounce mirrors ant 5092.js: avoids one config write per Enter
  // when the user dispatches the same agent in quick succession.
  saveGlobalConfig(current => {
    const map = current.agentLastUsed ?? {}
    const prev = map[name]
    const now = Date.now()
    if (prev !== undefined && now - prev < AGENT_LAST_USED_DEBOUNCE_MS) {
      return current
    }
    return { ...current, agentLastUsed: { ...map, [name]: now } }
  })
}

/**
 * Bootstrap-scan existing jobs to seed entries we don't have yet.
 * Source: ant 5092.js `if(K9.state.template===a1H.name)continue` —
 * skips the default agent (so the drawer doesn't always have "claude"
 * pinned to the top just because the user opened FleetView once).
 */
function seedAgentLastUsedFromJobs(
  jobs: readonly { state: { template?: string; createdAt?: string } }[],
  defaultAgentType: string,
): void {
  if (jobs.length === 0) return
  saveGlobalConfig(current => {
    const map = current.agentLastUsed ?? {}
    let changed = false
    const next = { ...map }
    for (const j of jobs) {
      const tmpl = j.state.template
      const created = j.state.createdAt
      if (tmpl === undefined || tmpl === defaultAgentType) continue
      if (map[tmpl] !== undefined) continue
      if (created === undefined) continue
      const ts = Date.parse(created)
      if (Number.isNaN(ts)) continue
      if (ts > (next[tmpl] ?? 0)) {
        next[tmpl] = ts
        changed = true
      }
    }
    if (!changed) return current
    return { ...current, agentLastUsed: next }
  })
}

function sortByRecency(
  agents: readonly AgentDefinition[],
): readonly AgentDefinition[] {
  const map = readAgentLastUsed()
  return [...agents].sort((a, b) => {
    const ta = map[a.agentType] ?? 0
    const tb = map[b.agentType] ?? 0
    if (ta !== tb) return tb - ta
    return a.agentType.localeCompare(b.agentType)
  })
}

const EXIT_ALIASES = new Set([
  '/exit',
  '/quit',
  'exit',
  'quit',
  'q',
  ':q',
  ':q!',
  ':wq',
  ':wq!',
])

const QUIT_CONFIRM_TIMEOUT_MS = 2000
const DELETE_ARM_TIMEOUT_MS = 2000

interface RenameState {
  id: string
  draft: string
  /** Cursor offset within `draft` — mirrors ant `zT` (5092.js gs3 renaming). */
  cursor: number
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
    peekSpare,
    initialFocusedShort,
    initialError,
  } = props

  const terminalSize = useTerminalSize()
  const terminalWidth = terminalSize.columns
  const terminalRows = terminalSize.rows
  // ant `M_` — groups where the user clicked "… N more" to expand.
  // Once expanded, the done-fold logic skips this group.
  const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  // Banner data — self-resolved from ccb state (ant 5092.js:3210-3215).
  const model = useMainLoopModel()
  // Source: ant 5092.js `Dx = FU(A?.model ?? C7())`. ant's `A.model` is
  // the saved SETTING (alias like "opus") not the resolved canonical name
  // — its r7 only appends "[1m]" when the input string explicitly has
  // it. ccb's useMainLoopModel runs parseUserSpecifiedModel which can
  // re-append "[1m]" from defaults (Max + 1m merge), so the banner ended
  // up reading "Opus 4.7 (1M context)" even when the user never picked
  // the 1m variant. Strip the trailing " (1M context)" suffix at the
  // banner level so the compact head reads "Opus 4.7" — matches ant.
  // The actual mainLoopModel still carries [1m] for the API.
  const modelLabel = renderModelSetting(model).replace(/ \(1M context\)$/, '')
  const { version, cwd: cwdLabel } = getLogoDisplayData()
  const versionLabel = `v${version}`

  const { jobs: polledJobs, presence, refresh: refreshJobs } = useFleetPolling(seedJobs)
  // Optimistic in-flight rows (ant `S7` / Wj). On dispatch, push a row
  // with the user's intent immediately so the user sees feedback the
  // moment they press Enter — no polling lag. Once the polled jobs
  // include this id, the merge filter drops the in-flight entry.
  //
  // Source: ant 5092.js BdK:
  //   let [S7, Wj] = n8.useState([])
  //   ...
  //   let bN = S7.filter(W_ => !J3.some(B6 => B6.id === W_.id))
  //   let aK = bN.length > 0 ? XR_([...bN, ...J3]) : J3
  //   ...
  //   useEffect(() => {  // cleanup when polled catches up
  //     if (S7.length === 0 || !w) return
  //     let matched = S7.filter(M8 => w.some(l6 => l6.id === M8.id))
  //     if (matched.length === 0) return
  //     ...for each matched, mark sessionId in cf (clear-cache),
  //     ...Wj(set => set.filter(l6 => !matched.has(l6.id))),
  //   }, [S7, w])
  const [inflightJobs, setInflightJobs] = useState<readonly FleetJob[]>([])
  // Merge inflight + polled. Source: ant 5092.js verbatim:
  //   let bN = S7.filter(W_ => !J3.some(B6 => B6.id === W_.id))
  //   let aK = bN.length > 0 ? XR_([...bN, ...J3]) : J3
  //
  // ccb pre-allocates the short for the inflight row (FleetView's
  // pushOptimistic peeks the spare pool / generates a UUID slice and
  // passes the same short to onDispatch), so id-based dedup works
  // directly — same semantic as ant.
  const jobs = useMemo(() => {
    if (inflightJobs.length === 0) return polledJobs
    const polledIds = new Set(polledJobs.map(j => j.id))
    const pending = inflightJobs.filter(j => !polledIds.has(j.id))
    if (pending.length === 0) return polledJobs
    return [...pending, ...polledJobs]
  }, [polledJobs, inflightJobs])
  // ant Effect 17: drop inflight entries once polling picks them up.
  useEffect(() => {
    if (inflightJobs.length === 0) return
    const polledIds = new Set(polledJobs.map(j => j.id))
    if (inflightJobs.every(j => !polledIds.has(j.id))) return
    setInflightJobs(prev => prev.filter(j => !polledIds.has(j.id)))
  }, [polledJobs, inflightJobs])
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
  // Surface a toast on copy. ant 5085.js jZ6: `copied N chars to
  // clipboard` (or via tmux-buffer / OSC 52 hint depending on transport).
  // Simpler form here — show "copied" briefly so the user knows the
  // clipboard write went through.
  useCopyOnSelect(selection, true, text => {
    const n = text.length
    setErrorToast(`copied ${n} ${n === 1 ? 'char' : 'chars'} to clipboard`)
  })
  useSelectionBgColor(selection)

  // ── core UI state ──────────────────────────────────────────────────
  // Source: ant 5092.js `O_.current` seeded from `v_().fleetViewGroupMode`.
  // Defaults to 'state' (the more informative grouping) when never set.
  const [groupMode, setGroupMode] = useState<FleetGroupMode>(() => {
    try {
      const v = getGlobalConfig().fleetViewGroupMode
      return v === 'directory' ? 'directory' : 'state'
    } catch {
      return 'state'
    }
  })
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [selectionIndex, setSelectionIndex] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [peekOpen, setPeekOpen] = useState(false)
  const [peekDraft, setPeekDraft] = useState('')
  const [peekCursor, setPeekCursor] = useState(0)
  // Armed-delete payload. Source: ant `i1.current = {id, justKilled, group, sortKey}`.
  // justKilled=true when the first ctrl+x ALSO fired "stop" — drives the
  // "stopped · ctrl+x again to delete" warning text on active/blocked
  // rows. For completed rows justKilled=false → "ctrl+x again to delete".
  const [armedDelete, setArmedDelete] = useState<
    { id: string; justKilled: boolean } | undefined
  >(undefined)
  const armedDeleteId = armedDelete?.id
  const [renameState, setRenameState] = useState<RenameState | undefined>(undefined)
  const [pendingQuitConfirm, setPendingQuitConfirm] = useState(false)
  const [errorToast, setErrorToast] = useState<string | undefined>(initialError)
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

  // Close the agents drawer the moment the user starts typing. ant
  // 5092.js does this implicitly because the drawer only renders when
  // `($ && !H)` — typing makes H non-empty so the drawer-mode branch
  // in Fs3 stops returning agents.
  useEffect(() => {
    if (dispatchBuf !== '') setShowAgentsDrawer(false)
  }, [dispatchBuf])
  // Slash-command suggestion state. Source: ant 5092.js `Fs3()` result +
  // `j3`/`Rj` (selection index) — when the dispatch buffer starts with
  // `/`, popup lists matching skills/commands; Tab/Enter accepts the
  // currently highlighted entry.
  const [commands, setCommands] = useState<readonly Command[]>([])
  const [agents, setAgents] = useState<readonly AgentDefinition[]>([])
  const [worktreeRepos, setWorktreeRepos] = useState<Record<string, string>>({})
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  // Toggle for the "show all agents" drawer — ant 5092.js `qz`/`Kz`.
  // Pressing Tab on an empty dispatch buffer when agents are available
  // toggles this on, populating the suggestion popup with every agent
  // (sorted by recency). Pressing Tab again or typing closes it.
  const [showAgentsDrawer, setShowAgentsDrawer] = useState(false)
  // Short of the row currently being attached to. ant 5092.js
  // `rH = K_.current = W_.id` is set before kZ6 respawn fires, used
  // to render the row spinner as "opening…". ccb's loop unmount makes
  // this hard to observe in practice (the row component is gone the
  // moment onAttach resolves), but the value is set on the click side
  // so any pre-unmount frame surfaces the indicator.
  const [attachingShort, setAttachingShort] = useState<string | null>(null)

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
    // Empty buffer + drawer toggled on → show ALL agents (ant 5092.js
    // `($ && !H) ? XdK(_).map(cn8)` — drawer mode is the `$` flag,
    // which becomes truthy when Tab toggles `Kz` on an empty buffer).
    // `XdK` is the recency sort — agents the user dispatched recently
    // bubble to the top.
    if (showAgentsDrawer && dispatchBuf === '' && agents.length > 0) {
      return sortByRecency(agents).map<SuggestionItem>(a => ({
        id: `agent:${a.agentType}`,
        displayText: `@${a.agentType}`,
        description: `background · ${a.whenToUse}`,
        metadata: { kind: 'agent', name: a.agentType },
      }))
    }
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
      // Suggestion description format. Source: ant 5093.js `Bs3` →
      // `description: ${Bs3[kind]} · ${origDesc}` — kind prefix like
      // `background · "Investigate why test/auth..."`. Bs3:
      //   agent  → "background"
      //   repo   → "repo"
      //   skill  → "skill"
      //   routine→ "routine"
      // Recency sort BEFORE prefix filter so the most-recently-used
      // matching agent floats to the top. Source: ant 5092.js Fs3:
      //   ...XdK(_).filter(G => G.name.toLowerCase().startsWith(w)).map(cn8)
      // XdK sorts by agentLastUsed (descending), then name. ccb's
      // sortByRecency reads getGlobalConfig().agentLastUsed.
      const agentItems = sortByRecency(agents)
        .filter(a => a.agentType.toLowerCase().startsWith(q))
        .map<SuggestionItem>(a => ({
          id: `agent:${a.agentType}`,
          displayText: `@${a.agentType}`,
          description: `background · ${a.whenToUse}`,
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
          description: `repo · ${path}`,
          metadata: { kind: 'repo', name, path },
        }))
      return [...agentItems, ...repoItems]
    }
    if (!isCommandInput(dispatchBuf)) return []
    // Source: ant 5092.js Fs3 — `f = H.match(/(?:^|\s)\/(\S*)$/)`. The
    // regex anchor requires the slash token to extend to END of input
    // (no trailing whitespace). Once the user accepts a command, the
    // buffer becomes `/help ` (trailing space) and ant's f === null →
    // suggestions empty. ccb's generateCommandSuggestions only filters
    // on hasCommandArgs (which returns FALSE for trailing-space) so it
    // kept returning suggestions and the next Enter just re-accepted
    // the same command instead of submitting — "回車選中的 command
    // 都發不出去" symptom. Match ant's anchor here.
    if (/\s$/.test(dispatchBuf)) return []
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
    // Replace the trailing `/<token>` or `@<token>` with `<sigil><name> `.
    // Source: ant 5092.js ps3(buf, sigil, name) — same regex.
    // CRITICAL: also move the cursor to end of buffer so subsequent
    // keystrokes (typing args, pressing Enter to submit) land where the
    // user expects. ccb previously left dispatchCursor at the position
    // before accept, so typing extended the OLD `/`-position content
    // instead of appending after the inserted command — "不讓輸入"
    // symptom the user reported.
    setDispatchBuf(prev => {
      const next = prev.replace(/[@/]\S*$/, `${sigil}${name} `)
      setDispatchCursor(next.length)
      return next
    })
    setSuggestionIndex(0)
    return true
  }, [suggestions, suggestionIndex])

  // Auto-clear armed-delete after 2s — ant `mJ(() => oK(null), tq ? 2000 : null, [tq])`.
  useEffect(() => {
    if (armedDeleteId === undefined) return
    const t = setTimeout(() => setArmedDelete(undefined), DELETE_ARM_TIMEOUT_MS)
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
    expandedFolds,
    terminalRows,
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
      followIdRef.current = initialFocusedShort
      initialFocusAppliedRef.current = true
    }
  }, [rows, initialFocusedShort])

  // ant 5092.js follow-id mechanism (refs `B_`/`l_` + Effect 16 in BdK).
  // On every render, if `B_.current` is set, locate its row in `cH` and
  // jump `selectionIndex` to it. This is how dispatch focuses the new
  // row: dispatch sets `B_.current = r4` (the new short), the next
  // render runs this layout effect which finds the row (just inserted
  // into the inflight set or polled) and moves selection there.
  //
  //   useLayoutEffect(() => {
  //     if (l_.current) { jump to header; return }
  //     if (!B_.current) return
  //     let W_ = B8(B_.current)
  //     if (W_ < 0) { B_.current = null; return }
  //     if (W_ !== o) s(W_)
  //   })  // ← no deps array, runs every render
  const followIdRef = useRef<string | undefined>(undefined)
  const followGroupRef = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (rows.length === 0) return
    // Header follow first — when set, find header by group label.
    if (followGroupRef.current !== undefined) {
      const idx = rows.findIndex(
        r => r.kind === 'header' && r.group === followGroupRef.current,
      )
      if (idx >= 0 && idx !== selectionIndex) setSelectionIndex(idx)
      if (idx < 0) followGroupRef.current = undefined
      return
    }
    if (followIdRef.current === undefined) return
    const idx = rows.findIndex(
      r => r.kind === 'job' && r.job.id === followIdRef.current,
    )
    if (idx < 0) {
      // Row no longer exists (deleted / never appeared) — give up.
      followIdRef.current = undefined
      return
    }
    if (idx !== selectionIndex) setSelectionIndex(idx)
  })

  // Hyperlink click handler. Source: ant 5092.js Ot3 useLayoutEffect[]:
  //   let W_=P5.get(process.stdout); if(!W_)return;
  //   return W_.onHyperlinkClick=(B6)=>{
  //     if(B6.startsWith("file:"))try{TjH(NZ6.fileURLToPath(B6))}catch{}
  //     else K4(B6)  // K4 = open URL in browser
  //   },()=>{W_.onHyperlinkClick=void 0}
  // ccb's PeekPanel + FleetJobRow PR rows emit OSC 8 hyperlinks for PR
  // URLs; mouse-tracking captures clicks before the terminal can open
  // them natively, so we have to route them through Ink's hook.
  useLayoutEffect(() => {
    const ink = instances.get(process.stdout)
    if (!ink) return
    ink.onHyperlinkClick = url => {
      if (url.startsWith('file:')) {
        try {
          void openPath(fileURLToPath(url))
        } catch {
          // Malformed file: URLs — ignore silently.
        }
      } else {
        void openBrowser(url)
      }
    }
    return () => {
      ink.onHyperlinkClick = undefined
    }
  }, [])

  // Bootstrap-scan agentLastUsed from existing job createdAt timestamps.
  // Runs once after the first poll completes. Source: ant 5092.js Ot3
  // useEffect[] that calls H7H() (listFleetJobs) and seeds entries for
  // any non-default template not already in the map. Ensures the agents
  // drawer's recency sort is meaningful on first open even if the user
  // hasn't dispatched anything yet in this `ccb agents` invocation.
  const agentSeedAppliedRef = useRef(false)
  useEffect(() => {
    if (agentSeedAppliedRef.current) return
    if (jobs.length === 0) return
    agentSeedAppliedRef.current = true
    // Skip 'bg' — the default template (listFleetJobs.ts:31 fallback),
    // mirroring ant's `a1H.name` skip. Otherwise the recency map would
    // always have "bg" pinned to the top just because the user opened
    // FleetView once with the default agent.
    seedAgentLastUsedFromJobs(jobs, 'bg')
  }, [jobs])

  const clampedIndex = rows.length === 0 ? 0 : Math.min(selectionIndex, rows.length - 1)
  const focused = rows[clampedIndex]
  const focusedJob = focused?.kind === 'job' ? focused.job : undefined
  // Source: ant gs3 receives `q.activity` + `K` (presence) for Ti8.
  // Pull both from the focused row so PeekPanel's age coloring picks
  // the same color the row uses.
  const focusedActivity =
    focused?.kind === 'job' ? focused.activity : undefined
  const focusedPresence =
    focused?.kind === 'job'
      ? (presence.get(focused.job.id) ??
        (focused.job.state.tempo === 'active' ? 'busy' : 'waiting'))
      : undefined

  // Dynamic column widths. Source: ant fs3 (5092.js:1300-1310) +
  // ws3=3 (min age) + Js3=2 (prefix offset) + label min=12, max=40.
  //
  //   age   = max(ws3, ...jobs.map(j => width(formatJobAge(j))))
  //   label = clamp(12..40, max(...jobs.map(j => width(jobLabel(j))
  //                                + (hasColorBadge(j) ? 2 : 0))))
  //
  // hasColorBadge: state.color is set to a known agent color. The +2
  // is the chip's extra render width (one space + colored dot).
  const { labelWidth, ageWidth } = useMemo(() => {
    const AGE_MIN = 3
    const LABEL_MIN = 12
    const LABEL_MAX = 40
    let age = AGE_MIN
    let label = LABEL_MIN
    const colorSet = new Set<string>(AGENT_COLORS as readonly string[])
    for (const job of jobs) {
      const isCurrent = job.id === currentSessionId
      const w = stringWidth(jobLabel(job.state, isCurrent))
      const badgeExtra =
        job.state.color !== undefined && colorSet.has(job.state.color) ? 2 : 0
      label = Math.max(label, w + badgeExtra)
      age = Math.max(age, stringWidth(formatJobAge(job)))
    }
    return { labelWidth: Math.min(LABEL_MAX, label), ageWidth: age }
  }, [jobs, currentSessionId])

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

  /**
   * Step the selection index by `delta`, wrapping around at the
   * boundaries and skipping rows that aren't currently navigable.
   *
   * Source: ant 5092.js `Id`:
   *   let Id = (W_, B6) => {
   *     let M8 = cH.length
   *     if (M8 === 0) return 0
   *     let l6 = peekOpen ? K9 => K9?.kind !== "job" : null
   *     let Dq = (W_ + B6 + M8) % M8   // MODULO wraps
   *     if (l6) while (Dq !== W_ && l6(cH[Dq])) Dq = (Dq + B6 + M8) % M8
   *     return Dq
   *   }
   *
   * Two behaviour bumps over ccb's previous clamp-only:
   *   - Wraps top↔bottom (modulo) — Up at row 0 lands at the last row
   *   - When peek is open, skips non-job rows (peek operates on jobs)
   */
  const stepIndex = useCallback(
    (from: number, delta: number): number => {
      const n = rows.length
      if (n === 0) return 0
      // Wrap with proper modulo (negative-safe).
      const wrap = (i: number): number => ((i % n) + n) % n
      let next = wrap(from + delta)
      const shouldSkip = peekOpen
        ? (r: FleetRow | undefined) => r?.kind !== 'job'
        : null
      if (shouldSkip) {
        let guard = 0
        while (next !== from && shouldSkip(rows[next]) && guard++ < n) {
          next = wrap(next + delta)
        }
      }
      return next
    },
    [rows, peekOpen],
  )

  const handleMove = useCallback(
    (delta: number): void => {
      // Source: ant 5092.js up/down handler. After moving selection,
      // ant updates B_.current / l_.current to MATCH the new row so
      // the per-render follow-id layout effect doesn't drag focus back:
      //   s(l6 => {
      //     let Dq = Id(l6, -1), K9 = cH[Dq]
      //     if (K9?.kind === "job")    B_.current = K9.job.id; l_.current = null
      //     else if (K9?.kind === "header") B_.current = null; l_.current = K9.group
      //     else                        B_.current = null; l_.current = null
      //     return Dq
      //   })
      setSelectionIndex(prev => {
        const next = stepIndex(prev, delta)
        const row = rows[next]
        if (row?.kind === 'job') {
          followIdRef.current = row.job.id
          followGroupRef.current = undefined
        } else if (row?.kind === 'header') {
          followIdRef.current = undefined
          followGroupRef.current = row.group
        } else {
          followIdRef.current = undefined
          followGroupRef.current = undefined
        }
        return next
      })
    },
    [rows, stepIndex],
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
   * Ctrl+X handler. Source: ant `$P` (5092.js:2613-2641) verbatim:
   *
   *   if (W === "x" && !M && i1.current?.id !== B.id) {
   *     // FIRST PRESS (or pressing on a different row than armed):
   *     // arm THIS row AND run "stop" (which is a no-op for already
   *     // terminal rows but moves active/blocked to completed).
   *     let stopAction = u1.find(a => a.label === "stop")
   *     oK(B.id, Dq.label === "stop", group, sortKey)  // arm
   *     if (stopAction) Promise.resolve(stopAction.run(B)).catch(...)
   *     return
   *   }
   *   // SECOND PRESS on SAME row (or delete-all mode M=true):
   *   oK(null)  // unarm
   *   let act = u1.find(a => a.label === "delete") ?? Dq
   *   Promise.resolve(act.run(B))
   *
   * So the flow is identical across all bands:
   *   1st press → ARM + (stop side-effect for active/blocked; no-op for completed)
   *   2nd press on SAME row → DELETE
   *
   * Previous ccb port had a Path 2 that DELETED completed rows on the
   * first press — that diverged from ant. Now: every state arms first.
   */
  const handleArmDelete = useCallback((): void => {
    // Header-focus "delete all" path. Source: ant 5092.js ctrl+x branch:
    //   if (!y5 && S4?.kind === "header" && qh.length > 0) {
    //     if (i1.current?.id !== S4.group) { oK(S4.group); return }  // arm group
    //     oK(null)
    //     for (let l6 of qh) if (!S7.some(j => j.id === l6.id)) $P("x", l6, true)
    //   }
    // Where qh is the deletable rows in the focused header's group. The
    // group's "arm" reuses the same armedDelete state — just keyed by
    // group label instead of a job id.
    if (focused?.kind === 'header') {
      const group = focused.group
      const groupRows = jobs.filter(j => {
        const band = deriveBand(j.state, presence.get(j.id))
        if (group === 'done') return band === 'completed'
        if (group === 'working') return band === 'active'
        if (group === 'blocked') return band === 'blocked'
        if (group === 'review') return false
        return false
      })
      if (groupRows.length === 0) return
      // Second press on same group → delete all.
      if (armedDeleteId === group) {
        for (const row of groupRows) {
          void actions.remove(row.id).catch(() => undefined)
        }
        setArmedDelete(undefined)
        setTimeout(() => refreshJobs(), 100)
        return
      }
      // First press → arm the group.
      setArmedDelete({ id: group, justKilled: false })
      return
    }

    if (focusedJob === undefined) return

    // Second press on the SAME armed row → real delete. `actions.remove`
    // already does best-effort daemonKill before deleteJobDir, so the
    // worker is stopped AND removed atomically — no need for a separate
    // stop step on first press.
    if (armedDeleteId === focusedJob.id) {
      void actions.remove(focusedJob.id).then(r => {
        if (r.ok === false) setErrorToast(`Delete failed: ${r.error}`)
        else refreshJobs()
      })
      setArmedDelete(undefined)
      return
    }

    // First press: arm the row. WARN ONLY — do NOT optimistically move
    // active/blocked rows to completed via a side-effect stop. User
    // wants "any stage, two presses, delete" without the row jumping
    // buckets between presses. The remove action on the SECOND press
    // handles the worker kill on its own (daemonKill then deleteJobDir).
    setArmedDelete({ id: focusedJob.id, justKilled: false })
  }, [focused, focusedJob, jobs, armedDeleteId, presence, actions, refreshJobs])

  const handleTogglePin = useCallback((): void => {
    if (focusedJob === undefined) return
    const next = focusedJob.state.pinned !== true
    void actions.togglePin(focusedJob.id, next).then(r => {
      if (r.ok === false) setErrorToast(`${next ? 'Pin' : 'Unpin'} failed: ${r.error}`)
      else refreshJobs()
    })
  }, [focusedJob, actions])

  const handleToggleGroupMode = useCallback((): void => {
    setGroupMode(prev => {
      const next: FleetGroupMode = prev === 'state' ? 'directory' : 'state'
      // Persist to GlobalConfig. Source: ant 5092.js `a_(M8 =>
      //   M8.fleetViewGroupMode === l6 ? M8 : {...M8, fleetViewGroupMode: l6})`.
      saveGlobalConfig(current =>
        current.fleetViewGroupMode === next
          ? current
          : { ...current, fleetViewGroupMode: next },
      )
      return next
    })
  }, [])

  const handleStartRename = useCallback((): void => {
    if (focusedJob === undefined) return
    const initialDraft = focusedJob.state.name ?? ''
    setRenameState({
      id: focusedJob.id,
      draft: initialDraft,
      cursor: initialDraft.length,
    })
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
    // Source: ant 5092.js fold-row click handler:
    //   J_(W_ => new Set(W_).add(group))
    // where J_ is `setExpandedFolds`. Adds the group to the "user
    // wants to see all of this bucket" set; useFleetRows then skips
    // the done-fold clamp for that group. NOT related to collapsedGroups.
    setExpandedFolds(prev => {
      if (prev.has(group)) return prev
      const next = new Set(prev)
      next.add(group)
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
        setAttachingShort(focused.job.id)
        onAttach?.(focused.job.id)
        return
      }
      return
    }

    // Parse @-mentions out of the buffer. Source: ant 5092.js on8:
    //   - Walks each /(?:^|\s)@(\S+)/ match
    //   - First @<name> matching an active agent → set template, strip
    //   - First @<name> matching a worktree repo → set cwd, strip
    //   - First @<name> matching a nested skill → set routine, strip
    //   - Unmatched @-tokens stay in the buffer
    //   - Then leading word may itself be an agent name (without @)
    let cwd: string | undefined
    let agent: string | undefined
    const agentMap = new Map(agents.map(a => [a.agentType.toLowerCase(), a]))
    const repoMap = new Map(
      Object.entries(worktreeRepos).map(([n, p]) => [n.toLowerCase(), p]),
    )
    const stripped = text
      .replace(/(?:^|\s)@(\S+)/g, (match, token) => {
        const t = token.toLowerCase()
        const a = agentMap.get(t)
        if (a) {
          if (agent === undefined) agent = a.agentType
          return ''
        }
        const r = repoMap.get(t)
        if (r) {
          if (cwd === undefined) cwd = r
          return ''
        }
        return match
      })
      .trim()
    // Bare leading word may name an agent. ant: "let J = ... ; let D = $
    // ? undefined : _.find(M => M.name.toLowerCase() === J)".
    // Optimistic row builder — ant 5092.js verbatim:
    //   R1 = A7 ? AP.sessionId : PdK.randomUUID()
    //   r4 = R1.slice(0, 8)
    //   B_.current = r4
    //   b3 = {id: r4, state: _7H({sessionId: R1, ...}), activity: "flowing"}
    //   Wj(LJ => [...LJ, b3])
    //   ... spawn uses r4 ...
    //
    // r4 is the SAME id used for: optimistic row, follow id, AND the
    // spawned worker. Right-arrow attach to the optimistic row hits
    // the same on-disk job dir the worker writes to. No tempId / real
    // id swap needed.
    //
    // ccb: peek the spare pool synchronously (same as ant's Cg8()) and
    // use the spare's short if it matches cwd. Otherwise allocate a
    // fresh UUID slice. Pass r4 to the handler so spawnBgPty uses it.
    const pushOptimistic = (intent: string, dispatchAgent?: string): string => {
      const targetCwd = cwd ?? getCwd()
      const isPlainDispatch =
        dispatchAgent === undefined || dispatchAgent === 'claude'
      let resolvedShort: string | undefined
      let resolvedSessionId: string | undefined
      if (isPlainDispatch && peekSpare !== undefined) {
        const slot = peekSpare(targetCwd)
        if (slot !== undefined) {
          resolvedShort = slot.short
          resolvedSessionId = slot.sessionId
        }
      }
      if (resolvedShort === undefined) {
        // ant: PdK.randomUUID() then slice(0,8). ccb: same shape — 8
        // lowercase hex chars from crypto.randomUUID().
        const uuid =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(16).slice(2, 18)
        resolvedShort = uuid.replace(/-/g, '').slice(0, 8)
        resolvedSessionId = uuid
      }
      const now = new Date().toISOString()
      const label = intent.split(/\r?\n/)[0]!.slice(0, 60).trim() || 'session'
      const optimisticRow: FleetJob = {
        id: resolvedShort,
        activity: 'flowing',
        state: {
          state: 'working',
          tempo: 'active',
          detail: label,
          output: null,
          children: null,
          linkScanOffset: 0,
          template: dispatchAgent ?? 'bg',
          respawnFlags: dispatchAgent ? ['--agent', dispatchAgent] : [],
          intent,
          name: label,
          nameSource: 'auto',
          initialPrompt: intent,
          sessionId: resolvedSessionId ?? resolvedShort,
          resumeSessionId: resolvedSessionId ?? resolvedShort,
          daemonShort: resolvedShort,
          cwd: targetCwd,
          originCwd: targetCwd,
          createdAt: now,
          updatedAt: now,
          firstTerminalAt: null,
          backend: 'daemon',
        },
      }
      setInflightJobs(prev => [...prev, optimisticRow])
      followIdRef.current = resolvedShort
      followGroupRef.current = undefined
      // Safety net: drop after 5s if polling never catches up. ant's
      // failure path (dW callback) removes from S7 immediately on
      // spawn failure; ccb's spare claim / cold spawn doesn't surface
      // failures back to FleetView synchronously, so we rely on
      // the timer plus the dedup useEffect.
      setTimeout(() => {
        setInflightJobs(prev => prev.filter(j => j.id !== resolvedShort))
        if (followIdRef.current === resolvedShort) {
          followIdRef.current = undefined
        }
      }, 5000)
      return resolvedShort
    }

    if (agent === undefined) {
      const space = stripped.search(/\s/)
      const firstWord = (space < 0 ? stripped : stripped.slice(0, space)).toLowerCase()
      const a = agentMap.get(firstWord)
      if (a) {
        agent = a.agentType
        const rest = space < 0 ? '' : stripped.slice(space + 1).trim()
        markAgentUsed(agent)
        const short = pushOptimistic(rest, agent)
        onDispatch?.({ intent: rest, cwd, agent, short })
        setTimeout(() => refreshJobs(), 50)
        return
      }
    }
    if (agent !== undefined) markAgentUsed(agent)
    const short = pushOptimistic(stripped, agent)
    onDispatch?.({ intent: stripped, cwd, agent, short })
    setTimeout(() => refreshJobs(), 50)
  }, [dispatchBuf, focused, handleToggleCollapse, handleExpandFold, onAttach, onDispatch, peekSpare, refreshJobs, agents, worktreeRepos])

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
      if (key.leftArrow) {
        setRenameState(s => (s ? { ...s, cursor: Math.max(0, s.cursor - 1) } : s))
        return
      }
      if (key.rightArrow) {
        setRenameState(s =>
          s ? { ...s, cursor: Math.min(s.draft.length, s.cursor + 1) } : s,
        )
        return
      }
      if (key.ctrl && input === 'a') {
        setRenameState(s => (s ? { ...s, cursor: 0 } : s))
        return
      }
      if (key.ctrl && input === 'e') {
        setRenameState(s => (s ? { ...s, cursor: s.draft.length } : s))
        return
      }
      if (key.backspace || key.delete) {
        setRenameState(s => {
          if (!s) return s
          if (s.cursor === 0) return s
          return {
            ...s,
            draft: s.draft.slice(0, s.cursor - 1) + s.draft.slice(s.cursor),
            cursor: s.cursor - 1,
          }
        })
        return
      }
      if (input !== '' && !key.ctrl && !key.meta) {
        setRenameState(s => {
          if (!s) return s
          return {
            ...s,
            draft: s.draft.slice(0, s.cursor) + input + s.draft.slice(s.cursor),
            cursor: s.cursor + input.length,
          }
        })
      }
      return
    }

    // PeekPanel handles its own input via its TextInput child.
    if (peekOpen) {
      if (key.escape || (key.ctrl && input === 'c')) {
        handlePeekClose()
        return
      }
      // ant 5092.js xd peek branch:
      //   if (_H && W_.ctrl && W_.key === "x") $P("x", E9)
      // Ctrl+X armed-delete works inside peek too — fires `handleArmDelete`
      // against the currently-peeked job. Skip when peek is owned by a job
      // already in transition (delete during in-flight reply would race).
      if (key.ctrl && input === 'x' && focusedJob !== undefined) {
        handleArmDelete()
        return
      }
      return
    }

    // Ctrl+C — Source: ant 5092.js xd:
    //   if (zH || $H) { jH(!1), fH(!1); return }   // close help/other
    //   if (j_.current) w_("")                      // clear buffer
    //   yH()                                        // 2-step quit (ME doublePress)
    //   return
    // KEY DETAIL: when buffer is non-empty, ant CLEARS the buffer AND
    // still calls yH() in the same keystroke — so the user sees "press
    // ctrl+c again to quit" message right away. ccb previously returned
    // early after clearing, requiring a SECOND ctrl+c to even start the
    // confirm flow.
    if (key.ctrl && input === 'c') {
      if (helpOpen) {
        setHelpOpen(false)
        return
      }
      if (dispatchBuf !== '') setDispatchBuf('')
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
      // ant 5092.js Esc cascade:
      //   _H → close peek (handled above)
      //   zH → close help (handled above)
      //   $H → close other dialog
      //   qz → close suggestion drawer (Kz(false))
      //   j_.current → clear buffer
      //   i1.current → clear armed delete
      //   else → DH() quit
      if (showAgentsDrawer) {
        setShowAgentsDrawer(false)
        return
      }
      if (dispatchBuf !== '') {
        setDispatchBuf('')
        return
      }
      if (armedDeleteId !== undefined) {
        setArmedDelete(undefined)
        return
      }
      handleQuit()
      return
    }

    // Tab — accept the highlighted suggestion, OR (when buffer is
    // empty + agents available + no suggestions yet) toggle the
    // "show all agents" drawer. Source: ant 5092.js xd:
    //   if (key === "tab") {
    //     if (!j_.current && I3.length > 0) Kz(l6 => !l6)
    //     else if (vA.length > 0) M8(vA[j3] ?? vA[0])
    //   }
    if (key.tab) {
      if (suggestions.length > 0 && acceptSuggestion()) return
      if (dispatchBuf === '' && agents.length > 0) {
        setShowAgentsDrawer(prev => !prev)
        return
      }
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
    // Source: ant 5092.js up branch:
    //
    //   if (W_.key === "up" || W_.ctrl && W_.key === "p") {
    //     if (vA.length > 0) { Rj(i => max(0, i-1)); return }
    //     if (W_.key === "up" && !_H && j_.current.includes("\n")) {
    //       e_(W_); return    // ← multi-line buffer: pass to text input
    //     }
    //     scroll row index up
    //   }
    //
    // The multi-line check lets users navigate within a multi-line
    // dispatch buffer (composed via \\<Enter> or meta+Enter) without
    // accidentally jumping rows.
    if (key.upArrow || (key.ctrl && input === 'p')) {
      if (suggestions.length > 0) {
        setSuggestionIndex(i => Math.max(0, i - 1))
        return
      }
      if (key.upArrow && dispatchBuf.includes('\n')) {
        // Multi-line buffer: move cursor up by one visual line.
        setDispatchCursor(c => {
          const before = dispatchBuf.slice(0, c)
          const lastNl = before.lastIndexOf('\n')
          if (lastNl < 0) return c // already on first line
          const lineStart = before.slice(0, lastNl).lastIndexOf('\n') + 1
          const col = c - lastNl - 1
          return Math.min(lastNl, lineStart + col)
        })
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
      if (key.downArrow && dispatchBuf.includes('\n')) {
        // Multi-line buffer: move cursor down by one visual line.
        setDispatchCursor(c => {
          const after = dispatchBuf.slice(c)
          const nextNl = after.indexOf('\n')
          if (nextNl < 0) return c // already on last line
          const lineStart = dispatchBuf.slice(0, c).lastIndexOf('\n') + 1
          const col = c - lineStart
          const downStart = c + nextNl + 1
          const lineEndIdx = dispatchBuf.indexOf('\n', downStart)
          const downEnd = lineEndIdx < 0 ? dispatchBuf.length : lineEndIdx
          return Math.min(downEnd, downStart + col)
        })
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

    // Ctrl+A / Home — jump cursor to start of buffer.
    // Source: ant useTextInput.ts readline-style emacs keys.
    if (
      dispatchBuf !== '' &&
      ((key.ctrl && input === 'a') || (key as unknown as { home?: boolean }).home)
    ) {
      setDispatchCursor(0)
      return
    }

    // Ctrl+E / End — jump cursor to end of buffer.
    if (
      dispatchBuf !== '' &&
      ((key.ctrl && input === 'e') || (key as unknown as { end?: boolean }).end)
    ) {
      setDispatchCursor(dispatchBuf.length)
      return
    }

    // Ctrl+U — kill from cursor to start of buffer (readline kill-line-backward).
    // Source: ant useTextInput.ts → tt7 "deleteToLineStart".
    if (key.ctrl && input === 'u' && dispatchBuf !== '') {
      setDispatchBuf(prev => prev.slice(dispatchCursor))
      setDispatchCursor(0)
      return
    }

    // Ctrl+K — kill from cursor to end of buffer (readline kill-line-forward).
    if (key.ctrl && input === 'k' && dispatchBuf !== '') {
      setDispatchBuf(prev => prev.slice(0, dispatchCursor))
      return
    }

    // Ctrl+W — kill word before cursor.
    if (key.ctrl && input === 'w' && dispatchBuf !== '') {
      setDispatchBuf(prev => {
        const c = Math.min(dispatchCursor, prev.length)
        if (c === 0) return prev
        // Walk back over trailing spaces then word chars.
        let i = c - 1
        while (i > 0 && /\s/.test(prev[i]!)) i--
        while (i > 0 && !/\s/.test(prev[i - 1]!)) i--
        const next = prev.slice(0, i) + prev.slice(c)
        setDispatchCursor(i)
        return next
      })
      return
    }

    // Right arrow on a job row — open/attach.
    // Source: ant 5092.js: `if (W_.key === "right" && !W_.shift && !j_.current
    //   && !_H) { B6(); US(E9); return }`
    // - !W_.shift: shift+right is reserved (no current binding, but must not
    //   accidentally fire attach when user holds shift for some other intent)
    // - !j_.current: buffer empty (when typing, right is cursor-right)
    // - !_H: not in peek (peek branch handles right separately if at all)
    if (
      key.rightArrow &&
      !key.shift &&
      dispatchBuf === '' &&
      focused?.kind === 'job'
    ) {
      setAttachingShort(focused.job.id)
      onAttach?.(focused.job.id)
      return
    }

    // Right arrow — when dispatch buffer non-empty, move cursor right.
    if (key.rightArrow && dispatchBuf !== '') {
      setDispatchCursor(c => Math.min(dispatchBuf.length, c + 1))
      return
    }

    // Alt/Cmd + 1-9 — quick-open the Nth job row IN THE CURRENT ORIGIN.
    // Source: ant 5092.js verbatim:
    //   if ((W_.meta||W_.superKey) && W_.key >= "1" && W_.key <= "9") {
    //     let l6 = Number(W_.key)
    //     let Dq = cH.find(K9 => K9.kind === "job" && K9.origin === TP
    //                       && --l6 === 0)
    //     if (Dq?.kind === "job") US(Dq.job)
    //   }
    //
    // TP = focused row's origin (S4?.origin ?? cwd). So alt+1 picks the
    // FIRST job whose origin matches the focused row's origin, not
    // first-job-overall. Lets the user quickly toggle within a repo
    // when multiple repos are in the fleet.
    if (key.meta && input >= '1' && input <= '9') {
      const n = Number(input)
      const focusedRow = rows[clampedIndex]
      const focusedOrigin =
        focusedRow?.kind === 'job'
          ? spawnOriginOf(focusedRow.job.state)
          : focusedRow?.kind === 'header'
            ? // header doesn't carry origin in ccb's FleetRow; fall back
              // to current-cwd derivation. Acceptable for now since the
              // typical case is the user is on a job row.
              getCwd()
            : getCwd()
      let i = 0
      for (const row of rows) {
        if (row.kind !== 'job') continue
        if (spawnOriginOf(row.job.state) !== focusedOrigin) continue
        if (++i === n) {
          setAttachingShort(row.job.id)
          onAttach?.(row.job.id)
          return
        }
      }
      return
    }

    // Return — ant 5092.js xd verbatim:
    //
    //   if (W_.key === "return") {
    //     if (!W_.shift && (W_.meta || j_.current[U_-1] === "\\")) {
    //       e_(W_)  // delegate to text input → insert newline
    //       return
    //     }
    //     B6()  // preventDefault → submit path
    //     ...
    //   }
    //
    // shift+Enter submits; meta+Enter inserts newline; backslash-prefix
    // Enter inserts newline; plain Enter submits.
    if (key.return) {
      const cursor = Math.min(dispatchCursor, dispatchBuf.length)
      const prevChar = cursor > 0 ? dispatchBuf[cursor - 1] : undefined
      const wantsNewline =
        !key.shift && (key.meta || prevChar === '\\')
      if (wantsNewline && dispatchBuf !== '') {
        setDispatchBuf(prev => {
          const c = Math.min(dispatchCursor, prev.length)
          if (prevChar === '\\') {
            const next = prev.slice(0, c - 1) + '\n' + prev.slice(c)
            setDispatchCursor(c)
            return next
          }
          const next = prev.slice(0, c) + '\n' + prev.slice(c)
          setDispatchCursor(c + 1)
          return next
        })
        return
      }
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
  // ant 5092.js Tz render gate uses `O$` — the post-filter sorted job
  // list — NOT the row list (which excludes collapsed-section jobs).
  // So the empty-state hint shows only when the FLEET is empty or the
  // only existing job is the current session, regardless of which
  // sections are currently collapsed.
  const showEmptyHint = useMemo(() => {
    if (filterText !== '') return false
    if (dispatchBuf !== '') return false
    if (jobs.length === 0) return true
    return jobs.every(j => j.id === currentSessionId)
  }, [jobs, filterText, dispatchBuf, currentSessionId])
  const showNoMatchHint = !hasAnyJobRow && filterText !== ''
  // ant 5092.js: `wk = O$.some(W_ => W_.id === _)` — true when ANY
  // job row matches the current session id (i.e., the current session
  // appears in the fleet). The hint render is then gated separately on
  // `O$.every(W_ => W_.id === _) && !bH` — every job IS the current
  // session AND buffer is empty. ccb keeps two separate signals:
  //   - currentSessionInRows: at least one row is the current session
  //   - showReturnHint:       every job row is the current session
  //     (i.e., user's only session in view) and buffer is empty —
  //     this is the variant that switches "type a task below" to
  //     "press → to return to your session anytime".
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
              idx={idx}
              focused={idx === clampedIndex}
              currentSessionId={currentSessionId}
              armedDelete={armedDelete}
              attachingShort={attachingShort}
              terminalWidth={terminalWidth}
              labelWidth={labelWidth}
              ageWidth={ageWidth}
              collapsed={row.kind === 'header' && collapsedGroups.has(row.group)}
              renameState={renameState}
              prCache={prCache}
              presence={
                row.kind === 'job'
                  ? // Source: ant 5092.js `yA` presence resolver. ant has a
                    // daemon roster (q$) populated from attacher.json files —
                    // every alive worker reports a status ("busy"|"shell"|
                    // "waiting"). pdK's first branch (`_ && tempo!=='active'
                    // && presence===undefined → sq_`) only fires when no
                    // roster entry exists → exited workers get ∙.
                    //
                    // ccb's PTY-only mode has no daemon roster, so `presence`
                    // map is always empty for these workers. Without
                    // synthesis EVERY idle row landed in the "exited" branch
                    // and rendered ∙. Mirror ant by reporting:
                    //   tempo === 'active' → 'busy' (alive + working, spinner)
                    //   else (alive idle)  → 'waiting' (matches ant attacher
                    //                       roster idle status — pdK falls
                    //                       through to Vs3 = ✻)
                    // Daemon-managed rows still defer to the real roster.
                    presence.get(row.job.id) ??
                    (row.job.state.tempo === 'active' ? 'busy' : 'waiting')
                  : undefined
              }
              // Source: ant 5092.js `onMouseEnter: bH || _H ? void 0 : K9`.
              // `_H` is peek-open, `bH` is dispatch-buffer non-empty.
              // ant DISABLES mouse hover when peek is open or the user is
              // composing a dispatch — a stray cursor movement would
              // otherwise switch the focused row (and thus the peek
              // panel's content) underneath the user's intent. Same
              // behaviour ccb should have.
              onMouseEnter={
                peekOpen || dispatchBuf !== ''
                  ? undefined
                  : () => {
                      // ant: mouse hover updates B_/l_ so the per-render
                      // follow-id effect doesn't drag focus back to the
                      // previous row.
                      setSelectionIndex(idx)
                      if (row.kind === 'job') {
                        followIdRef.current = row.job.id
                        followGroupRef.current = undefined
                      } else if (row.kind === 'header') {
                        followIdRef.current = undefined
                        followGroupRef.current = row.group
                      } else {
                        followIdRef.current = undefined
                        followGroupRef.current = undefined
                      }
                    }
              }
              // Source: ant 5092.js K9 + onClick handlers. K9's short-circuit
              // `if (B6===o || _H && W_.kind!=="job") return` skips
              // setSelectionIndex when peek is open and the clicked row
              // is NOT a job — toggle-collapse / expand-fold still runs
              // (post-K9 in ant), just the row-focus doesn't follow the
              // mouse pointer.
              onClick={() => {
                const isPeekNonJob = peekOpen && row.kind !== 'job'
                if (!isPeekNonJob) {
                  setSelectionIndex(idx)
                }
                if (row.kind === 'job') {
                  followIdRef.current = row.job.id
                  followGroupRef.current = undefined
                  setAttachingShort(row.job.id)
                  onAttach?.(row.job.id)
                } else if (row.kind === 'header') {
                  followIdRef.current = undefined
                  followGroupRef.current = row.group
                  handleToggleCollapse(row.group)
                } else if (row.kind === 'fold') {
                  followIdRef.current = undefined
                  followGroupRef.current = undefined
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
        // Source: ant 5092.js — peek panel is rendered as an OVERLAY:
        //   <B position="absolute" bottom=0 left=0 right=0 flexDirection="column" opaque=true>
        //     <gs3 .../>
        //   </B>
        // The overlay covers the row list while peek is open, so the
        // entire screen below the banner is the peek experience.
        // ccb previously rendered the panel inline below the input —
        // user saw a sliver at the bottom and an empty row area above.
        <Box
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          flexDirection="column"
          opaque
        >
          <PeekPanel
            job={focusedJob}
            activity={focusedActivity}
            presence={focusedPresence}
            value={peekDraft}
            onValueChange={setPeekDraft}
            cursorOffset={peekCursor}
            onCursorChange={setPeekCursor}
            onSubmit={handlePeekSubmit}
            onClose={handlePeekClose}
            // ant gs3 `onExit: () => if (empty && prompt) z()` where z =
            // onAttach. So enter-on-empty in the peek = resume/attach to
            // the session, not close. Wire onResume to onAttach handler.
            onResume={() => {
              handlePeekClose()
              setAttachingShort(focusedJob.id)
              onAttach?.(focusedJob.id)
            }}
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
            // ant 5092.js ts3 `canMention: I3.length + _$.length +
            // Object.keys(l).length > 0` — show "@ to mention" when
            // ANY of agents / skills / repos are available.
            canMention={agents.length > 0 || Object.keys(worktreeRepos).length > 0}
            // ant 5092.js Ot3: `altOpenCount: Math.min(9, H8(cH, W_ =>
            // W_.kind === "job" && W_.origin === TP))` — the number of
            // alt+digit slots actually wired up (capped at 9). TP is the
            // FOCUSED ROW's origin, so the count reflects "jobs in this
            // repo" not "jobs total". Matches the alt+digit handler's
            // origin filter (see meta-digit branch above).
            altOpenCount={Math.min(
              9,
              (() => {
                const f = rows[clampedIndex]
                const origin =
                  f?.kind === 'job' ? spawnOriginOf(f.job.state) : getCwd()
                return rows.filter(
                  r =>
                    r.kind === 'job' && spawnOriginOf(r.job.state) === origin,
                ).length
              })(),
            )}
          />
        </Box>
      ) : null}
      {/* Status line. Priority: quit-confirm > error > footer chord cascade. */}
      {pendingQuitConfirm ? (
        <Box flexShrink={0} paddingLeft={2} height={1}>
          <Text dimColor>
            {(() => {
              // ant 5092.js quit-confirm message:
              //   `Press Ctrl-C again to exit${GB > 0 ? \` · ${GB} ${v6(GB,'agent')} will keep running\` : ''}`
              // where GB counts rows in `blocked` or `working` bucket via
              // `PZ6 === "blocked" || PZ6 === "working"`. Reassures the user
              // that bg sessions outlive the FleetView quit.
              const keepCount = jobs.filter(j => {
                const band = deriveBand(j.state, presence.get(j.id))
                return band === 'blocked' || band === 'active'
              }).length
              if (keepCount === 0) return 'Press Ctrl-C again to exit'
              const noun = keepCount === 1 ? 'agent' : 'agents'
              return `Press Ctrl-C again to exit · ${keepCount} ${noun} will keep running`
            })()}
          </Text>
        </Box>
      ) : errorToast !== undefined ? (
        <Box flexShrink={0} paddingLeft={2} height={1}>
          <Text color="error" wrap="truncate-end">{errorToast}</Text>
        </Box>
      ) : peekOpen ? (
        // Source: ant 5092.js Ot3 footer cascade gate `!_H && vA.length===0`
        // — when peek (`_H`) is open, the main FleetView chord cascade is
        // suppressed. The peek panel renders its OWN footer (`U_`) so the
        // chords on screen reflect the peek context (resume/close/delete)
        // instead of the fleet navigation context (open/space/reply/?).
        null
      ) : (
        <FleetFooter
          terminalWidth={terminalWidth}
          selectionKind={peekOpen ? 'job' : selectionKind}
          filterText={filterText}
          isCurrentSession={focusedJob?.state.sessionId === currentSessionId}
          isRenaming={renameState !== undefined}
          isTransitional={false}
          isHeaderCollapsed={isHeaderCollapsed}
          // ant 5092.js `_h = S$ ? "create" : (E9 && qi8(E9.state)) ? "resume" : "open"`
          // - peek open → close (Enter closes peek)
          // - dispatch buffer has parseable text → create (new job)
          // - focused job is failed/stopped → resume (respawn)
          // - else → open (attach)
          jobEnterAction={
            peekOpen
              ? 'close'
              : dispatchBuf.trim() !== ''
                ? 'create'
                : focusedJob && needsRespawn(focusedJob)
                  ? 'resume'
                  : 'open'
          }
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
  /**
   * Index within the rendered row list. Drives ant's `marginTop:B6>0?1:0`
   * spacing rule on section headers — every header EXCEPT the first
   * gets one blank line above it, so "Needs input", "Working",
   * "Completed" sections visually separate. Source: ant 5092.js
   * `if(W_.kind==="header"){…marginTop:B6>0?1:0…}`.
   */
  idx: number
  focused: boolean
  currentSessionId: string
  armedDelete: { id: string; justKilled: boolean } | undefined
  attachingShort: string | null
  terminalWidth: number
  labelWidth: number
  ageWidth: number
  collapsed: boolean
  renameState: RenameState | undefined
  prCache: FleetPrCache | undefined
  /** Per-row presence from daemon roster (busy/shell/waiting/undefined). */
  presence: FleetPresence
  onMouseEnter: () => void
  onClick: () => void
}

function Row({
  row,
  idx,
  focused,
  currentSessionId,
  armedDelete,
  attachingShort,
  terminalWidth,
  labelWidth,
  ageWidth,
  collapsed,
  renameState,
  prCache,
  presence,
  onMouseEnter,
  onClick,
}: RowProps): React.ReactNode {
  if (row.kind === 'header') {
    return (
      <Box
        marginTop={idx > 0 ? 1 : 0}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
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
  // Source: ant 5092.js `OH=WH>=120?1:0`. Wide terminals indent
  // job + fold rows by 1 column so the row glyph ("✻"/"•") sits one
  // column right of the section header. Narrow terminals (<120 cols)
  // skip the indent to preserve label width. Headers always start at
  // column 0 — the indent visually distinguishes "section title" from
  // "section items".
  const rowPaddingLeft = terminalWidth >= 120 ? 1 : 0
  if (row.kind === 'fold') {
    return (
      <Box
        paddingLeft={rowPaddingLeft}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
      >
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
    <Box
      paddingLeft={rowPaddingLeft}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <FleetJobRow
        state={row.job.state}
        activity={row.activity}
        presence={presence}
        isCurrentSession={isCurrent}
        focused={focused}
        attaching={attachingShort === row.job.id}
        deleteArmed={
          armedDelete !== undefined && armedDelete.id === row.job.id
            ? { justKilled: armedDelete.justKilled }
            : undefined
        }
        renaming={renaming}
        childSummaries={childSummaries}
        age={formatJobAge(row.job)}
        labelWidth={labelWidth}
        ageWidth={ageWidth}
      />
    </Box>
  )
}
