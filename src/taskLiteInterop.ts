import type { TaskTodoTaskLine } from "./host";

export { getTaskLiteHost, TASKLITE_PLUGIN_ID, type TaskTodoCoreApi, type TaskTodoHost, type TaskTodoTaskRecord, type TaskTodoTaskLine, type EditTaskPatch } from "./host";

export const TASK_SYMBOLS = {
	priority: {
		highest: "⏫",
		high: "🔼",
		medium: "🔽",
		low: "🔻",
		lowest: "⏬",
	},
	start: "🛫",
	created: "➕",
	scheduled: "⏳",
	due: "📅",
	done: "✅",
	cancelled: "❌",
	recurrence: "🔁",
	onCompletion: "🏁",
	dependsOn: "⛔",
	id: "🆔",
} as const;

export function serializeTaskLine(task: TaskTodoTaskLine): string {
	const parts = [task.metadata.description.trim()];
	if (task.metadata.priority) parts.push(task.metadata.priority);
	addDate(parts, TASK_SYMBOLS.start, task.metadata.dates.start);
	addDate(parts, TASK_SYMBOLS.created, task.metadata.dates.created);
	addDate(parts, TASK_SYMBOLS.scheduled, task.metadata.dates.scheduled);
	addDate(parts, TASK_SYMBOLS.due, task.metadata.dates.due);
	addDate(parts, TASK_SYMBOLS.done, task.metadata.dates.done);
	addDate(parts, TASK_SYMBOLS.cancelled, task.metadata.dates.cancelled);
	if (task.metadata.recurrence) parts.push(`${TASK_SYMBOLS.recurrence} ${task.metadata.recurrence}`);
	if (task.metadata.onCompletion) parts.push(`${TASK_SYMBOLS.onCompletion} ${task.metadata.onCompletion}`);
	if (task.metadata.dependsOn) parts.push(`${TASK_SYMBOLS.dependsOn} ${task.metadata.dependsOn}`);
	if (task.metadata.id) parts.push(`${TASK_SYMBOLS.id} ${task.metadata.id}`);
	if (task.metadata.blockLink) parts.push(task.metadata.blockLink);
	return `- [${task.status.symbol}] ${parts.filter(Boolean).join(" ")}`.trimEnd();
}

export function todayString(): string {
	return window.moment().format("YYYY-MM-DD");
}

function addDate(parts: string[], symbol: string, value: string | null | undefined): void {
	if (value) parts.push(`${symbol} ${value}`);
}
