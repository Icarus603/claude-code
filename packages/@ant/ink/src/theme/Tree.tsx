import React, { Children, createContext, isValidElement, useContext } from 'react'
import Box from './ThemedBox.js'
import Text from './ThemedText.js'
import type { Color } from '../core/styles.js'
import type { Theme } from './theme-types.js'

/**
 * Tree component — `├ │ └` connectors auto-rendered from React Context.
 *
 * Mirrors upstream `M7` from Anthropic's Claude Code CLI (v2.1.128 reference:
 * `bun-demincer/work/claude-code-2.1.128/resplit/3602.js` + `3603.js`).
 *
 * Usage:
 *   <Tree>
 *     <Tree.Node label="root">
 *       <Tree.Node label="child A" />
 *       <Tree.Node label="child B">
 *         <Tree.Node label="grandchild" />
 *       </Tree.Node>
 *     </Tree.Node>
 *   </Tree>
 *
 * Two variants:
 * - 'outline' (default): every node renders with last-style connectors
 *   (`└` only, no `│ ├` continuation). Looks like a flat indented list.
 * - 'tree': proper tree with continuation pipes — `├` for middle siblings,
 *   `└` for the final sibling, `│` running through ancestors of middle
 *   siblings, blank space below the final sibling.
 */

const CONNECTOR_GLYPHS = {
  branch: '├',
  last: '└',
  pipe: '│',
  space: '',
} as const

type Connector = keyof typeof CONNECTOR_GLYPHS

type TreeContextValue = {
  variant: 'outline' | 'tree'
  ancestors: Connector[]
}

const TreeContext = createContext<TreeContextValue>({
  variant: 'outline',
  ancestors: [],
})

// Children of the same parent share an "is-last" signal so siblings know
// whether they're the final sibling (drives `last` vs `branch` connector).
const IsLastSiblingContext = createContext<boolean>(true)

/** Wrap each child with IsLastSiblingContext so they know their position. */
function wrapSiblings(children: React.ReactNode, propagate = true): React.ReactNode[] {
  const arr = Children.toArray(children)
  return arr.map((child, i) => (
    <IsLastSiblingContext.Provider key={i} value={propagate && i === arr.length - 1}>
      {child}
    </IsLastSiblingContext.Provider>
  ))
}

/**
 * The horizontal connector line for a Tree.Node row. Renders the ancestor
 * pipes in the same column as the parent's connector glyph, then the node's
 * own connector (`├` or `└`), then the node's content.
 *
 * Uses `noSelect="from-left-edge"` so click-drag selection over multi-row
 * tree content doesn't pick up the leading whitespace from intermediate
 * rows — same trick as upstream's `<Of fromLeftEdge>` wrapper.
 */
function TreeBranchLine({
  connectors,
  children,
}: {
  connectors: Connector[]
  children: React.ReactNode
}): React.ReactNode {
  return (
    <Box flexDirection="row">
      {connectors.length > 0 && (
        <Box
          flexDirection="row"
          flexShrink={0}
          alignSelf="stretch"
          noSelect="from-left-edge"
        >
          {connectors.map((c, i) => (
            <Box key={i} width={2}>
              <Text dimColor>{CONNECTOR_GLYPHS[c]}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box flexGrow={1} flexShrink={1}>
        {children}
      </Box>
    </Box>
  )
}

type TreeProps = {
  variant?: 'outline' | 'tree'
  children?: React.ReactNode
}

/** Tree wrapper. Defaults to `outline` variant; pass `variant="tree"` for connectors. */
function Tree({ children, variant = 'outline' }: TreeProps): React.ReactNode {
  return (
    <TreeContext.Provider value={{ variant, ancestors: [] }}>
      <Box flexDirection="column">{wrapSiblings(children)}</Box>
    </TreeContext.Provider>
  )
}

type TreeNodeProps = {
  /**
   * Inline label rendered on this node's row. If present, `children`
   * is treated as nested tree content (next-level Tree.Nodes).
   * If absent, `children` IS the row content.
   */
  label?: React.ReactNode
  color?: keyof Theme | Color
  dimColor?: boolean
  children?: React.ReactNode
}

/** A single tree node. Use `label` for inline content + nested children, or omit for raw row content. */
function TreeNode({
  label,
  children,
  dimColor,
  color,
}: TreeNodeProps): React.ReactNode {
  const { variant, ancestors } = useContext(TreeContext)
  const isLastSibling = useContext(IsLastSiblingContext)

  // Outline variant uses `last` everywhere (no continuation pipes); tree
  // variant uses `last` for the final sibling, `branch` for middle ones.
  const ownConnector: Connector =
    variant === 'outline' ? 'last' : isLastSibling ? 'last' : 'branch'
  // Below this node, the descendant column should be blank (after `last`)
  // or a continuation pipe (after `branch`). Outline always uses blank.
  const descendantColumn: Connector =
    variant === 'outline' ? 'space' : isLastSibling ? 'space' : 'pipe'

  const hasLabel = label != null && label !== false
  const rowContent = hasLabel ? label : children

  const renderedRowContent = isValidElement(rowContent) ? (
    rowContent
  ) : (
    <Text dimColor={dimColor} color={color}>
      {rowContent}
    </Text>
  )

  const rowConnectors = [...ancestors, ownConnector]

  return (
    <Box flexDirection="column">
      <TreeBranchLine connectors={rowConnectors}>
        {renderedRowContent}
      </TreeBranchLine>
      {hasLabel && children && (
        <TreeContext.Provider
          value={{ variant, ancestors: [...ancestors, descendantColumn] }}
        >
          {wrapSiblings(children)}
        </TreeContext.Provider>
      )}
    </Box>
  )
}

/**
 * Group siblings without producing a connector row. The group itself
 * is invisible — its children inherit the parent's last-sibling context
 * so connector logic still works.
 *
 * Useful when you have e.g. <Tree><Group>{conditional1}{conditional2}</Group><FixedNode/></Tree>
 * and want the conditional set to be treated as siblings of FixedNode.
 */
function TreeGroup({ children }: { children?: React.ReactNode }): React.ReactNode {
  const isLastSibling = useContext(IsLastSiblingContext)
  return <>{wrapSiblings(children, isLastSibling)}</>
}

const TreeWithStatics = Object.assign(Tree, {
  Node: TreeNode,
  Group: TreeGroup,
})

export { TreeWithStatics as Tree }
export type { TreeProps, TreeNodeProps }
