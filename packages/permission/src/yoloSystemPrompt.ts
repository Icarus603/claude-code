import { feature } from 'bun:bundle'
import type Anthropic from '@anthropic-ai/sdk'
import type { ToolPermissionContext } from '@claude-code/tool-registry/Tool.js'
import { getAutoModeConfig } from '@claude-code/config/settings'
import { readEnv } from '@claude-code/config/env'
import { getGitEmail } from '@claude-code/provider/user.js'
import { getBashPromptAllowDescriptions, getBashPromptDenyDescriptions } from './bashClassifier.js'
import { getDenyRules } from './permissions.js'
import { permissionRuleValueToString } from './permissionRuleParser.js'

// ============================================================================
// Auto-mode classifier SYSTEM PROMPT assembly (ant v2.1.150 Dp5/UZ7/q36/pM_/H36
// + Yp5/wp5 + Jp5). Split out of yoloClassifier.ts so the decision engine
// (API calls, parsing, telemetry) stays separate from prompt construction.
//
// Three .txt files back this layer:
//   - auto_mode_system_prompt.txt — BASE prompt (Threat Model, User Intent Rule,
//     Evaluation Rules, Classification Process) with a `<permissions_template>`
//     placeholder.
//   - permissions_{external,anthropic}.txt — the HARD/SOFT BLOCK + ALLOW rule
//     TEMPLATE (ant 150 ships one; ccb keeps both filenames with identical
//     content for build-time DCE + the protected-path contract test).
// ============================================================================

// Dead code elimination: conditional imports for auto mode classifier prompts.
// At build time, the bundler inlines .txt files as string literals. At test
// time, require() returns {default: string} — txtRequire normalizes both.
/* eslint-disable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */
function txtRequire(mod: string | { default: string }): string {
  return typeof mod === 'string' ? mod : mod.default
}

const BASE_PROMPT: string = feature('TRANSCRIPT_CLASSIFIER')
  ? txtRequire(require('./yolo-classifier-prompts/auto_mode_system_prompt.txt'))
  : ''

// External template is loaded separately so it's available for
// `claude auto-mode defaults` even in ant builds.
const EXTERNAL_PERMISSIONS_TEMPLATE: string = feature('TRANSCRIPT_CLASSIFIER')
  ? txtRequire(require('./yolo-classifier-prompts/permissions_external.txt'))
  : ''

// ant 150 collapsed the two templates into one (3149.js Kp5()===true always
// selects RR8; the `qp5` alternate is dead `""`). ccb keeps both .txt consts
// for build-time DCE + the protected-path contract test, but they now hold the
// SAME ant-150 RR8 content. The historical anthropic-vs-external split (and the
// "external deny rules too broad for macOS dev" rationale) is gone: the v150
// template already carries the dev-friendly ALLOW exceptions (Local Operations,
// Declared Dependencies, Toolchain Bootstrap, etc.) inline.
const ANTHROPIC_PERMISSIONS_TEMPLATE: string = feature('TRANSCRIPT_CLASSIFIER')
  ? txtRequire(require('./yolo-classifier-prompts/permissions_anthropic.txt'))
  : ''
/* eslint-enable custom-rules/no-process-env-top-level, @typescript-eslint/no-require-imports */

function isUsingExternalPermissions(): boolean {
  // ant 150 Kp5(): always true. The classifier always uses the v150 unified
  // template. forceExternalPermissions is kept as a no-op escape hatch for
  // config compat. Returning true here also disables the legacy ccb bash/
  // powershell guidance injection (gated on `!usingExternal`) — correct,
  // because ant's Dp5 never injected those into the auto-mode classifier and
  // the v150 template already covers PowerShell idioms inline. Bash `prompt:`
  // rules keep working via their own speculative-classifier path (useCanUseTool
  // peekSpeculativeClassifierCheck), independent of this prompt.
  return true
}

/**
 * Shape of the settings.autoMode config — the four classifier prompt sections a
 * user can customize. Required-field variant (empty arrays when absent) for
 * JSON output; settings.ts uses the optional-field variant.
 */
export type AutoModeRules = {
  allow: string[]
  soft_deny: string[]
  /**
   * Hard-deny rules — these classes of action are NEVER auto-approved, even
   * with explicit user authorization in the active conversation. The classifier
   * evaluates hard_deny BEFORE checking user intent or soft_deny.
   */
  hard_deny: string[]
  environment: string[]
}

