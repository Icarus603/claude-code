import { describe, expect, test } from 'bun:test'
import { npmPurl, splitLocator } from './generate-sbom'

describe('CycloneDX SBOM locators', () => {
  test('parses scoped workspace locators without splitting the workspace path', () => {
    expect(
      splitLocator(
        '@claude-code/agent@workspace:packages/agent',
      ),
    ).toEqual({
      name: '@claude-code/agent',
      version: 'workspace:packages/agent',
    })
  })

  test('preserves the scoped package separator in npm purls', () => {
    expect(npmPurl('@anthropic-ai/sdk', '0.110.0')).toBe(
      'pkg:npm/%40anthropic-ai/sdk@0.110.0',
    )
  })
})
