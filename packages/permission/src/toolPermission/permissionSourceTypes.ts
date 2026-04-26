// Leaf type module: holds the approval/rejection source unions shared
// between PermissionContext.ts and permissionLogging.ts. Extracted to
// break the PermissionContext ↔ permissionLogging cycle (PermissionContext
// imports logPermissionDecision, permissionLogging needs the source types
// to type the log payload).

export type PermissionApprovalSource =
  | { type: 'hook'; permanent?: boolean }
  | { type: 'user'; permanent: boolean }
  | { type: 'classifier' }

export type PermissionRejectionSource =
  | { type: 'hook' }
  | { type: 'user_abort' }
  | { type: 'user_reject'; hasFeedback: boolean }
