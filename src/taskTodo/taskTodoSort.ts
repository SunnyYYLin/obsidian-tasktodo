import { TASK_SYMBOLS, type TaskTodoTaskLine } from "../taskLiteInterop";

export interface TaskTodoSortableItem {
	path: string;
	lineNumber: number;
	depth: number;
	task: TaskTodoTaskLine;
	date: string | null;
	dateType: "due" | "scheduled" | "start" | null;
}

export type SortKey = "date" | "importance" | "cancelled" | "lifeLength";

export function parseSortOrderSetting(settingValue: string): SortKey[] {
	const keys: SortKey[] = [];
	const parts = settingValue.split(/[,，]/);
	for (const part of parts) {
		const trimmed = part.trim().toLowerCase();
		if (trimmed === "date" || trimmed === "日期") {
			keys.push("date");
		} else if (trimmed === "importance" || trimmed === "priority" || trimmed === "重要性") {
			keys.push("importance");
		} else if (trimmed === "cancelled" || trimmed === "是否取消") {
			keys.push("cancelled");
		} else if (trimmed === "lifelength" || trimmed === "length" || trimmed === "生命长度") {
			keys.push("lifeLength");
		}
	}
	const defaultKeys: SortKey[] = ["date", "cancelled", "importance", "lifeLength"];
	const finalKeys = Array.from(new Set(keys));
	for (const defaultKey of defaultKeys) {
		if (!finalKeys.includes(defaultKey)) {
			finalKeys.push(defaultKey);
		}
	}
	return finalKeys;
}

export function compareTaskTodoItems(
	left: TaskTodoSortableItem,
	right: TaskTodoSortableItem,
	sortKeys: SortKey[] = ["date", "cancelled", "importance", "lifeLength"],
): number {
	for (const key of sortKeys) {
		let cmp = 0;
		if (key === "date") {
			cmp = compareDates(left.task, right.task);
		} else if (key === "importance") {
			cmp = compareImportance(left.task, right.task);
		} else if (key === "cancelled") {
			cmp = compareCancelled(left.task, right.task);
		} else if (key === "lifeLength") {
			cmp = compareLifeLength(left.task, right.task);
		}
		if (cmp !== 0) return cmp;
	}

	return (
		compareNumber(left.depth, right.depth) ||
		compareString(left.path, right.path) ||
		compareNumber(left.lineNumber, right.lineNumber)
	);
}

function priorityRank(task: TaskTodoTaskLine): number {
	const priority = task.metadata.priority;
	if (priority === TASK_SYMBOLS.priority.highest) return 0;
	if (priority === TASK_SYMBOLS.priority.high) return 1;
	if (priority === TASK_SYMBOLS.priority.medium) return 2;
	if (priority === TASK_SYMBOLS.priority.low) return 4;
	if (priority === TASK_SYMBOLS.priority.lowest) return 5;
	return 3;
}

function compareImportance(left: TaskTodoTaskLine, right: TaskTodoTaskLine): number {
	return priorityRank(left) - priorityRank(right);
}

function compareCancelled(left: TaskTodoTaskLine, right: TaskTodoTaskLine): number {
	const leftRank = left.status.type === "CANCELLED" ? 1 : 0;
	const rightRank = right.status.type === "CANCELLED" ? 1 : 0;
	return leftRank - rightRank;
}

export function getTaskDateValue(task: TaskTodoTaskLine): string | null {
	const due = task.metadata.dates.due;
	const scheduled = task.metadata.dates.scheduled;
	if (due && scheduled) return due < scheduled ? due : scheduled;
	return due || scheduled || null;
}

function compareDates(left: TaskTodoTaskLine, right: TaskTodoTaskLine): number {
	const leftDate = getTaskDateValue(left);
	const rightDate = getTaskDateValue(right);
	return compareString(leftDate ?? "9999-12-31", rightDate ?? "9999-12-31");
}

function parseDateToTimestamp(dateStr: string): number | null {
	const parts = dateStr.split("-").map((p) => Number.parseInt(p, 10));
	if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
	return Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!);
}

function getDateDiffInDays(dateStr: string | null, startStr: string | null): number | null {
	if (!dateStr || !startStr) return null;
	const t1 = parseDateToTimestamp(dateStr);
	const t2 = parseDateToTimestamp(startStr);
	if (t1 === null || t2 === null) return null;
	return Math.round((t1 - t2) / (1000 * 60 * 60 * 24));
}

export function getLifeLength(task: TaskTodoTaskLine): number | null {
	const start = task.metadata.dates.start;
	if (!start) return null;

	const due = task.metadata.dates.due;
	const scheduled = task.metadata.dates.scheduled;

	const dueDiff = getDateDiffInDays(due, start);
	const schedDiff = getDateDiffInDays(scheduled, start);

	if (dueDiff !== null && schedDiff !== null) {
		return Math.min(dueDiff, schedDiff);
	}
	return dueDiff !== null ? dueDiff : (schedDiff !== null ? schedDiff : null);
}

function compareLifeLength(left: TaskTodoTaskLine, right: TaskTodoTaskLine): number {
	const leftLen = getLifeLength(left);
	const rightLen = getLifeLength(right);

	if (leftLen === null && rightLen === null) return 0;
	if (leftLen === null) return 1;
	if (rightLen === null) return -1;
	return leftLen - rightLen;
}

function compareNumber(left: number, right: number): number {
	return left - right;
}

function compareString(left: string, right: string): number {
	return left.localeCompare(right);
}
