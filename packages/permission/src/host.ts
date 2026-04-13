import type { PermissionHostBindings } from './contracts.js'
import { HostBindingsError } from './errors.js'

let permissionHostBindings: PermissionHostBindings | null = null

export function installPermissionHostBindings(
  bindings: PermissionHostBindings,
): void {
  permissionHostBindings = bindings
}

export function getPermissionHostBindings(): PermissionHostBindings {
  if (!permissionHostBindings) {
    throw new HostBindingsError(
      'Permission host bindings have not been installed. Install host bindings before using @claude-code/permission runtime APIs.',
    )
  }
  return permissionHostBindings
}
