// V7 §7.2 — type-only shim so tool-registry does not import src/state/AppState.
// The concrete shape is opaque here; Tool/Task signatures only thread it through.
export type AppState = unknown
