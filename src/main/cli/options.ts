export type TeammateOptions = {
	agentId?: string;
	agentName?: string;
	teamName?: string;
	agentColor?: string;
	planModeRequired?: boolean;
	parentSessionId?: string;
	teammateMode?: "auto" | "tmux" | "in-process";
	agentType?: string;
};

export function extractTeammateOptions(options: unknown): TeammateOptions {
	if (typeof options !== "object" || options === null) {
		return {};
	}
	const opts = options as Record<string, unknown>;
	const teammateMode = opts.teammateMode;
	return {
		agentId: typeof opts.agentId === "string" ? opts.agentId : undefined,
		agentName: typeof opts.agentName === "string" ? opts.agentName : undefined,
		teamName: typeof opts.teamName === "string" ? opts.teamName : undefined,
		agentColor: typeof opts.agentColor === "string" ? opts.agentColor : undefined,
		planModeRequired:
			typeof opts.planModeRequired === "boolean" ? opts.planModeRequired : undefined,
		parentSessionId:
			typeof opts.parentSessionId === "string" ? opts.parentSessionId : undefined,
		teammateMode:
			teammateMode === "auto" ||
			teammateMode === "tmux" ||
			teammateMode === "in-process"
				? teammateMode
				: undefined,
		agentType: typeof opts.agentType === "string" ? opts.agentType : undefined,
	};
}
