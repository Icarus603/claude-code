# Release security

Every tagged release builds five standalone binaries from the tagged commit,
publishes SHA-256 sidecars, generates a CycloneDX SBOM from `bun.lock`, and
asks GitHub Actions to create Sigstore-backed provenance plus an SBOM
attestation. Consumers can verify a downloaded binary with:

```sh
shasum -a 256 -c ccb-darwin-arm64.sha256
gh attestation verify ccb-darwin-arm64 -R Icarus603/claude-code
```

Checksums detect corruption and support the updater's atomic swap. The GitHub
attestation links an artifact to its repository, commit, workflow and build
identity; it does not claim that the source is vulnerability-free. The SBOM
enumerates registry packages locked into the workspace so dependency exposure
can be reviewed after publication.

GitHub Actions are pinned to full commit SHAs. Dependabot watches both npm/Bun
metadata and workflow actions, while dependency review rejects newly
introduced high- or critical-severity vulnerable packages on pull requests.

Platform-native identity signing remains credential-bound. Apple notarization
requires an Apple Developer identity and notarization credentials; Windows
Authenticode requires a code-signing certificate. Those secrets are not in
this repository, so the release currently provides cryptographic build
provenance rather than an Apple- or Microsoft-issued publisher identity. Add
native signing only through protected GitHub environments and hardware- or
cloud-backed credentials; never commit certificates or private keys.
