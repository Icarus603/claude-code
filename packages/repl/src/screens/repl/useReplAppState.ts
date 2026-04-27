import { useAppState, useAppStateStore, useSetAppState } from "../../appStateHooks.js";
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

export function useReplAppState() {
	const verbose = useAppState(selectVerbose);
	const isBriefOnly = useAppState(selectIsBriefOnly);
	const initialMessage = useAppState(selectInitialMessage);
	const spinnerTip = useAppState(selectSpinnerTip);
	const showRemoteCallout = useAppState(selectShowRemoteCallout);
	const toolPermissionContext = useAppState(selectToolPermissionContext);
	const pendingWorkerRequest = useAppState(selectPendingWorkerRequest);
	const pendingSandboxRequest = useAppState(selectPendingSandboxRequest);
	const workerSandboxPermissions = useAppState(selectWorkerSandboxPermissions);
	const mcp = useAppState(selectMcp);
	const elicitation = useAppState(selectElicitation);
	const plugins = useAppState(selectPlugins);
	const agentDefinitions = useAppState(selectAgentDefinitions);
	const tasks = useAppState(selectTasks);
	const viewingAgentTaskId = useAppState(selectViewingAgentTaskId);
	const fileHistory = useAppState(selectFileHistory);
	const teamContext = useAppState(selectTeamContext);
	const showExpandedTodos = useAppState(selectShowExpandedTodos);
	const ultraplanPendingChoice = useAppState(selectUltraplanPendingChoice);
	const ultraplanLaunchPending = useAppState(selectUltraplanLaunchPending);
	const setAppState = useSetAppState();
	const store = useAppStateStore();

	return {
		verbose,
		isBriefOnly,
		initialMessage,
		spinnerTip,
		showRemoteCallout,
		toolPermissionContext,
		pendingWorkerRequest,
		pendingSandboxRequest,
		workerSandboxPermissions,
		mcp,
		elicitation,
		plugins,
		agentDefinitions,
		tasks,
		viewingAgentTaskId,
		fileHistory,
		teamContext,
		showExpandedTodos,
		ultraplanPendingChoice,
		ultraplanLaunchPending,
		setAppState,
		store,
	};
}
