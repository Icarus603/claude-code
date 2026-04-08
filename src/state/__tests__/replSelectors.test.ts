import { describe, expect, test } from 'bun:test';
import { getDefaultAppState } from '../AppStateStore.js';
import { selectElicitation, selectMcp } from '../mcpSelectors.js';
import {
  selectPendingSandboxRequest,
  selectPendingWorkerRequest,
  selectToolPermissionContext,
  selectWorkerSandboxPermissions,
} from '../permissionSelectors.js';
import { selectAgentDefinitions, selectPlugins } from '../pluginSelectors.js';
import {
  selectInitialMessage,
  selectIsBriefOnly,
  selectRemoteSessionUrl,
  selectShowRemoteCallout,
  selectSpinnerTip,
  selectVerbose,
} from '../sessionSelectors.js';
import { selectFileHistory, selectTasks, selectViewingAgentTaskId } from '../taskSelectors.js';
import { selectTeamContext } from '../teamSelectors.js';
import {
  selectShowExpandedTodos,
  selectUltraplanLaunchPending,
  selectUltraplanPendingChoice,
} from '../uiSelectors.js';

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
