import type { TaskTodoTaskLine } from "./host";

export { getTaskLiteHost, TASKLITE_PLUGIN_ID, type TaskTodoCoreApi, type TaskTodoHost, type TaskTodoTaskRecord, type TaskTodoTaskLine, type EditTaskPatch, type CreateTaskInput } from "./host";

export const TASK_SYMBOLS = {
	priority: {
		highest: "🔺",
		high: "⏫",
		medium: "🔼",
		low: "🔽",
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
	assignee: "👤",
	remind: "⏰",
} as const;

export function serializeTaskLine(task: TaskTodoTaskLine, registry: { getByType(type: string): { symbol: string } }): string {
	const symbol = registry.getByType(task.status).symbol || " ";
	const parts = [task.description.trim()];
	if (task.priority) {
		const emoji = TASK_SYMBOLS.priority[task.priority as keyof typeof TASK_SYMBOLS.priority] || task.priority;
		parts.push(emoji);
	}
	addDate(parts, TASK_SYMBOLS.start, task.dates.start);
	addDate(parts, TASK_SYMBOLS.created, task.dates.created);
	addDate(parts, TASK_SYMBOLS.scheduled, task.dates.scheduled);
	addDate(parts, TASK_SYMBOLS.due, task.dates.due);
	addDate(parts, TASK_SYMBOLS.done, task.dates.done);
	addDate(parts, TASK_SYMBOLS.cancelled, task.dates.cancelled);
	addDate(parts, TASK_SYMBOLS.remind, task.dates.remind);
	if (task.recurrence) parts.push(`${TASK_SYMBOLS.recurrence} ${task.recurrence}`);
	if (task.onCompletion) parts.push(`${TASK_SYMBOLS.onCompletion} ${task.onCompletion}`);
	if (task.dependsOn) parts.push(`${TASK_SYMBOLS.dependsOn} ${task.dependsOn}`);
	if (task.id) parts.push(`${TASK_SYMBOLS.id} ${task.id}`);
	if (task.assignee && task.assignee.length > 0) parts.push(`${TASK_SYMBOLS.assignee} ${task.assignee.join(" & ")}`);
	if (task.blockLink) parts.push(task.blockLink);
	return `- [${symbol}] ${parts.filter(Boolean).join(" ")}`.trimEnd();
}

export function todayString(): string {
	return window.moment().format("YYYY-MM-DD");
}

function addDate(parts: string[], symbol: string, value: string | null | undefined): void {
	if (value) parts.push(`${symbol} ${value}`);
}
