import type { ReactNode } from 'react'

export type Lesson = {
  /** Stable kebab-case id. Persisted in globalConfig.powerupsUnlocked. */
  id: string
  /** Short title shown in the lesson list and detail header. */
  title: string
  /** One-line tagline (≤ 30 chars) shown beside the title in the list. */
  tagline: string
  /** Body content rendered inside the lesson detail panel. */
  body: ReactNode
}
