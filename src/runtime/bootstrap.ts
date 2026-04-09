import '../commands.js'
import '../services/api/providerHostSetup.js'
import '../services/mcp/client.js'
import '../tools.js'
import { installPackageHostBindings } from '../services/packageHostSetup.js'

let runtimeSkeletonBindingsInstalled = false

export function installRuntimeSkeletonBindings(): void {
  if (runtimeSkeletonBindingsInstalled) {
    return
  }

  installPackageHostBindings()
  runtimeSkeletonBindingsInstalled = true
}

installRuntimeSkeletonBindings()
