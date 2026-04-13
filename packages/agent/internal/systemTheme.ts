type SystemTheme = 'dark' | 'light'

let cachedSystemTheme: SystemTheme | undefined

export function resolveThemeSetting(setting: string): string {
  if (setting === 'auto') {
    return getSystemThemeName()
  }
  return setting
}

function getSystemThemeName(): SystemTheme {
  if (cachedSystemTheme === undefined) {
    cachedSystemTheme = detectFromColorFgBg() ?? 'dark'
  }
  return cachedSystemTheme
}

function detectFromColorFgBg(): SystemTheme | undefined {
  const colorfgbg = process.env.COLORFGBG
  if (!colorfgbg) return undefined
  const parts = colorfgbg.split(';')
  const bg = parts[parts.length - 1]
  if (bg === undefined || bg === '') return undefined
  const bgNum = Number(bg)
  if (!Number.isInteger(bgNum) || bgNum < 0 || bgNum > 15) return undefined
  return bgNum <= 6 || bgNum === 8 ? 'dark' : 'light'
}
