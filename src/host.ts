import type { App } from "obsidian";

export const TASKLITE_PLUGIN_ID = "taskslite";

export interface TaskTodoTaskLine {
	status: {
		symbol: string;
		type: string;
	};
	metadata: {
		description: string;
		priority: string | null;
		dates: {
			start: string | null;
			scheduled: string | null;
			due: string | null;
			done: string | null;
		};
		recurrence: string | null;
		onCompletion: string | null;
		id: string | null;
		dependsOn: string | null;
		blockLink?: string | null;
	};
}

export interface TaskTodoTaskRecord {
	path: string;
	basename: string;
	lineNumber: number;
	parentLine: number | null;
	depth: number;
	hasChildren: boolean;
	task: TaskTodoTaskLine;
}

export interface TaskTodoCoreApi {
	listTasks(options?: {
		includeCompleted?: boolean;
		includeCancelled?: boolean;
		includeChildren?: boolean;
	}): Promise<TaskTodoTaskRecord[]>;
	finishTask(path: string, lineNumber: number): Promise<boolean>;
	unfinishTask(path: string, lineNumber: number): Promise<boolean>;
	cancelTask(path: string, lineNumber: number): Promise<boolean>;
	uncancelTask(path: string, lineNumber: number): Promise<boolean>;
	createTask(line: string, options?: {path?: string; parentLineNumber?: number}): Promise<void>;
}

export interface TaskTodoHost {
	api: TaskTodoCoreApi;
	statusRegistry: {
		get(symbol: string): {symbol: string; name: string; type: string};
	};
	settings: {
		statusSettings: unknown;
	};
	modalApi?: {
		openTaskLineModal(options: {title: string; initialLine: string}): Promise<string>;
		openTaskLineModalWithTarget?(options: {
			title: string;
			initialLine: string;
			targetFile: {basePath: string; defaultValue: string};
			parentTask?: {
				options: Array<{label: string; path: string; lineNumber: number}>;
				initialValue?: {path: string; lineNumber: number};
			};
		}): Promise<{line: string; targetPath?: string; parentLineNumber?: number} | null>;
	};
}

export function getTaskLiteHost(app: App): TaskTodoHost | null {
	const plugins = (app as App & {plugins?: {plugins?: Record<string, unknown>}}).plugins?.plugins;
	const host = plugins?.[TASKLITE_PLUGIN_ID] as Partial<TaskTodoHost> | undefined;
	if (!host?.api || !host.statusRegistry || !host.settings) return null;
	return host as TaskTodoHost;
}
