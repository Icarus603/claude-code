// Indirection point for the package.json "browser" field. When bun builds
// browser-sdk.js with --target browser, this file is swapped for
// crypto.browser.ts — avoiding a ~500KB crypto-browserify polyfill that Bun
// would otherwise inline for `import ... from 'crypto'`. Node/bun builds use
// this file unchanged.
//
// NOTE: `export { randomUUID } from 'crypto'` (re-export syntax) breaks under
// bun-internal's bytecode compilation — the explicit import-then-export below
// produces a correct live binding.
import { randomUUID } from 'crypto'
export { randomUUID }
