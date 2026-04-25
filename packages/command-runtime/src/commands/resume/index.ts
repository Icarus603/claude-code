import type { Command } from '@claude-code/command-runtime/runtime'

const resume: Command = {
  type: 'local-jsx',
  name: 'resume',
  description: 'Resume a previous conversation',
  aliases: ['continue'],
  argumentHint: '[conversation id or search term]',
  load: () => import('@claude-code/command-runtime/commands/resume/resume.js'),
}

export default resume
