# Project history and engineering claim

Claude Code Best (`ccb`) began as a source-reconstruction effort and became a
solo-maintained, multi-provider terminal agent with its own architecture,
quality gates, release system, and upstream-evidence pipeline. The defensible
claim is the engineering process recorded in code and history—not authorship
of Anthropic's original product.

## 1. Reconstruction baseline — 2026-03-31 to 2026-04-04

The initial community project reconstructed a monorepo from the Claude Code
2.1.88 npm sourcemap. Early commits restored package boundaries, dependencies,
buildability, native interfaces, tests, linting, and CI. Contributors from the
earlier `claude-code-best` repository remain credited in Git history.

## 2. Solo hand-off and architectural refactor — from 2026-04-05

Icarus603 assumed sole maintenance and turned the recovered tree into an
independently governed system. The repository now uses explicit owner
packages, dependency-boundary checks, type and silent-failure ratchets,
thousands of behavioral tests, smoke tests, and a standalone cross-platform
release path. Multi-provider routing covers Anthropic, compatible endpoints,
OpenAI-compatible APIs, ChatGPT Codex OAuth, and Gemini while preserving one
agent loop.

## 3. Automated upstream evidence loop — from 2026-05-09

The `bun-demincer` reverse-engineering project was folded into the monorepo as
a vendored fork. A launchd-driven workflow detects new locally installed
Claude Code binaries, decodes their embedded Bun modules, transfers
cross-version artifacts, computes structural deltas, and invokes a ccb agent
for structured semantic reports. Ports remain reviewable commits with tests;
the automation produces evidence rather than self-modifying the product.

The pipeline now exposes authentication failures, preserves failed-run
metadata, continues collecting pair-level diagnostics, and returns a non-zero
aggregate status. This closes a previous observability bug where Bash's `!`
operator converted a real ccb failure into an apparent exit code 0.

## 4. Current compatibility and release discipline

Selected upstream behavior has been ported and verified through Claude Code
2.1.207. Structural decoding and deltas also reach 2.1.207, while complete
autonomous semantic reports currently reach 2.1.158; the remaining interval is
recorded as a backlog rather than hidden behind a single “compatible” label.

Tagged releases build five standalone binaries, validate exact release source,
publish SHA-256 sidecars and a CycloneDX SBOM, and create GitHub/Sigstore
provenance and SBOM attestations. CI performs native boot checks on macOS,
Linux, and Windows. Nightly drift checks fail visibly, maintain one sticky
issue, and close it after recovery.

## What this demonstrates

For an engineering or financial-technology application, the strongest signal
is systems ownership under uncertainty: reconstructing an undocumented system,
separating evidence states, designing regression and supply-chain controls,
handling multiple authentication and provider protocols, and operating an
automated update loop without allowing it to silently publish unverified
changes. The repository should be presented with its attribution and rights
limits intact.
