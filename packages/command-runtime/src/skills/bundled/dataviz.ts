import { registerBundledSkill } from '../bundledSkills.js'

const PROMPT = `# Data visualization

Design or review a chart, dashboard, or quantitative report. Begin with the decision the visual must support, then choose the smallest chart that exposes the relevant comparison, trend, distribution, or relationship.

Use source-backed labels and units. Preserve zero when bar length encodes magnitude, avoid dual axes unless the scales are inseparable, and show uncertainty or missingness when it changes interpretation. Keep color semantic and sparse: one neutral series, one emphasis color, and stable colors for repeated categories. Verify contrast and do not rely on hue alone.

For dashboards, establish a reading order: outcome metrics first, drivers second, diagnostics last. Every KPI needs a definition, time window, comparison baseline, and data freshness. Prefer direct labels over legends and remove decoration that does not carry information.

The bundled references include a runnable palette validator. Use it when proposing or accepting a palette. Return the visual specification, the rationale, accessibility notes, and any data caveats.
`

const VALIDATOR = `#!/usr/bin/env node
const colors = process.argv.slice(2)
if (colors.length < 2) {
  process.stderr.write('usage: node validate-palette.mjs <#hex> <#hex> [...]\\n')
  process.exit(2)
}
const rgb = h => {
  if (!/^#[0-9a-f]{6}$/i.test(h)) throw new Error('invalid color: ' + h)
  return [1,3,5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
}
const lum = h => rgb(h).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((s, v, i) => s + v * [.2126,.7152,.0722][i], 0)
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05)
let failed = false
for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
  const ratio = contrast(colors[i], colors[j])
  process.stdout.write(colors[i] + ' ' + colors[j] + ' ' + ratio.toFixed(2) + '\\n')
  if (ratio < 3) failed = true
}
process.exitCode = failed ? 1 : 0
`

export function registerDatavizSkill(): void {
  registerBundledSkill({
    name: 'dataviz',
    description:
      'Design and review accessible charts, dashboards, and quantitative reports.',
    argumentHint: '[visualization goal or artifact]',
    userInvocable: true,
    files: { 'validate-palette.mjs': VALIDATOR },
    async getPromptForCommand(args) {
      return [
        {
          type: 'text',
          text: `${PROMPT}${args ? `\n\n## Current request\n\n${args}` : ''}`,
        },
      ]
    },
  })
}
