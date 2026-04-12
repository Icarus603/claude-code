/**
 * V7 §8.6 — Sandbox settings sub-schema owned by config.
 * Moved from src/entrypoints/sandboxTypes.ts; source file becomes re-export facade.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../internal/lazySchema.js'

export const SandboxNetworkConfigSchema = lazySchema(() =>
  z
    .object({
      allowedDomains: z.array(z.string()).optional(),
      allowManagedDomainsOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), only allowedDomains and WebFetch(domain:...) allow rules from managed settings are respected. ' +
            'User, project, local, and flag settings domains are ignored. Denied domains are still respected from all sources.',
        ),
      allowUnixSockets: z
        .array(z.string())
        .optional()
        .describe(
          'macOS only: Unix socket paths to allow. Ignored on Linux (seccomp cannot filter by path).',
        ),
      allowAllUnixSockets: z
        .boolean()
        .optional()
        .describe(
          'If true, allow all Unix sockets (disables blocking on both platforms).',
        ),
      allowLocalBinding: z.boolean().optional(),
      httpProxyPort: z.number().optional(),
      socksProxyPort: z.number().optional(),
    })
    .optional(),
)

export const SandboxFilesystemConfigSchema = lazySchema(() =>
  z
    .object({
      allowWrite: z.array(z.string()).optional().describe('Additional paths to allow writing within the sandbox.'),
      denyWrite: z.array(z.string()).optional().describe('Additional paths to deny writing within the sandbox.'),
      denyRead: z.array(z.string()).optional().describe('Additional paths to deny reading within the sandbox.'),
      allowRead: z.array(z.string()).optional().describe('Paths to re-allow reading within denyRead regions.'),
      allowManagedReadPathsOnly: z.boolean().optional().describe('When true (set in managed settings), only allowRead paths from policySettings are used.'),
    })
    .optional(),
)

export const SandboxSettingsSchema = lazySchema(() =>
  z
    .object({
      enabled: z.boolean().optional(),
      failIfUnavailable: z
        .boolean()
        .optional()
        .describe(
          'Exit with an error at startup if sandbox.enabled is true but the sandbox cannot start. ' +
            'When false (default), a warning is shown and commands run unsandboxed.',
        ),
      autoAllowBashIfSandboxed: z.boolean().optional(),
      allowUnsandboxedCommands: z
        .boolean()
        .optional()
        .describe('Allow commands to run outside the sandbox via the dangerouslyDisableSandbox parameter. Default: true.'),
      network: SandboxNetworkConfigSchema(),
      filesystem: SandboxFilesystemConfigSchema(),
      ignoreViolations: z.record(z.string(), z.array(z.string())).optional(),
      enableWeakerNestedSandbox: z.boolean().optional(),
      enableWeakerNetworkIsolation: z.boolean().optional().describe('macOS only: Allow access to com.apple.trustd.agent in the sandbox.'),
      excludedCommands: z.array(z.string()).optional(),
      ripgrep: z
        .object({
          command: z.string(),
          args: z.array(z.string()).optional(),
        })
        .optional()
        .describe('Custom ripgrep configuration for bundled ripgrep support'),
    })
    .passthrough(),
)

export type SandboxSettings = z.infer<ReturnType<typeof SandboxSettingsSchema>>
export type SandboxNetworkConfig = NonNullable<z.infer<ReturnType<typeof SandboxNetworkConfigSchema>>>
export type SandboxFilesystemConfig = NonNullable<z.infer<ReturnType<typeof SandboxFilesystemConfigSchema>>>
export type SandboxIgnoreViolations = NonNullable<SandboxSettings['ignoreViolations']>
