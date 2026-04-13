/**
 * Team Memory Sync types, moved from app-compat/services/teamMemorySync/types.ts
 * into the memory package (the canonical owner of team memory logic).
 *
 * V7 §8 — memory cannot import from app-compat. These types
 * were previously imported across the boundary; now they live here.
 */

import { z } from 'zod/v4'

function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}

export const TeamMemoryContentSchema = lazySchema(() =>
  z.object({
    entries: z.record(z.string(), z.string()),
    entryChecksums: z.record(z.string(), z.string()).optional(),
  }),
)

export const TeamMemoryDataSchema = lazySchema(() =>
  z.object({
    organizationId: z.string(),
    repo: z.string(),
    version: z.number(),
    lastModified: z.string(),
    checksum: z.string(),
    content: TeamMemoryContentSchema(),
  }),
)

export const TeamMemoryTooManyEntriesSchema = lazySchema(() =>
  z.object({
    error: z.object({
      details: z.object({
        error_code: z.literal('team_memory_too_many_entries'),
        max_entries: z.number().int().positive(),
        received_entries: z.number().int().positive(),
      }),
    }),
  }),
)

export type TeamMemoryData = z.infer<ReturnType<typeof TeamMemoryDataSchema>>

export type SkippedSecretFile = {
  path: string
  ruleId: string
  label: string
}

export type TeamMemorySyncFetchResult = {
  success: boolean
  data?: TeamMemoryData
  isEmpty?: boolean
  notModified?: boolean
  checksum?: string
  error?: string
  skipRetry?: boolean
  errorType?: 'auth' | 'timeout' | 'network' | 'parse' | 'unknown'
  httpStatus?: number
}

export type TeamMemoryHashesResult = {
  success: boolean
  version?: number
  checksum?: string
  entryChecksums?: Record<string, string>
  error?: string
  errorType?: 'auth' | 'timeout' | 'network' | 'parse' | 'unknown'
  httpStatus?: number
}

export type TeamMemorySyncPushResult = {
  success: boolean
  filesUploaded: number
  checksum?: string
  conflict?: boolean
  error?: string
  skippedSecrets?: SkippedSecretFile[]
  errorType?:
    | 'auth'
    | 'timeout'
    | 'network'
    | 'conflict'
    | 'unknown'
    | 'no_oauth'
    | 'no_repo'
  httpStatus?: number
}

export type TeamMemorySyncUploadResult = {
  success: boolean
  checksum?: string
  lastModified?: string
  conflict?: boolean
  error?: string
  errorType?: 'auth' | 'timeout' | 'network' | 'unknown'
  httpStatus?: number
  serverErrorCode?: 'team_memory_too_many_entries'
  serverMaxEntries?: number
  serverReceivedEntries?: number
}
