import type { Command } from '@claude-code/command-runtime/runtime'
import {
  isVoiceGrowthBookEnabled,
  isVoiceModeEnabled,
} from '@claude-code/voice/voiceModeEnabled.js'

const voice = {
  type: 'local',
  name: 'voice',
  description: 'Toggle voice mode',
  availability: ['claude-ai'],
  isEnabled: () => isVoiceGrowthBookEnabled(),
  get isHidden() {
    return !isVoiceModeEnabled()
  },
  supportsNonInteractive: false,
  load: () => import('@claude-code/command-runtime/commands/voice/voice.js'),
} satisfies Command

export default voice
