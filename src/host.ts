import type { App } from "obsidian";

export const TASKLITE_PLUGIN_ID = "taskslite";

export interface TaskTodoTaskLine {
	status: string;
	description: string;
	priority: string | null;
	dates: {
		start: string | null;
		created: string | null;
		scheduled: string | null;
		due: string | null;
		done: string | null;
		cancelled: string | null;
	};
	recurrence: string | null;
	onCompletion: string | null;
	dependsOn: string | null;
	id: string | null;
	person: string[];
	blockLink: string | null;
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

export interface CreateTaskInput {
	description: string;
	status?: string;
	priority?: string | null;
	dates?: {
		start?: string | null;
		scheduled?: string | null;
		due?: string | null;
	};
	recurrence?: string | null;
	onCompletion?: string | null;
	id?: string | null;
	dependsOn?: string | null;
	person?: string[];
	path?: string;
	parentLineNumber?: number;
}

/** Partial patch for task metadata fields. Omitted keys are left unchanged. */
export interface EditTaskPatch {
	description?: string;
	priority?: string | null;
	dates?: {
		start?: string | null;
		scheduled?: string | null;
		due?: string | null;
	};
	recurrence?: string | null;
	onCompletion?: string | null;
	id?: string | null;
	dependsOn?: string | null;
	person?: string[];
}

export interface TaskTodoCoreApi {
	listTasks(options?: {
		includeCompleted?: boolean;
		includeCancelled?: boolean;
		includeChildren?: boolean;
	}): Promise<TaskTodoTaskRecord[]>;
	updateTaskStatus(path: string, lineNumber: number, statusSymbol: string): Promise<boolean>;
	createTask(input: CreateTaskInput): Promise<void>;
	deleteTask(path: string, lineNumber: number): Promise<boolean>;
	editTask(path: string, lineNumber: number, patch: EditTaskPatch): Promise<boolean>;
	executeTasksToggleCommand(line: string, path: string): string;
}

export interface TaskTodoHost {
	api: TaskTodoCoreApi;
	statusRegistry: {
		get(symbol: string): {symbol: string; name: string; type: string; nextStatusSymbol: string};
		getByType(type: string): {symbol: string; name: string; type: string; nextStatusSymbol: string};
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