/**
 * Parses the external permissions template into the settings.autoMode schema
 * shape. The external template wraps each section's defaults in
 * <user_*_to_replace> tags (user settings REPLACE these defaults), so the
 * captured tag contents ARE the defaults. Bullet items are single-line in the
 * template; each line starting with `- ` becomes one array entry.
 * Used by `claude auto-mode defaults`.
 */
export function getDefaultExternalAutoModeRules(): AutoModeRules {
  return {
    allow: extractTaggedBullets('user_allow_rules_to_replace'),
    // ant 150 q36(): the soft-deny defaults live in
    // `user_soft_deny_rules_to_replace` (renamed from the pre-v150
    // `user_deny_rules_to_replace`). The fallback keeps `auto-mode defaults`
    // working if an unported template is ever loaded.
    soft_deny: orFallback(
      extractTaggedBullets('user_soft_deny_rules_to_replace'),
      () => extractTaggedBullets('user_deny_rules_to_replace'),
    ),
    hard_deny: extractTaggedBullets('user_hard_deny_rules_to_replace'),
    environment: extractTaggedBullets('user_environment_to_replace'),
  }
}

function orFallback<T extends unknown[]>(primary: T, fallback: () => T): T {
  return primary.length > 0 ? primary : fallback()
}

function extractTaggedBullets(tagName: string): string[] {
  const match = EXTERNAL_PERMISSIONS_TEMPLATE.match(
    new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`),
  )
  if (!match) return []
  return (match[1] ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2))
}

/**
 * Returns the full external classifier system prompt with default rules (no user
 * overrides). Used by `claude auto-mode critique` to show the model how the
 * classifier sees its instructions.
 */
export function buildDefaultExternalSystemPrompt(): string {
  // ant 150 UZ7(): unwrap every `<foo_to_replace>` tag to its defaults and
  // strip the `<settings_deny_rules>` marker (no user deny rules in the
  // defaults view). Both the v150 `user_soft_deny_rules_to_replace` and the
  // legacy `user_deny_rules_to_replace` tags are handled so an unported
  // template can't leak a literal tag into the critique view.
  const unwrap = (s: string, tag: string): string =>
    s.replace(
      new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`),
      (_m, defaults: string) => defaults,
    )
  let out = BASE_PROMPT.replace(
    '<permissions_template>',
    () => EXTERNAL_PERMISSIONS_TEMPLATE,
  )
  for (const tag of [
    'user_allow_rules_to_replace',
    'user_soft_deny_rules_to_replace',
    'user_deny_rules_to_replace',
    'user_hard_deny_rules_to_replace',
    'user_environment_to_replace',
  ]) {
    out = unwrap(out, tag)
  }
  return out.replace('<settings_deny_rules>', '')
}

/**
 * Sentinel a user may place in any autoMode rule list to splice the template's
 * built-in defaults back in alongside their custom rules. ant `alH` ("$defaults"
 * in 3149.js). Without it, a non-empty user section REPLACES that section's
 * defaults entirely (the `<foo_to_replace>` tag wraps the defaults); with it,
 * the defaults are expanded once at the sentinel's position and the rest of the
 * user's entries are kept. This is the only mechanism by which a user can keep
 * the (large, security-critical) default BLOCK/ALLOW lists while adding rules.
 */
const DEFAULTS_SENTINEL = '$defaults'

/**
 * Bash prompt-classifier rules use a `prompt:` ruleContent marker and are
 * enforced on their own path (bashClassifier.ts) — they must NOT be surfaced as
 * generic settings deny rules to the auto-mode classifier. ant `C96` ("prompt:"
 * in 3149.js).
 */
const BASH_PROMPT_RULE_PREFIX = 'prompt:'

/**
 * Merge user-supplied rule entries with the template's default block, honoring
 * the `$defaults` sentinel. ant `pM_` (3149.js): when the user list is empty,
 * keep the defaults verbatim; otherwise emit each user entry as a `- ` bullet,
 * expanding the defaults once where the sentinel appears (deduped — a second
 * `$defaults` is dropped). Returns the joined replacement string for a
 * `<foo_to_replace>` tag body.
 */
function mergeRulesWithDefaults(
  userRules: string[] | undefined,
  defaults: string,
): string {
  if (!userRules?.length) return defaults
  const out: string[] = []
  let injected = false
  for (const rule of userRules) {
    if (rule === DEFAULTS_SENTINEL) {
      if (!injected) {
        if (defaults.length > 0) out.push(defaults)
        injected = true
      }
      continue
    }
    out.push(`- ${rule}`)
  }
  return out.join('\n')
}

