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
