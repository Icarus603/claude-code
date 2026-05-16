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
  }) => void
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
    initialFocusedShort,
    initialError,
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
  const [armedDeleteId, setArmedDeleteId] = useState<string | undefined>(undefined)
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
    if (agent === undefined) {
      const space = stripped.search(/\s/)
      const firstWord = (space < 0 ? stripped : stripped.slice(0, space)).toLowerCase()
      const a = agentMap.get(firstWord)
      if (a) {
        agent = a.agentType
        const rest = space < 0 ? '' : stripped.slice(space + 1).trim()
        markAgentUsed(agent)
        onDispatch?.({ intent: rest, cwd, agent })
        setTimeout(() => refreshJobs(), 50)
        return
      }
    }
    if (agent !== undefined) markAgentUsed(agent)
    onDispatch?.({ intent: stripped, cwd, agent })
    setTimeout(() => refreshJobs(), 50)
  }, [dispatchBuf, focused, handleToggleCollapse, handleExpandFold, onAttach, onDispatch, refreshJobs, agents, worktreeRepos])

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
        setArmedDeleteId(undefined)
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

    // Right arrow on a job row — open/attach. Source: ant 2941-2944.
    if (key.rightArrow && dispatchBuf === '' && focused?.kind === 'job') {
      setAttachingShort(focused.job.id)
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
          setAttachingShort(row.job.id)
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
              focused={idx === clampedIndex}
              currentSessionId={currentSessionId}
              armedDeleteId={armedDeleteId}
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
                    // daemon roster that publishes per-worker {sessionId,
                    // status:"busy"|"shell"|"waiting"} via $M_() — ccb's
                    // daemon doesn't emit that yet, so when no daemon
                    // presence is recorded for the worker we synthesize
                    // "busy" from state.tempo === 'active'. Same end-user
                    // visual: actively-processing rows animate the spinner;
                    // idle rows show the static glyph.
                    presence.get(row.job.id) ??
                    (row.job.state.tempo === 'active' ? 'busy' : undefined)
                  : undefined
              }
              onMouseEnter={() => setSelectionIndex(idx)}
              onClick={() => {
                setSelectionIndex(idx)
                if (row.kind === 'job') {
                  setAttachingShort(row.job.id)
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
            // ant 5092.js ts3 `canMention: I3.length + _$.length +
            // Object.keys(l).length > 0` — show "@ to mention" when
            // ANY of agents / skills / repos are available.
            canMention={agents.length > 0 || Object.keys(worktreeRepos).length > 0}
            // ant 5092.js Ot3: `altOpenCount: Math.min(9, H8(cH, W_ =>
            // W_.kind === "job" && W_.origin === TP))` — the number of
            // alt+digit slots actually wired up (capped at 9).
            altOpenCount={Math.min(9, rows.filter(r => r.kind === 'job').length)}
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
  focused: boolean
  currentSessionId: string
  armedDeleteId: string | undefined
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
  focused,
  currentSessionId,
  armedDeleteId,
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
        presence={presence}
        isCurrentSession={isCurrent}
        focused={focused}
        attaching={attachingShort === row.job.id}
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
