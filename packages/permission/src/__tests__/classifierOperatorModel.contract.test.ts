import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '@claude-code/tool-registry/Tool.js'
import { buildYoloSystemPrompt } from '../yoloSystemPrompt.js'

/**
 * Contract test — ccb operator-model Session Context injection.
 *
 * The upstream (ant) auto-mode classifier template inherits a multi-tenant
 * threat model. One rule — SOFT BLOCK "Git Push to Default Branch ...
 * bypasses pull request review" — is simply false for ccb: ccb is
 * solo-maintained, its documented release flow IS commit + push directly to
 * main, and there is no PR-review gate. Left uncorrected, the classifier (a
 * separate LLM that never sees CYBER_RISK_INSTRUCTION) blocks the operator's
 * normal release workflow, and latches onto a blocked push to also block
 * subsequent READ-ONLY git (`git fetch`/`status`/`rev-parse`).
 *
 * buildSessionContextLines (yoloSystemPrompt.ts) corrects this in CODE — not
 * in the upstream-synced .txt templates — by appending operator-model facts
 * to the classifier's Session Context block. These assertions pin that the
 * correction is present and correctly SCOPED, so a future edit can't silently
 * drop it OR widen it into a real-exfil loophole.
 *
 * Text-presence, not behavioural (the classifier decision is an LLM call —
 * see feedback_llm_bugs_no_unit_test). What we lock is that the facts the
 * model reads are still there and still scoped.
 */
describe('classifier Session Context — ccb operator model', () => {
  async function sessionContextText(): Promise<string> {
    const { sessionContextBlocks } = await buildYoloSystemPrompt(
      getEmptyToolPermissionContext(),
    )
    return sessionContextBlocks.map(b => b.text).join('\n')
  }

  test('declares the single-operator, self-hosted model', async () => {
    const text = await sessionContextText()
    expect(text).toContain('Operator model')
    expect(text).toMatch(/self-hosted|single-operator|solo/i)
    // The whole point: NOT a shared/multi-tenant environment.
    expect(text).toMatch(/NOT a shared|multi-tenant/i)
  })

  test('authorizes default-branch push as the normal release flow', async () => {
    const text = await sessionContextText()
    expect(text).toContain('Release flow')
    expect(text).toMatch(/default[ -]branch/i)
    // Must explicitly neutralize the upstream "Git Push to Default Branch"
    // soft block — otherwise the rule still fires.
    expect(text).toContain('Git Push to Default Branch')
  })

  test('keeps default-branch authorization SCOPED — does not open an exfil hole', async () => {
    const text = await sessionContextText()
    // The authorization must stay scoped to the working-dir repo's own remote.
    // Pushing to an OUTSIDE repo must remain Data Exfiltration (hard block),
    // and destructive git must remain blocked. If a future edit drops these
    // qualifiers, this test fails — the scope is the safety boundary.
    expect(text).toMatch(/own remote|working-dir repo/i)
    expect(text).toContain('Data Exfiltration')
    expect(text).toMatch(/force-push|Git Destructive/i)
  })

  test('marks read-only git as never security-relevant', async () => {
    const text = await sessionContextText()
    expect(text).toMatch(/Read-only git|read-only \/|fetch-only/i)
    expect(text).toContain('git status')
    expect(text).toContain('git fetch')
    // The context-poisoning guard: a prior blocked push must not turn a later
    // read-only query into a "retry".
    expect(text).toMatch(/prior blocked push|not make a later read-only/i)
  })
})
