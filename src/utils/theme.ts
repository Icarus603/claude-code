// Re-export theme system from @anthropic/ink
// All theme colors are defined in packages/@ant/ink/src/theme/theme-types.ts
export type {
  Theme,
  ThemeName,
  ThemeSetting,
} from '@anthropic/ink'
export {
  THEME_NAMES,
  THEME_SETTINGS,
  getTheme,
  themeColorToAnsi,
} from '@anthropic/ink'
