// V7 §11.4 canonical move: PermissionTypes are owned by ../permissionTypes.js.
// This file remains as a stable internal import path for the 7+ files
// inside packages/permission/ that still use './types/permissions.js'.
// Both files were byte-identical until 2026-04-29 — divergence is a real
// hazard since PermissionMode shape changes need to land in lockstep.
// Thin re-export preserves the import paths while collapsing the source.
export * from '../permissionTypes.js'
