/**
 * Native Installer - Public API
 *
 * Barrel file exporting only the functions used by external consumers.
 */
export {
  checkInstall,
  cleanupNpmInstallations,
  cleanupOldVersions,
  cleanupShellAliases,
  installLatest,
  lockCurrentVersion,
  removeInstalledSymlink,
  type SetupMessage,
} from './installer.js'
