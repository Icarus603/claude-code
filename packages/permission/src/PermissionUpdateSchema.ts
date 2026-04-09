import z from 'zod/v4'
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from '@cc-app/types/permissions.js'
import { lazySchema } from '@cc-app/utils/lazySchema.js'
import { externalPermissionModeSchema } from './PermissionMode.js'
import {
  permissionBehaviorSchema,
  permissionRuleValueSchema,
} from './PermissionRule.js'

export type { PermissionUpdate, PermissionUpdateDestination }

export const permissionUpdateDestinationSchema = lazySchema(() =>
  z.enum([
    'userSettings',
    'projectSettings',
    'localSettings',
    'session',
    'cliArg',
  ]),
)

export const permissionUpdateSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('addRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('replaceRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeRules'),
      rules: z.array(permissionRuleValueSchema()),
      behavior: permissionBehaviorSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('setMode'),
      mode: externalPermissionModeSchema(),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('addDirectories'),
      directories: z.array(z.string()),
      destination: permissionUpdateDestinationSchema(),
    }),
    z.object({
      type: z.literal('removeDirectories'),
      directories: z.array(z.string()),
      destination: permissionUpdateDestinationSchema(),
    }),
  ]),
)
