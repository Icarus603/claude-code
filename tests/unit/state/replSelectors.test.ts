import { beforeAll, describe, expect, test } from 'bun:test';
import { installConfigHostBindings } from '@claude-code/config';

beforeAll(() => {
  try { installConfigHostBindings({} as any) } catch { /* already installed */ }
});

import { getDefaultAppState } from '@claude-code/app-host/state/AppStateStore.js';
import { selectElicitation, selectMcp } from '@claude-code/app-host/state/mcpSelectors.js';
import {
  selectPendingSandboxRequest,
  selectPendingWorkerRequest,
  selectToolPermissionContext,
  selectWorkerSandboxPermissions,
} from '@claude-code/app-host/state/permissionSelectors.js';
import { selectAgentDefinitions, selectPlugins } from '@claude-code/app-host/state/pluginSelectors.js';
import {
  selectInitialMessage,
  selectIsBriefOnly,
  selectRemoteSessionUrl,
  selectShowRemoteCallout,
  selectSpinnerTip,
  selectVerbose,
} from '@claude-code/app-host/state/sessionSelectors.js';
import { selectFileHistory, selectTasks, selectViewingAgentTaskId } from '@claude-code/app-host/state/taskSelectors.js';
import { selectTeamContext } from '@claude-code/app-host/state/teamSelectors.js';
import {
  selectShowExpandedTodos,
  selectUltraplanLaunchPending,
  selectUltraplanPendingChoice,
} from '@claude-code/app-host/state/uiSelectors.js';

describe('REPL selectors', () => {
  test('return stable values for the same AppState snapshot', () => {
    const state = getDefaultAppState();

    const selectors = [
      selectVerbose,
      selectIsBriefOnly,
      selectInitialMessage,
      selectSpinnerTip,
      selectShowRemoteCallout,
      selectRemoteSessionUrl,
      selectToolPermissionContext,
      selectPendingWorkerRequest,
      selectPendingSandboxRequest,
      selectWorkerSandboxPermissions,
      selectMcp,
      selectElicitation,
      selectPlugins,
      selectAgentDefinitions,
      selectTasks,
      selectViewingAgentTaskId,
      selectFileHistory,
      selectTeamContext,
      selectShowExpandedTodos,
      selectUltraplanPendingChoice,
      selectUltraplanLaunchPending,
    ] as const;

    for (const selector of selectors) {
      expect(selector(state)).toBe(selector(state));
    }
  });
});