/**
 * Build the "User Deny Rules" guidance line injected at the `<settings_deny_rules>`
 * marker. ant `Yp5` (collect raw deny-rule strings, skip Bash `prompt:` rules)
 * + `wp5` (format the cross-tool-circumvention guidance). Tells the classifier
 * that an Edit/Write/MultiEdit deny rule must also block the same effect routed
 * through Bash (`python -c`, `sed -i`, `cat >`, heredocs). Returns '' when the
 * user has no deny rules.
 */
function buildSettingsDenyRulesGuidance(context: ToolPermissionContext): string {
  const seen = new Set<string>()
  for (const rule of getDenyRules(context)) {
    // Bash prompt-classifier rules are enforced elsewhere — not circumvention
    // targets. ant Yp5 `fw(O).ruleContent?.startsWith(C96)`.
    if (rule.ruleValue.ruleContent?.startsWith(BASH_PROMPT_RULE_PREFIX)) continue
    seen.add(permissionRuleValueToString(rule.ruleValue))
  }
  if (seen.size === 0) return ''
  const ruleList = [...seen].map(r => `\`${r}\``).join(', ')
  return (
    `- User Deny Rules: The user has configured these permission deny rules: ${ruleList}. ` +
    `Each rule names a tool and (optionally) an argument pattern that is already hard-blocked for that tool. ` +
    'Block the action if it accomplishes the same effect via a different tool — e.g. using Bash with ' +
    '`python -c`, `sed -i`, `cat >`, heredocs, or similar to write or edit a file that an Edit/Write/MultiEdit ' +
    'deny rule covers, or otherwise routing around a deny rule by switching tools. The named tool itself is ' +
    'enforced separately; your job here is to catch circumvention.'
  )
}

/**
 * Build Session Context lines appended as a separate system block. ant `Jp5`
 * (3149.js): resolve the operator's identity from GITHUB_ACTOR / USER /
 * USERNAME / git email (local part), sanitized and length-capped, so the
 * classifier can resolve the `$USER/...` branch pattern in the deny rules and
 * recognize that `<other-user>/...` branches are NOT this operator's personal
 * branches. Returns [] when no identity can be resolved.
 */
async function buildSessionContextLines(): Promise<string[]> {
  const lines: string[] = []
  const gitEmail = await getGitEmail()
  const rawIdentity =
    readEnv('GITHUB_ACTOR') ??
    readEnv('USER') ??
    readEnv('USERNAME') ??
    (gitEmail ? gitEmail.split('@')[0] : null)
  // Sanitize: drop anything outside a conservative identifier set, cap length.
  // ant jp5 strips disallowed chars before the .slice(0,64).
  const identity =
    rawIdentity?.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || null
  if (identity) {
    lines.push(
      `**User identity**: \`${identity}\`. The \`$USER/...\` pattern in the rules above resolves to ` +
        `\`${identity}/...\`. Branches whose first path segment is a different person's name ` +
        `(\`<other-user>/...\`) are NOT this user's personal branches.`,
    )
  }
  return lines
}

/**
 * PowerShell-specific deny guidance for the classifier. Appended to the
 * deny list in buildYoloSystemPrompt when PowerShell auto mode is active.
 * Maps PS idioms to the existing BLOCK categories so the classifier
 * recognizes `iex (iwr ...)` as "Code from External", `Remove-Item
 * -Recurse -Force` as "Irreversible Local Destruction", etc.
 *
 * Guarded at definition for DCE — with external:false, the string content
 * is absent from external builds (same pattern as the .txt requires above).
 */
const POWERSHELL_DENY_GUIDANCE: readonly string[] = feature(
  'POWERSHELL_AUTO_MODE',
)
  ? [
      'PowerShell Download-and-Execute: `iex (iwr ...)`, `Invoke-Expression (Invoke-WebRequest ...)`, `Invoke-Expression (New-Object Net.WebClient).DownloadString(...)`, and any pipeline feeding remote content into `Invoke-Expression`/`iex` fall under "Code from External" — same as `curl | bash`.',
      'PowerShell Irreversible Destruction: `Remove-Item -Recurse -Force`, `rm -r -fo`, `Clear-Content`, and `Set-Content` truncation of pre-existing files fall under "Irreversible Local Destruction" — same as `rm -rf` and `> file`.',
      'PowerShell Persistence: modifying `$PROFILE` (any of the four profile paths), `Register-ScheduledTask`, `New-Service`, writing to registry Run keys (`HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` or the HKLM equivalent), and WMI event subscriptions fall under "Unauthorized Persistence" — same as `.bashrc` edits and cron jobs.',
      'PowerShell Elevation: `Start-Process -Verb RunAs`, `-ExecutionPolicy Bypass`, and disabling AMSI/Defender (`Set-MpPreference -DisableRealtimeMonitoring`) fall under "Security Weaken".',
    ]
  : []

