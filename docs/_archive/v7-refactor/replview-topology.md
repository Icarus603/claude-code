# REPLView.tsx topology — Wave B1.1

**File**: `packages/repl/src/screens/REPLView.tsx` (5641 LOC)
**Component**: `REPL({...})` (line 564) returns single `mainReturn` JSX (line 4831)

## Block summary

| Kind | Count | Total LOC |
|---|---:|---:|
| useCallback | 30 | 3726 |
| useEffect | 30 | 537 |
| useMemo | 4 | 72 |
| useRef | 36 | 36 |

## JSX (line 4831 → 5640) — 810 LOC of view

Single `mainReturn = <KeybindingSetup>...</KeybindingSetup>` tree. Has ~30 conditional sub-trees and large prop-spread chains. **First decomposition target**: extract the JSX into a stateless `screens/repl/REPLLayoutView.tsx` and pass everything as props.

## Largest useEffect blocks (candidates for extraction)

- L3233-3361 (129 lines): `useEffect(() => {`
- L4202-4263 (62 lines): `useEffect(() => {`
- L4149-4197 (49 lines): `useEffect(() => {`
- L1610-1639 (30 lines): `useEffect(() => {`
- L646-669 (24 lines): `useEffect(() => {`
- L2331-2353 (23 lines): `useEffect(() => {`
- L1583-1603 (21 lines): `useEffect(() => {`
- L1644-1658 (15 lines): `useEffect(() => {`
- L2082-2096 (15 lines): `useEffect(() => {`
- L963-976 (14 lines): `useEffect(() => {`
- L979-992 (14 lines): `useEffect(() => {`
- L2199-2211 (13 lines): `useEffect(() => {`
- L815-826 (12 lines): `useEffect(() => {`
- L2006-2017 (12 lines): `useEffect(() => {`
- L4065-4076 (12 lines): `useEffect(() => {`

Total of these 15 = 445 LOC

## Largest useCallback/useMemo (candidates for extraction)

- L2668-3361 (694): `const onQueryEvent = useCallback(`
- L2766-3361 (596): `const onQueryImpl = useCallback(`
- L3363-3860 (498): `const onSubmit = useCallback(`
- L3022-3361 (340): `const onQuery = useCallback(`
- L1757-2001 (245): `const resume = useCallback(`
- L2405-2648 (244): `const requestPrompt = useCallback(`
- L2414-2648 (235): `const getToolUseContext = useCallback(`
- L3867-4002 (136): `const rewindConversationTo = useCallback(`
- L1022-1120 (99): `const setToolJSX = useCallback(`
- L3926-4002 (77): `const restoreMessageSync = useCallback(`
- L2577-2648 (72): `const handleBackgroundQuery = useCallback(() => {`
- L4080-4131 (52): `const executeQueuedInput = useCallback(`
- L4267-4311 (45): `const handleIncomingPrompt = useCallback(`
- L3818-3860 (43): `const onAgentSubmit = useCallback(`
- L3963-4002 (40): `const handleRestoreMessage = useCallback(`

## Decomposition plan

1. **JSX → REPLLayoutView**: extract `mainReturn` JSX as stateless layout component (~810 LOC out)
2. **Group useEffect by topic**: terminal-title, mcp-init, prompt-bootstrap, message-restore, idle-callouts, query-completion, cost-dialog. Move each group into a `useXxx()` hook in `screens/repl/`.
3. **onQuery + onSubmit + onAgentSubmit + handleIncomingPrompt** (~1500 LOC of useCallback): consolidate into `useReplQuerySubmit()` controller hook.
4. **handleRestoreMessage / handleShowMessageSelector / messageActionHandlers**: extract into `useReplMessageActions()`.
5. **Goal**: REPLView shrinks from 5641 → ~1500 LOC (state + minimal wiring + REPLLayoutView render).
