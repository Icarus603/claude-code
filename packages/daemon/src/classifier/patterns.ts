/**
 * Regex pattern bank — ant 3919.js byte-identical literals.
 *
 * Used by heuristic.ts to classify worker output tail without LLM.
 *
 * @dynamicRequire
 */

// biome-ignore-all lint/suspicious/noControlCharactersInRegex: \u2014/\u2013 are dash chars

/** "failed: <text>" line marker. */
export const FAILED_LINE_RE = /(?:^|\n)\s*failed\s*[:\u2014\u2013-]\s*(.{3,200}?)(?=\n|$)/gi
/** "needs input: <text>" line marker → blocked. */
export const NEEDS_INPUT_LINE_RE = /(?:^|\n)\s*needs input\s*[:\u2014\u2013-]\s*(.{3,200}?)(?=\n|$)/gi
/** "blocked: <text>" line marker. */
export const BLOCKED_LINE_RE = /(?:^|\n)\s*blocked\s*[:\u2014\u2013-]\s*(.{3,200}?)(?=\n|$)/gi
/** "I'm blocked: <text>". */
export const IM_BLOCKED_RE = /\bI'?m blocked\s*[:\u2014\u2013-]\s*(.{3,200}?)(?=\n|$)/gi

/** "Now/Let me/I'll/Trying/Checking/..." → working/active. ant gp5. */
export const WORKING_VERB_RE =
  /^(?:(?:Now|Next|Then|Alright|OK|Okay|Right|Good|First|Also),?\s+)?(?:Let me (?!know\b)|(?:I(?:'?ll| will) |I'?m going to |Going to )(?!need\b|require\b|wait\b|leave\b|hold\b|skip\b|stop\b)|Proceeding |Moving (?:on|to)\b|Continuing |Starting |Trying |Checking |Looking |Searching |Reading |Investigating |Running |Re-?running |Building |Rebuilding |Installing |Fetching |Applying |Fixing |Patching |Updating |Adding |Removing |Deleting |Importing |Refactoring |Rewriting |Writing |Grepping |Scanning |Wrapping |Switching |Testing |Verifying |Regenerating |Pushing |Pulling |Reviewing |Examining |Loading |Compiling |Parsing |Analyzing |Tracing |Exploring )/i

/** Excludes the working-verb match: "once you...", "wait for...", etc. ant Qp5. */
export const WORKING_VERB_EXCLUDE_RE =
  /\b(?:once |when |after |until |as soon as )(?:you|it|the|that|this|they)\b|\bagain in\b|\bcheck back\b|\bin ~?\d+\s*(?:s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:ours?|rs?)?)\b|\bthen\.?\s*$|\bwhichever you\b|\bhold(?:ing)? for your\b|\b(?:to|and) wait for\b|\bgive it (?:more |some )?time\b|\bif (?:you(?:'d| want| prefer| need|'re)?|that(?:'s| helps| works)?|useful|needed|helpful|desired)\b|\b(?:isn'?t|not|won'?t) going to work\b/i

/** "N agents in flight", "Loop active", "Crons running" → working/idle. ant dp5. */
export const AGENTS_STATUS_RE =
  /^(?:(?:\*\*)?[1-9]\d* (?:agent|cron|task|fork|job|worker|PR|check)s? (?:in flight|remaining|active|still (?:running|working)|pending|running|launched)\b|(?:Continuous )?(?:[Ll]oop|[Cc]rons?|[Bb]abysit) (?:active|healthy|continuing|running|will keep|continues)\b|Waiting for (?:the )?(?:agent|cron|task|fork|worker|job|remaining|them)s?\b|Agents? will report back\b|Waiting\.?$)/

/** "I'll check back in 5min" → working/idle. ant cp5. */
export const WILL_CHECK_BACK_RE =
  /^(?:I will|I'll|Will) (?:check back|re-?check|poll|look again|retry|re-?run|try again) (?:(?:when|once|after|until) (?!your?\b)|in\b|again\b)/i

/** "I can't proceed" → blocked/blocked. ant lp5. */
export const CANT_PROCEED_RE =
  /^I (?:can(?:'?t|not)|am unable to) (?:proceed|continue|make (?:any )?progress|complete|fix this)\b/i

/** "Giving up" / "task is not actionable" → failed. ant np5. */
export const GIVING_UP_RE = /^(?:Giving up|I(?:'m| am) giving up|The task is not actionable)\b/i

/** "Pushed/Committed/Opened PR" → done. ant ip5. */
export const PUSHED_COMMITTED_RE =
  /^(?:Pushed (?:to `|`[0-9a-f]{7,})|Committed as `?[0-9a-f]{7,}\b|Commit: `?[0-9a-f]{7,}\b|(?:Opened|Created) PR #?\d)/

/** "Ready for review" → done. ant rp5. */
export const READY_FOR_RE = /^Ready (?:for review|to (?:upload|merge|ship|land))\b/

/** "VERDICT: PASS|FAIL" → done. ant op5. */
export const VERDICT_RE = /^VERDICT: (?:PASS|FAIL)\b/

/** "Please run/provide/grant/..." → blocked. ant ap5. */
export const PLEASE_DO_RE =
  /^Please (?:start|run|provide|grant|export|add|install|configure|give me|paste|point me|set (?:the |up |`?[A-Z][A-Z0-9_]+\b))/

/** "Stopping here" / "Paused" → blocked. ant sp5. */
export const STOPPING_HERE_RE =
  /^(?:Stopping here|I've stopped here|Parked (?:the|this) branch|Paused here)(?:\.|$| \u2014| -| until| pending| since| because)/i

/** "waiting for CI/build/tests" → working/idle. */
export const WAIT_EXTERNAL_RE =
  /\b(?:waiting (?:for|on)|pending)\s+(?:the\s+)?(?:CI|build|tests?|reviewer|deploy(?:ment)?|workflow|checks?|rollout|merge queue)\b/i

/** "awaiting your X" → blocked. */
export const AWAITING_USER_RE =
  /\b(?:awaiting|waiting (?:for|on)|pending)\s+(?:your\s+(?:feedback|input|decision|response|approval|direction|guidance|go-ahead)|you\b|the user\b)/i

/** "please run /provide /confirm" / "let me know which" → blocked. */
export const ASK_VERB_RE =
  /\b(please (?:run|provide|confirm|clarify|choose|let me know)|let me know (?:which|what|how|when)|which (?:option|approach|one)|should I (?:proceed|continue|use))\b/i

/** Auth/login error prose → blocked. */
export const AUTH_ERROR_RE =
  /\b(not logged in|please run \/login|authentication failed|invalid api key|oauth token (?:expired|revoked)|credit balance (?:is )?too low|usage limit reached|mcp (?:server )?(?:authentication|auth|authorization|unauthorized)|mcp (?:server )?(?:credential|token) (?:missing|expired|invalid)|401 unauthorized|403 forbidden|token (?:has )?expired|bad credentials|gh auth login|gcloud auth login|aws (?:sso )?login)\b/i
