/**
 * In-memory dead-set for refresh tokens that returned `invalid_grant`
 * from the OAuth refresh endpoint — port of ant v2.1.136 `mt6` + `vX1`
 * (1997.js + 1998.js).
 *
 * Why a Set instead of clearing credentials.json:
 *   Pre-2.1.133 ant wrote `refreshToken: ""` back to credentials.json on
 *   the first invalid_grant. A transient cause (clock skew, replay-cache
 *   race, token re-issued elsewhere) looked permanent — the user had to
 *   `claude --login` to recover. By keeping dead tokens in-memory and
 *   tying invalidation to the credentials.json mtime (handled in
 *   authAlias.invalidateOAuthCacheIfDiskChanged — the ccb equivalent of
 *   ant `yX1`), the next external write (concurrent /login, restore from
 *   backup, sibling-process refresh) automatically un-marks the token.
 *
 * Public surface mirrors ant `mt6` Set + `vX1`:
 *   - markRefreshTokenDead(token): record invalid_grant on token.
 *     Ant `mt6.add(Y)` in `pt6` catch-block (only when isInvalidGrant).
 *   - isRefreshTokenDead(token): query before refresh attempt.
 *     Ant `mt6.has(O.refreshToken)` in `pt6` pre-flight + post-lock.
 *   - clearRefreshTokenDeadSet(): explicit reset (matches ant `vX1`).
 *     Called by:
 *       - authAlias.invalidateOAuthCacheIfDiskChanged() on mtime advance
 *         (ccb extension; ant `yX1` only clears the OAuth-tokens cache
 *         here, but ccb additionally clears the dead-set as a defensive
 *         measure — a freshly-written credentials.json from a sibling
 *         /login almost certainly contains a different refresh token, so
 *         the dead-set entry is now stale anyway and clearing it lets
 *         the new token retry).
 *       - /logout flow (to forget any dead state from a prior identity).
 *       - Tests (ant `vX1` / `__resetKnownDeadRefreshTokensForTest`).
 *   - _resetForTesting(): full reset.
 *
 * Why this module doesn't own the mtime check:
 *   ant `yX1` (lazy mtime stat + token-cache invalidation) lives in
 *   the same file as the refresh runner (`pt6`) because it needs to
 *   call `J2H()` (= clearOAuthTokenCache). ccb mirrors that — the
 *   mtime stat + dead-set clear + OAuth cache clear all live in
 *   `authAlias.invalidateOAuthCacheIfDiskChanged()` so the three-way
 *   invalidation stays atomic and we don't need a circular hook
 *   between this module and authAlias.
 */
const deadTokens = new Set<string>()

/**
 * Record an invalid_grant for this refresh token. Idempotent. Empty
 * strings are ignored so callers don't need to pre-validate.
 *
 * Ant `mt6.add(Y)` in `pt6` catch block — only when `tu_(w)` (the
 * error is OAuth invalid_grant) AND `Y` (post-lock refresh token) is
 * defined. ccb mirrors at the throw site in `oauth/client.refreshOAuthToken`
 * via `isInvalidGrantError(error) ? markRefreshTokenDead(refreshToken)`.
 */
export function markRefreshTokenDead(token: string): void {
  if (!token) return
  deadTokens.add(token)
}

/**
 * True when the refresh token is known to have returned invalid_grant
 * since the last mtime-driven invalidation.
 *
 * Ant `mt6.has(O.refreshToken)` — checked twice in `pt6`:
 *   1. Before lock acquisition (skip refresh if already known dead).
 *   2. Post-lock with the freshly-read token (`lockedTokens.refreshToken`)
 *      — handles the race where another in-process worker marked the
 *      same token dead while we were waiting for the lockfile.
 */
export function isRefreshTokenDead(token: string): boolean {
  if (!token) return false
  return deadTokens.has(token)
}

/**
 * Explicit reset. Ant `vX1`. Called by:
 *   - authAlias.invalidateOAuthCacheIfDiskChanged() on mtime advance
 *   - /logout flow (to forget any dead state from a prior identity)
 *   - tests
 */
export function clearRefreshTokenDeadSet(): void {
  deadTokens.clear()
}

/**
 * Test-only — full state reset. Equivalent to clearRefreshTokenDeadSet
 * today (only `deadTokens` lives in this module after we moved the
 * mtime tracking into authAlias). Kept as a separate export so callers
 * that want a "reset everything I know about" semantic don't have to
 * know about the underlying state shape.
 */
export function _resetForTesting(): void {
  deadTokens.clear()
}
