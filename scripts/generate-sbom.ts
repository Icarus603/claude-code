#!/usr/bin/env bun
/** Generate a CycloneDX 1.6 SBOM directly from Bun's text lockfile. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parse } from 'jsonc-parser'

type LockPackage = [
  locator: string,
  tarball?: string,
  metadata?: Record<string, unknown>,
  integrity?: string,
]

type BunLock = {
  packages?: Record<string, LockPackage>
}

function splitLocator(locator: string): { name: string; version: string } {
  const separator = locator.lastIndexOf('@')
  if (separator <= 0 || separator === locator.length - 1) {
    throw new Error(`unsupported Bun lock locator: ${locator}`)
  }
  return {
    name: locator.slice(0, separator),
    version: locator.slice(separator + 1),
  }
}

function npmPurl(name: string, version: string): string {
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
}

function integrityHash(integrity?: string): { alg: string; content: string }[] {
  if (!integrity?.startsWith('sha512-')) return []
  const bytes = Buffer.from(integrity.slice('sha512-'.length), 'base64')
  return [{ alg: 'SHA-512', content: bytes.toString('hex').toUpperCase() }]
}

async function main(): Promise<void> {
  const output = resolve(process.argv[2] ?? 'dist/binaries/ccb-sbom.cdx.json')
  const source = await readFile('bun.lock', 'utf8')
  const errors: import('jsonc-parser').ParseError[] = []
  const lock = parse(source, errors, { allowTrailingComma: true }) as BunLock
  if (errors.length > 0) {
    throw new Error(`bun.lock JSONC parse failed with ${errors.length} error(s)`)
  }

  const componentByPurl = new Map<string, Record<string, unknown>>()
  for (const entry of Object.values(lock.packages ?? {})) {
    const [locator, tarball, , integrity] = entry
    const { name, version } = splitLocator(locator)
    const purl = npmPurl(name, version)
    // Bun may store several resolution keys for the same concrete package
    // version (for example, peers resolved through different parents). An
    // SBOM component is the concrete name+version, so collapse those aliases.
    if (componentByPurl.has(purl)) continue
    componentByPurl.set(purl, {
      type: 'library',
      'bom-ref': purl,
      name,
      version,
      purl,
      hashes: integrityHash(integrity),
      ...(tarball
        ? {
            externalReferences: [
              { type: 'distribution', url: tarball },
            ],
          }
        : {}),
    })
  }

  const components = [...componentByPurl.values()].sort((a, b) =>
    String(a.purl).localeCompare(String(b.purl)),
  )
  const version = process.env.CCB_RELEASE_VERSION ?? process.env.GITHUB_REF_NAME ?? 'source'
  const document = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: 'application',
        'bom-ref': `pkg:generic/ccb@${encodeURIComponent(version)}`,
        name: 'ccb',
        version,
      },
      tools: {
        components: [
          {
            type: 'application',
            name: 'ccb-lockfile-sbom-generator',
            version: '1',
          },
        ],
      },
    },
    components,
  }

  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`)
  console.log(`SBOM: ${components.length} components -> ${output}`)
}

await main()
