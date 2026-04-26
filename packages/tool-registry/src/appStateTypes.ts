// V7 §7.2 — type-only shim so tool-registry does not import src/state/AppState.
// The concrete shape is opaque here; Tool/Task signatures only thread it through.
//
// Typed as `Record<string, any>` rather than `unknown` so consumers can:
//   - spread state into new objects: `{ ...prev, foo: 1 }` (was TS2698)
//   - access arbitrary properties: `prev.someField` (was TS2339 on unknown)
// Both are legitimate in the V7 boundary because the canonical shape lives
// in app-host/state — tool-registry just threads the value through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppState = Record<string, any>
