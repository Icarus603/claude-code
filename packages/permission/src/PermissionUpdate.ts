import { posix } from 'path'
import type { ToolPermissionContext } from '../../../src/Tool.js'
import type {
  AdditionalWorkingDirectory,
  WorkingDirectorySource,
} from '../../../src/types/permissions.js'
import { logForDebugging } from '../../../src/utils/debug.js'
import type { EditableSettingSource } from '../../../src/utils/settings/constants.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../../src/utils/settings/settings.js'
import { jsonStringify } from '../../../src/utils/slowOperations.js'
import { addPermissionRulesToSettings } from '../../../src/utils/permissions/permissionsLoader.js'
import { toPosixPath } from './filesystem.js'
import type { PermissionRuleValue } from './PermissionRule.js'
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from './PermissionUpdateSchema.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'

export type { AdditionalWorkingDirectory, WorkingDirectorySource }

export function extractRules(
  updates: PermissionUpdate[] | undefined,
): PermissionRuleValue[] {
  if (!updates) return []

  return updates.flatMap(update => {
    switch (update.type) {
      case 'addRules':
        return update.rules
      default:
        return []
    }
  })
}

export function hasRules(updates: PermissionUpdate[] | undefined): boolean {
  return extractRules(updates).length > 0
}

export function applyPermissionUpdate(
  context: ToolPermissionContext,
  update: PermissionUpdate,
): ToolPermissionContext {
  switch (update.type) {
    case 'setMode':
      logForDebugging(
        `Applying permission update: Setting mode to '${update.mode}'`,
      )
      return {
        ...context,
        mode: update.mode,
      }

    case 'addRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Adding ${update.rules.length} ${update.behavior} rule(s) to destination '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: [
            ...(context[ruleKind][update.destination] || []),
            ...ruleStrings,
          ],
        },
      }
    }

    case 'replaceRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Replacing all ${update.behavior} rules for destination '${update.destination}' with ${update.rules.length} rule(s): ${jsonStringify(ruleStrings)}`,
      )

      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: ruleStrings,
        },
      }
    }

    case 'addDirectories': {
      logForDebugging(
        `Applying permission update: Adding ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} with destination '${update.destination}': ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.set(directory, {
          path: directory,
          source: update.destination,
        })
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    case 'removeRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Removing ${update.rules.length} ${update.behavior} rule(s) from source '${update.destination}': ${jsonStringify(ruleStrings)}`,
      )

      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      const existingRules = context[ruleKind][update.destination] || []
      const rulesToRemove = new Set(ruleStrings)
      const filteredRules = existingRules.filter(
        rule => !rulesToRemove.has(rule),
      )

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: filteredRules,
        },
      }
    }

    case 'removeDirectories': {
      logForDebugging(
        `Applying permission update: Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'}: ${jsonStringify(update.directories)}`,
      )
      const newAdditionalDirs = new Map(context.additionalWorkingDirectories)
      for (const directory of update.directories) {
        newAdditionalDirs.delete(directory)
      }
      return {
        ...context,
        additionalWorkingDirectories: newAdditionalDirs,
      }
    }

    default:
      return context
  }
}

export function applyPermissionUpdates(
  context: ToolPermissionContext,
  updates: PermissionUpdate[],
): ToolPermissionContext {
  let updatedContext = context
  for (const update of updates) {
    updatedContext = applyPermissionUpdate(updatedContext, update)
  }
  return updatedContext
}

export function supportsPersistence(
  destination: PermissionUpdateDestination,
): destination is EditableSettingSource {
  return (
    destination === 'localSettings' ||
    destination === 'userSettings' ||
    destination === 'projectSettings'
  )
}

export function persistPermissionUpdate(update: PermissionUpdate): void {
  if (!supportsPersistence(update.destination)) return

  logForDebugging(
    `Persisting permission update: ${update.type} to source '${update.destination}'`,
  )

  switch (update.type) {
    case 'addRules': {
      addPermissionRulesToSettings(
        {
          ruleValues: update.rules,
          ruleBehavior: update.behavior,
        },
        update.destination,
      )
      break
    }

    case 'addDirectories': {
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []
      const dirsToAdd = update.directories.filter(
        dir => !existingDirs.includes(dir),
      )
      if (dirsToAdd.length > 0) {
        updateSettingsForSource(update.destination, {
          permissions: {
            additionalDirectories: [...existingDirs, ...dirsToAdd],
          },
        })
      }
      break
    }

    case 'removeRules': {
      const existingSettings = getSettingsForSource(update.destination)
      const existingPermissions = existingSettings?.permissions || {}
      const existingRules = existingPermissions[update.behavior] || []
      const rulesToRemove = new Set(
        update.rules.map(permissionRuleValueToString),
      )
      const filteredRules = existingRules.filter(rule => {
        const normalized = permissionRuleValueToString(
          permissionRuleValueFromString(rule),
        )
        return !rulesToRemove.has(normalized)
      })

      updateSettingsForSource(update.destination, {
        permissions: {
          [update.behavior]: filteredRules,
        },
      })
      break
    }

    case 'removeDirectories': {
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []
      const dirsToRemove = new Set(update.directories)
      const filteredDirs = existingDirs.filter(dir => !dirsToRemove.has(dir))

      updateSettingsForSource(update.destination, {
        permissions: {
          additionalDirectories: filteredDirs,
        },
      })
      break
    }

    case 'setMode': {
      updateSettingsForSource(update.destination, {
        permissions: {
          defaultMode: update.mode,
        },
      })
      break
    }

    case 'replaceRules': {
      updateSettingsForSource(update.destination, {
        permissions: {
          [update.behavior]: update.rules.map(permissionRuleValueToString),
        },
      })
      break
    }
  }
}

export function persistPermissionUpdates(updates: PermissionUpdate[]): void {
  for (const update of updates) {
    persistPermissionUpdate(update)
  }
}

export function createReadRuleSuggestion(
  dirPath: string,
  destination: PermissionUpdateDestination = 'session',
): PermissionUpdate | undefined {
  const pathForPattern = toPosixPath(dirPath)
  if (pathForPattern === '/') {
    return undefined
  }

  const ruleContent = posix.isAbsolute(pathForPattern)
    ? `/${pathForPattern}/**`
    : `${pathForPattern}/**`

  return {
    type: 'addRules',
    rules: [
      {
        toolName: 'Read',
        ruleContent,
      },
    ],
    behavior: 'allow',
    destination,
  }
}
