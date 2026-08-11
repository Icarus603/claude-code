## Attribution

This repository is a public, solo-maintained derivative of Anthropic's
Claude Code. It is **not** affiliated with Anthropic.

### Lineage

- **Baseline** — reconstructed from the Claude Code v2.1.88 npm sourcemap
  published 2026-03-31. Initial commits in this repository (2026-03-31 →
  2026-04-04) preserved that reconstructed source under the `claude-code-best`
  community fork.
- **Hand-off** — solo maintenance by [@Icarus603](https://github.com/Icarus603)
  from 2026-04-05 onward. Earlier `claude-code-best` contributors authored
  commits visible in `git log` but no longer participate in development.
- **Today** — independent roadmap with an automated evidence pipeline. The
  vendored `bun-demincer` decodes locally installed upstream binaries, creates
  structural deltas, and can ask a logged-in ccb agent for semantic reports.
  Those artifacts inform human-selected ports; they never merge or publish
  upstream code automatically. Releases, refactor direction, and feature
  decisions remain owned by this repository. Distribution is binary-only
  (no npm).

### Licensing

- This repository does **not** declare a `LICENSE` file and its root package is
  marked `UNLICENSED`.
- The Claude Code npm package whose sourcemap was used as the baseline does
  not expose license metadata via the GitHub repository API.
- Treat redistribution and downstream reuse as requiring manual rights
  review until and unless a clear license is added.
- The vendored `bun-demincer` fork also traces to a repository with no
  declared license. Its previous README footer saying `MIT` was not supported
  by an upstream license file and has been removed.

Public visibility is not a grant of reuse rights. GitHub's licensing guidance
explains that repositories without a license remain under default copyright
rules. This file records provenance and risk; it is not legal advice or a
substitute for review by a qualified professional.

### Contributing

PRs are welcome but reviewed by one maintainer at human pace. There is no
SLA, no triage rotation, and no roadmap commitment to external requests.
