/**
 * url-handler-napi — would dispatch macOS URL-scheme launches into a
 * `claude://...` deep-link handler. Currently a stub: ccb does NOT
 * ship the native module, so deep-link launches are inert.
 *
 * Throws (instead of returning null) so the caller's try/catch is the
 * unambiguous "module unavailable" branch — a silent null would
 * collapse with the legitimate "no URL event in window" outcome and
 * mask future regressions if the native module ever lands.
 *
 * If you're hooking this up: implement waitForUrlEvent in Rust/napi-rs
 * and update packages/repl/src/deepLink/protocolHandler.ts:94 to
 * import the built artifact instead of this stub.
 */
export async function waitForUrlEvent(_timeoutMs?: number): Promise<string | null> {
  throw new Error(
    'url-handler-napi: native module not built; URL deep-link launch unavailable on this ccb build',
  )
}
