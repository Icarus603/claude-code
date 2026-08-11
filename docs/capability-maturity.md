# Capability maturity

This repository contains two kinds of code at once: release-visible `ccb`
features and reconstruction scaffolding retained to preserve upstream module
boundaries. A source file existing in the tree is therefore not, by itself, a
claim that the capability ships.

## Release-visible and verified

The features in `scripts/default-features.ts` are compiled into normal
development and release builds. Their release claim is guarded by the full
test suite, `doctor:arch`, smoke tests, and the build/release workflows.
Background sessions, including bidirectional PTY attach for PTY-mode jobs, are
part of this surface.

## Present as gated reconstruction scaffolding

`DIRECT_CONNECT` and `SSH_REMOTE` are excluded from default builds. Their
server and SSH modules still contain transition implementations, so enabling
either flag is an engineering experiment rather than a supported release
configuration. `scripts/verify-release-capabilities.ts` prevents these flags
from entering the stable feature list until that boundary is consciously
removed.

The private workspace packages `@claude-code/headless-sdk` and
`@claude-code/server` also retain API shapes used during reconstruction. They
are not published packages and must not be presented as a standalone SDK or
server product while exported functions still throw or no-op.

## Reading status accurately

Compatibility and capability are separate axes. A decoded upstream version
means the binary was structurally recovered; an analysed version has a
semantic delta report; a ported version has selected behavior implemented;
and a verified version has passed the repository gates. See
`docs/upstream-compatibility.md` for the current version ledger.
