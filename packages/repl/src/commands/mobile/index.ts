import type { Command } from '@claude-code/command-runtime/runtime'

const mobile = {
  type: 'local-jsx',
  name: 'mobile',
  aliases: ['ios', 'android'],
  description: 'Show QR code to download the Claude mobile app',
  load: () => import('./mobile.js'),
} satisfies Command

export default mobile
