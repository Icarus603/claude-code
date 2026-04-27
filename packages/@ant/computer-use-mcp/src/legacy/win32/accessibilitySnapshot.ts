/**
 * Accessibility Snapshot — captures the UI Automation tree of a window
 * and formats it as compact, model-friendly text.
 *
 * Sent alongside screenshots so the model has BOTH visual + structural
 * understanding of the GUI. This enables:
 * - Knowing exact element names, types, and positions
 * - Using click_element/type_into_element by name instead of pixel coords
 * - Understanding disabled/enabled state, current values
 *
 * Only includes interactive elements (buttons, edits, menus, links, etc.)
 * to keep token count low (~200-500 tokens for typical windows).
 */

import { validateHwnd, ps } from './shared.js'

export interface AccessibilityNode {
  role: string // Button, Edit, MenuItem, Link, Text, CheckBox, etc.
  name: string // Visible text / accessible name
  automationId: string
  bounds: { x: number; y: number; w: number; h: number }
  enabled: boolean
  value?: string // Current text value (for Edit/ComboBox)
  children?: AccessibilityNode[]
}

export interface AccessibilitySnapshot {
  /** Compact text representation for the model */
  text: string
  /** Structured tree (for element-targeted actions) */
  nodes: AccessibilityNode[]
  /** Capture timestamp */
  timestamp: number
}

/**
 * Capture the accessibility tree of a window, returning only interactive
 * and visible elements. Uses Windows UI Automation (crosses process boundaries).
 *
 * @param hwnd - Window handle as string
 * @param maxDepth - Maximum tree depth (default 4)
 * @param interactiveOnly - Only include interactive elements (default true)
 */
export function captureAccessibilitySnapshot(
  hwnd: string,
  maxDepth: number = 4,
  interactiveOnly: boolean = true,
): AccessibilitySnapshot | null {
  hwnd = validateHwnd(hwnd)
  const filterClause = interactiveOnly
    ? `
    # Interactive control types only
    $interactiveTypes = @(
      'Button','Edit','ComboBox','CheckBox','RadioButton',
      'MenuItem','Menu','MenuBar','Link','Slider','Spinner',
      'Tab','TabItem','List','ListItem','Tree','TreeItem',
      'DataGrid','DataItem','Document','ScrollBar','ToolBar',
      'SplitButton','ToggleButton','Hyperlink'
    )
    function Is-Interactive($ct) {
      $typeName = $ct -replace 'ControlType\\.', ''
      return $interactiveTypes -contains $typeName
    }`
    : `
    function Is-Interactive($ct) { return $true }`

  const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase
${filterClause}

function Get-Tree($el, $depth, $maxDepth) {
    if ($depth -ge $maxDepth) { return @() }
    $result = @()
    $children = $el.FindAll(
        [System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) {
        $ct = $child.Current.ControlType.ProgrammaticName
        $typeName = $ct -replace 'ControlType\\.', ''
        $name = [string]$child.Current.Name
        $autoId = [string]$child.Current.AutomationId
        $rect = $child.Current.BoundingRectangle
        $enabled = $child.Current.IsEnabled

        # Skip invisible/offscreen elements
        if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
        if ($rect.X -lt -10000) { continue }

        $val = $null
        try {
            $vp = $child.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp -ne $null) { $val = $vp.Current.Value }
        } catch {}

        $isInteractive = Is-Interactive $ct
        $sub = Get-Tree $child ($depth + 1) $maxDepth

        if ($isInteractive -or $sub.Count -gt 0) {
            $node = @{
                role = $typeName
                name = $name
                id = $autoId
                x = [int]$rect.X; y = [int]$rect.Y
                w = [int]$rect.Width; h = [int]$rect.Height
                on = $enabled
            }
            if ($val -ne $null -and $val -ne '') { $node['v'] = $val }
            if ($sub.Count -gt 0) { $node['c'] = $sub }
            $result += $node
        }
    }
    return $result
}

try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([long]${hwnd}))
    if ($root -eq $null) { Write-Output '[]'; exit }
    $tree = Get-Tree $root 0 ${maxDepth}
    if ($tree -eq $null -or $tree.Count -eq 0) {
        Write-Output '[]'
    } else {
        $tree | ConvertTo-Json -Depth 20 -Compress
    }
} catch {
    Write-Output '[]'
}
`

  try {
    const raw = ps(script)
    if (!raw || raw === '[]') return null

    const parsed = JSON.parse(raw)
    const nodes: AccessibilityNode[] = Array.isArray(parsed)
      ? parsed.map(parseNode)
      : [parseNode(parsed)]
    const text = formatForModel(nodes)

    return { text, nodes, timestamp: Date.now() }
  } catch {
    return null
  }
}

function parseNode(raw: any): AccessibilityNode {
  return {
    role: raw.role || '',
    name: raw.name || '',
    automationId: raw.id || '',
    bounds: { x: raw.x || 0, y: raw.y || 0, w: raw.w || 0, h: raw.h || 0 },
    enabled: raw.on !== false,
    value: raw.v,
    children: raw.c
      ? Array.isArray(raw.c)
        ? raw.c.map(parseNode)
        : [parseNode(raw.c)]
      : undefined,
  }
}

/**
 * Format the accessibility tree as compact text for the model.
 * Example output:
 *   [Button] "Save" (120,50 80x30) enabled
 *   [Edit] "" (200,80 400x25) enabled value="hello world" id=textBox1
 *   [MenuItem] "File" (10,0 40x25) enabled
 */
function formatForModel(
  nodes: AccessibilityNode[],
  indent: number = 0,
): string {
  const lines: string[] = []
  const pad = '  '.repeat(indent)

  for (const node of nodes) {
    let line = `${pad}[${node.role}]`
    if (node.name) line += ` "${truncate(node.name, 40)}"`
    line += ` (${node.bounds.x},${node.bounds.y} ${node.bounds.w}x${node.bounds.h})`
    if (!node.enabled) line += ' DISABLED'
    if (node.value) line += ` value="${truncate(node.value, 30)}"`
    if (node.automationId) line += ` id=${node.automationId}`
    lines.push(line)

    if (node.children) {
      lines.push(formatForModel(node.children, indent + 1))
    }
  }

  return lines.join('\n')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * Find an element in the accessibility tree by name, role, or automationId.
 * Returns the first match.
 */
export function findNodeInSnapshot(
  nodes: AccessibilityNode[],
  query: { name?: string; role?: string; automationId?: string },
): AccessibilityNode | null {
  for (const node of nodes) {
    let match = true
    if (
      query.name &&
      !node.name.toLowerCase().includes(query.name.toLowerCase())
    )
      match = false
    if (query.role && node.role.toLowerCase() !== query.role.toLowerCase())
      match = false
    if (query.automationId && node.automationId !== query.automationId)
      match = false
    if (match && (query.name || query.role || query.automationId)) return node

    if (node.children) {
      const found = findNodeInSnapshot(node.children, query)
      if (found) return found
    }
  }
  return null
}
