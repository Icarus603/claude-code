/**
 * Tags a process-transport MCP config as dynamic scope. Pure
 * structural transformation — the input and output types are
 * compatible at the type level, and the `scope: 'dynamic'` field
 * discriminates the union.
 *
 * Moved from src/cli/print.ts per V7 §10.2.
 */
export function toScopedConfig<T extends object>(
  config: T,
): T & { scope: 'dynamic' } {
  return { ...config, scope: 'dynamic' as const }
}
