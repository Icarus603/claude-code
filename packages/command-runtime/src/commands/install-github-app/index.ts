import type { Command } from '@claude-code/command-runtime/runtime'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { readEnv } from '@claude-code/config/env/utils'

const installGitHubApp = {
  type: 'local-jsx',
  name: 'install-github-app',
  description: 'Set up Claude GitHub Actions for a repository',
  availability: ['claude-ai', 'console'],
  isEnabled: () => !isEnvTruthy(readEnv('DISABLE_INSTALL_GITHUB_APP_COMMAND')),
  load: () => import('@claude-code/command-runtime/commands/install-github-app/install-github-app.js'),
} satisfies Command

export default installGitHubApp
