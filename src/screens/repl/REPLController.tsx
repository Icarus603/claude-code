import { useEffect, useMemo } from 'react'
import type { RuntimeGraph } from '@claude-code/app-host'
import type { Command } from '../../commands.js'
import type { Props as REPLViewProps } from '../REPLView.js'

export type ControlledREPLProps = REPLViewProps & {
  runtimeGraph?: RuntimeGraph
}

function toMcpSnapshot(props: ControlledREPLProps) {
  return {
    clients: props.mcpClients ?? [],
    tools: props.initialTools as unknown[],
    commands: props.commands as Command[],
    resources: {} as Record<string, unknown[]>,
  }
}

export function useReplController(
  props: ControlledREPLProps,
): REPLViewProps {
  useEffect(() => {
    if (!props.runtimeGraph) return

    props.runtimeGraph.handles.mcp.setSnapshot?.(toMcpSnapshot(props))
  }, [props])

  return useMemo(() => {
    const {
      runtimeGraph: _runtimeGraph,
      ...viewProps
    } = props
    return viewProps
  }, [props])
}