/**
 * The assembled classifier system prompt: the base+template text (block 0) plus
 * any Session Context lines (block 1). ant `Dp5` returns a system-block array
 * for exactly this reason — the Session Context is a separate cacheable block.
 */
export type YoloSystemPrompt = {
  systemText: string
  sessionContextBlocks: Anthropic.TextBlockParam[]
}

/**
 * Build the system prompt for the auto mode classifier.
 * Assembles the base prompt with the permissions template and substitutes
 * user allow/soft_deny/hard_deny/environment values from settings.autoMode,
 * injects the cross-tool deny-rule circumvention guidance at
 * `<settings_deny_rules>`, and returns Session Context as a separate block.
 * ant `Dp5` (3149.js).
 */
export async function buildYoloSystemPrompt(
  context: ToolPermissionContext,
): Promise<YoloSystemPrompt> {
  const usingExternal = isUsingExternalPermissions()
  const systemPrompt = BASE_PROMPT.replace('<permissions_template>', () =>
    usingExternal
      ? EXTERNAL_PERMISSIONS_TEMPLATE
      : ANTHROPIC_PERMISSIONS_TEMPLATE,
  )

  const autoMode = getAutoModeConfig()
  const includeBashPromptRules = feature('BASH_CLASSIFIER')
    ? !usingExternal
    : false
  const includePowerShellGuidance = feature('POWERSHELL_AUTO_MODE')
    ? !usingExternal
    : false
  const allowDescriptions = [
    ...(includeBashPromptRules ? getBashPromptAllowDescriptions(context) : []),
    ...(autoMode?.allow ?? []),
  ]
  const softDenyDescriptions = [
    ...(includeBashPromptRules ? getBashPromptDenyDescriptions(context) : []),
    ...(includePowerShellGuidance ? POWERSHELL_DENY_GUIDANCE : []),
    ...(autoMode?.soft_deny ?? []),
  ]

  // Each `<foo_to_replace>...</foo_to_replace>` tag wraps that section's
  // defaults. A non-empty user list REPLACES the defaults; a user list
  // containing the `$defaults` sentinel splices the defaults back in
  // (mergeRulesWithDefaults). ant Dp5/pM_/H36 — the same merge for allow,
  // soft_deny, hard_deny, and environment.
  const systemText = systemPrompt
    .replace(
      /<user_allow_rules_to_replace>([\s\S]*?)<\/user_allow_rules_to_replace>/,
      (_m, defaults: string) => mergeRulesWithDefaults(allowDescriptions, defaults),
    )
    .replace(
      /<user_soft_deny_rules_to_replace>([\s\S]*?)<\/user_soft_deny_rules_to_replace>/,
      (_m, defaults: string) =>
        mergeRulesWithDefaults(softDenyDescriptions, defaults),
    )
    .replace(
      /<user_hard_deny_rules_to_replace>([\s\S]*?)<\/user_hard_deny_rules_to_replace>/,
      (_m, defaults: string) =>
        mergeRulesWithDefaults(autoMode?.hard_deny, defaults),
    )
    .replace(
      /<user_environment_to_replace>([\s\S]*?)<\/user_environment_to_replace>/,
      (_m, defaults: string) =>
        mergeRulesWithDefaults(autoMode?.environment, defaults),
    )
    // Back-compat: pre-v150 templates used the additive `<user_deny_rules_to_replace>`
    // tag name. ant 150 renamed it to soft_deny; keep a no-op replace so an
    // unported template never leaks the literal tag to the classifier.
    .replace(
      /<user_deny_rules_to_replace>([\s\S]*?)<\/user_deny_rules_to_replace>/,
      (_m, defaults: string) =>
        mergeRulesWithDefaults(softDenyDescriptions, defaults),
    )
    // Inject the cross-tool deny-rule circumvention guidance. ant Dp5 replaces
    // the `<settings_deny_rules>` marker with wp5(Yp5(context)); pre-v150
    // templates have no marker, so this is a no-op there.
    .replace('<settings_deny_rules>', () =>
      buildSettingsDenyRulesGuidance(context),
    )

  const sessionContextLines = await buildSessionContextLines()
  const sessionContextBlocks: Anthropic.TextBlockParam[] =
    sessionContextLines.length > 0
      ? [
          {
            type: 'text' as const,
            text:
              `\n\n## Session Context\n\n` +
              sessionContextLines.map(l => `- ${l}`).join('\n'),
          },
        ]
      : []

  return { systemText, sessionContextBlocks }
}
