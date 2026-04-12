// V7 §10.2 facade: the real headless/SDK owner is `@claude-code/cli`.
// This file exists only because:
//  1. `src/runtime/installCliBindings.ts` imports `runHeadless` from here
//     (verify-headless-host.ts keeps that seam stable)
//  2. `verify-runtime-boundaries.ts` / `verify-headless-host.ts` require the
//     bootstrap import below so headless flow always triggers runtime wiring.
import 'src/runtime/bootstrap.js'

export { runHeadless, runHeadlessStreaming, handleRewindFiles } from '@claude-code/cli'
