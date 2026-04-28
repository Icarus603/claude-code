# storage/sessionStorage.ts — topology

**File**: `packages/storage/src/sessionStorage.ts` (4721 LOC)
**Top-level decls**: 100 (71 exported, 29 internal)

## Largest decls

- [i] L1627-1744 (118): `function applyPreservedSegmentRelinks`
- [E] L2565-2672 (108): `function loadFullLog`
- [E] L1910-2008 (99): `function loadTranscriptFromFile`
- [E] L4214-4310 (97): `function loadAllLogsFromSessionFile`
- [i] L4434-4529 (96): `function extractFirstPromptFromChunk`
- [E] L1420-1511 (92): `function hydrateFromCCRv2InternalEvents`
- [i] L4355-4429 (75): `function readLiteMetadata`
- [i] L3729-3797 (69): `function getStatOnlyLogsForWorktrees`
- [i] L2773-2840 (68): `function scanPreBoundaryMetadata`
- [E] L1534-1600 (67): `function getFirstMeaningfulUserMessageTextContent`
- [E] L3485-3548 (64): `function getLastSessionLog`
- [i] L1770-1827 (58): `function applySnipRemovals`
- [i] L4012-4064 (53): `function transformMessagesForExternalTranscript`
- [i] L4638-4685 (48): `function enrichLog`
- [i] L2095-2140 (46): `function convertToLogOption`
- [E] L1196-1237 (42): `function recordTranscript`
- [E] L4094-4135 (42): `function findUnresolvedToolUse`
- [E] L4590-4631 (42): `function getSessionFilesLite`
- [i] L3594-3632 (39): `function loadAllProjectsMessageLogsFull`
- [E] L1375-1410 (36): `function hydrateRemoteSession`
- [i] L2142-2173 (32): `function trackSessionBranchingAnalytics`
- [E] L2505-2536 (32): `function saveWorktreeState`
- [E] L3634-3665 (32): `function loadAllProjectsMessageLogsProgressive`
- [i] L2891-2920 (30): `function pickDepthOneUuidCandidate`
- [i] L4317-4345 (29): `function getLogsWithoutIndex`

## Groups by prefix (decomposition seed)

| Prefix | Count | Total LOC |
|---|---:|---:|
| `loadAll*` | 5 | 174 |
| `applyPreserved*` | 1 | 118 |
| `extractFirst*` | 2 | 112 |
| `loadFull*` | 1 | 108 |
| `loadTranscript*` | 2 | 102 |
| `hydrateFrom*` | 1 | 92 |
| `readLite*` | 1 | 75 |
| `getStat*` | 1 | 69 |
| `scanPre*` | 1 | 68 |
| `getFirst*` | 1 | 67 |
| `getLast*` | 1 | 64 |
| `applySnip*` | 1 | 58 |
| `getSession*` | 3 | 54 |
| `transformMessages*` | 1 | 53 |
| `hasVisible*` | 2 | 40 |
| `saveAgent*` | 3 | 38 |
| `loadSame*` | 2 | 35 |
