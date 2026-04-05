/**
 * Application type dispatcher for Windows Computer Use.
 *
 * Routes operations to the appropriate controller based on file type:
 * - .xlsx/.xls/.csv → Excel COM (headless, no window)
 * - .docx/.doc      → Word COM (headless, no window)
 * - .txt/.log/.md   → notepad + SendMessage + HWND bind (offscreen)
 * - Others          → generic exe + HWND bind (offscreen)
 */

import { extname } from 'path'

export type AppType = 'excel' | 'word' | 'text' | 'browser' | 'generic'

const EXCEL_EXTS = new Set(['.xlsx', '.xls', '.csv', '.xlsm', '.xlsb'])
const WORD_EXTS = new Set(['.docx', '.doc', '.rtf'])
const TEXT_EXTS = new Set([
  '.txt',
  '.log',
  '.md',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.ini',
  '.cfg',
  '.conf',
])
const BROWSER_NAMES = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera'])

/**
 * Detect application type from file path or app name.
 */
export function detectAppType(nameOrPath: string): AppType {
  const lower = nameOrPath.toLowerCase()

  // Check by extension
  const ext = extname(lower)
  if (ext) {
    if (EXCEL_EXTS.has(ext)) return 'excel'
    if (WORD_EXTS.has(ext)) return 'word'
    if (TEXT_EXTS.has(ext)) return 'text'
  }

  // Check by app name
  const baseName =
    lower
      .replace(/\.exe$/, '')
      .split(/[/\\]/)
      .pop() ?? ''
  if (baseName === 'excel' || baseName.includes('excel')) return 'excel'
  if (
    baseName === 'winword' ||
    baseName === 'word' ||
    baseName.includes('word')
  )
    return 'word'
  if (baseName === 'notepad' || baseName === 'notepad++' || baseName === 'code')
    return 'text'
  if (BROWSER_NAMES.has(baseName)) return 'browser'

  return 'generic'
}

export interface OpenResult {
  type: AppType
  /** HWND for text/browser/generic apps (SendMessage target) */
  hwnd?: string
  /** File path for COM-controlled apps (Excel/Word) */
  filePath?: string
}

/**
 * Open a file or app with the appropriate controller.
 *
 * - Excel/Word: COM automation (no window, no HWND needed)
 * - Text/Browser/Generic: exe launch + offscreen HWND bind
 *
 * Returns the app type and either HWND or file path for subsequent operations.
 */
export async function openWithController(
  nameOrPath: string,
): Promise<OpenResult> {
  const type = detectAppType(nameOrPath)

  switch (type) {
    case 'excel': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createExcel, openExcel } =
        require('./comExcel.js') as typeof import('./comExcel.js')
      const isExisting = nameOrPath.match(/\.(xlsx|xls|csv|xlsm|xlsb)$/i)
      if (isExisting) {
        // Open existing file — just verify it's readable
        try {
          openExcel(nameOrPath)
          return { type: 'excel', filePath: nameOrPath }
        } catch {
          return { type: 'excel', filePath: nameOrPath }
        }
      }
      // "excel" or "excel.exe" without a file — create new
      const tmpPath = `${process.env.TEMP || '/tmp'}\\cu_new_${Date.now()}.xlsx`
      createExcel(tmpPath)
      return { type: 'excel', filePath: tmpPath }
    }

    case 'word': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createWord, openWord } =
        require('./comWord.js') as typeof import('./comWord.js')
      const isExisting = nameOrPath.match(/\.(docx|doc|rtf)$/i)
      if (isExisting) {
        try {
          openWord(nameOrPath)
          return { type: 'word', filePath: nameOrPath }
        } catch {
          return { type: 'word', filePath: nameOrPath }
        }
      }
      const tmpPath = `${process.env.TEMP || '/tmp'}\\cu_new_${Date.now()}.docx`
      createWord(tmpPath)
      return { type: 'word', filePath: tmpPath }
    }

    default:
      // text/browser/generic — HWND bind handled by caller (platforms/win32.ts open())
      return { type }
  }
}
