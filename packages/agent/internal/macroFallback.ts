import { readEnv } from '@claude-code/config/env'

if (typeof globalThis.MACRO === 'undefined') {
  ;(globalThis as typeof globalThis & { MACRO: typeof MACRO }).MACRO = {
    VERSION: readEnv('CLAUDE_CODE_VERSION') || '1.carus.000',
    BUILD_TIME: new Date().toISOString(),
    FEEDBACK_CHANNEL: '',
    ISSUES_EXPLAINER: '',
    NATIVE_PACKAGE_URL: '',
    PACKAGE_URL: '',
    VERSION_CHANGELOG: '',
  }
}

export {}
