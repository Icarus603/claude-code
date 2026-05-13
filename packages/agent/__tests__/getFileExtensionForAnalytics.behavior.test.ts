import { describe, expect, test } from 'bun:test'

import { getFileExtensionForAnalytics } from '../eventMetadata.ts'

/**
 * Pin getFileExtensionForAnalytics. Used for tool_use analytics —
 * partitions usage by file type. Wrong extension extraction → analytics
 * shows wrong file-type distribution.
 */
describe('getFileExtensionForAnalytics', () => {
  test('normal extension lowercased and stripped of dot', () => {
    expect(getFileExtensionForAnalytics('foo.TS')).toBe('ts')
    expect(getFileExtensionForAnalytics('/path/to/file.py')).toBe('py')
  })

  test('no extension → undefined', () => {
    expect(getFileExtensionForAnalytics('README')).toBeUndefined()
    expect(getFileExtensionForAnalytics('Makefile')).toBeUndefined()
  })

  test('dotfile WITHOUT explicit extension → undefined (e.g. ".bashrc")', () => {
    // path.extname(".bashrc") returns "" — there's no extension proper,
    // .bashrc is the whole basename. Pin this behavior.
    expect(getFileExtensionForAnalytics('.bashrc')).toBeUndefined()
    expect(getFileExtensionForAnalytics('.gitignore')).toBeUndefined()
  })

  test('dotfile WITH extension keeps the trailing ext', () => {
    // ".env.local" → ".local" → "local"
    expect(getFileExtensionForAnalytics('.env.local')).toBe('local')
  })

  test('extensions > 10 chars bucketed as "other" (cardinality limit)', () => {
    // Analytics keys with high cardinality become useless; cap at 10.
    expect(getFileExtensionForAnalytics('foo.thisisverylongextension')).toBe('other')
  })

  test('exactly 10-char extension is allowed (boundary)', () => {
    // 10-char extension stays as-is; 11 → "other".
    expect(getFileExtensionForAnalytics('foo.tenletters')).toBe('tenletters')
    expect(getFileExtensionForAnalytics('foo.elevenchars')).toBe('other')
  })

  test('lowercase normalization (Excel.XLSX → xlsx)', () => {
    expect(getFileExtensionForAnalytics('report.XLSX')).toBe('xlsx')
    expect(getFileExtensionForAnalytics('IMG.JPG')).toBe('jpg')
  })

  test('multiple dots: only LAST extension counted', () => {
    // path.extname strips everything before the last dot.
    expect(getFileExtensionForAnalytics('archive.tar.gz')).toBe('gz')
  })

  test('trailing dot → undefined (ext === "." filtered)', () => {
    expect(getFileExtensionForAnalytics('foo.')).toBeUndefined()
  })
})
