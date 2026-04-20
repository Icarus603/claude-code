// Canonical owner is @claude-code/app-host/bootstrap/cwd.js. This re-export
// exists only for src/* consumers that have not been migrated yet; packages/*
// must import from the canonical path (enforced by V7 §11.2).
export {
  getCwd,
  pwd,
  runWithCwdOverride,
} from '@claude-code/app-host/bootstrap/cwd.js'
