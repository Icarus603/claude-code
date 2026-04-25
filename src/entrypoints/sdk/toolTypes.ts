// Forward shim — canonical owner is packages/headless-sdk/src/agentSdkTypes.ts.
// This file used to host SdkToolDefinition; the type now lives inline in
// agentSdkTypes.ts so packages/headless-sdk owns the SDK type surface entirely.
export type { SdkToolDefinition } from '@claude-code/headless-sdk/agentSdkTypes.js'
