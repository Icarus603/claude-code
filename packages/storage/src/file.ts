// Thin alias — canonical owner is src/utils/file.ts. File I/O helpers use
// fsOperations + cwd singletons; route packages/* through this alias.
// eslint-disable-next-line no-restricted-imports
export * from 'src/utils/file.js'
