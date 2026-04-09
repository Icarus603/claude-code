import type { PermissionHostBindings } from './contracts.js'

let permissionHostBindings: PermissionHostBindings | null = null

export function installPermissionHostBindings(
  bindings: PermissionHostBindings,
): void {
  permissionHostBindings = bindings
}

export function getPermissionHostBindings(): PermissionHostBindings {
  if (!permissionHostBindings) {
    throw new Error(
      'Permission host bindings have not been installed. Install host bindings before using @claude-code/permission runtime APIs.',
    )
  }
  return permissionHostBindings
}

