import { mkdir, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  BackendArtifactStore,
  FileSessionMetadataStore,
  FileTranscriptStore,
  LocalFileStorageBackend,
} from '@claude-code/storage'

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cc-storage-verify-'))
  try {
    const backend = new LocalFileStorageBackend()
    const sessionsDir = join(root, 'sessions')
    const metadataDir = join(root, 'metadata')
    const artifactsDir = join(root, 'artifacts')
    await mkdir(sessionsDir, { recursive: true })
    await mkdir(metadataDir, { recursive: true })
    await mkdir(artifactsDir, { recursive: true })

    const transcripts = new FileTranscriptStore(backend, sessionsDir)
    const sessionMetadata = new FileSessionMetadataStore(backend, metadataDir)
    const artifacts = new BackendArtifactStore(backend)

    await transcripts.appendSessionEvent(
      'session-a',
      `${JSON.stringify({ type: 'user', text: 'hello' })}\n`,
    )
    await transcripts.appendSessionEvent(
      'session-a',
      `${JSON.stringify({ type: 'assistant', text: 'world' })}\n`,
    )
    const events = await transcripts.readSessionEvents('session-a')
    if (events.length !== 2) {
      throw new Error(`Expected 2 transcript events, received ${events.length}`)
    }

    await sessionMetadata.writeSessionMetadata('session-a', {
      model: 'claude-sonnet-4-6',
    })
    const metadata = await sessionMetadata.readSessionMetadata('session-a')
    if (metadata?.model !== 'claude-sonnet-4-6') {
      throw new Error('Session metadata store returned unexpected content')
    }

    const artifactPath = join(artifactsDir, 'artifact.txt')
    await artifacts.writeArtifact(artifactPath, 'artifact-ok')
    const artifact = await artifacts.readArtifact(artifactPath)
    const text =
      typeof artifact === 'string' ? artifact : Buffer.from(artifact ?? '').toString('utf8')
    if (text !== 'artifact-ok') {
      throw new Error('Artifact store returned unexpected content')
    }

    console.log('storage contracts verification passed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

await main()
