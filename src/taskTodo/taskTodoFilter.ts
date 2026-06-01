import type { TaskTodoTaskLine } from "../taskLiteInterop";
import type { FilterConfig, DateFilterField } from "../main";
import { todayString } from "../taskLiteInterop";

export interface TaskListItem {
	path: string;
	basename: string;
	lineNumber: number;
	parentLine: number | null;
	depth: number;
	hasChildren: boolean;
	task: TaskTodoTaskLine;
	date: string | null;
	dateType: "due" | "scheduled" | "start" | null;
	parent: TaskListItem | null;
	children: TaskListItem[];
}

export function shiftDate(value: string, amount: number): string {
	return (window as any).moment(value, "YYYY-MM-DD").add(amount, "days").format("YYYY-MM-DD");
}

export function matchFilter(item: TaskListItem, filter: FilterConfig): boolean {
	if (filter.completed === "completed" && item.task.status.type !== "DONE") {
		return false;
	}
	if (filter.completed === "uncompleted" && item.task.status.type === "DONE") {
		return false;
	}

	if (filter.cancelled === "cancelled" && item.task.status.type !== "CANCELLED") {
		return false;
	}
	if (filter.cancelled === "uncancelled" && item.task.status.type === "CANCELLED") {
		return false;
	}

	// Priority filter
	if (filter.priority && filter.priority.length > 0) {
		const key = getPriorityKey(item.task.metadata.priority);
		if (!filter.priority.includes(key)) {
			return false;
		}
	}

	// Text query filter
	if (filter.text && filter.text.trim() !== "") {
		const query = filter.text.toLowerCase().trim();
		const desc = item.task.metadata.description.toLowerCase();
		if (!desc.includes(query)) {
			return false;
		}
	}

	// Tag filter
	if (filter.tag && filter.tag.trim() !== "") {
		const tagQuery = filter.tag.toLowerCase().trim();
		const cleanQuery = tagQuery.startsWith("#") ? tagQuery.substring(1) : tagQuery;
		const taskTags = extractTags(item.task.metadata.description).map((t: string) => 
			t.toLowerCase().startsWith("#") ? t.toLowerCase().substring(1) : t.toLowerCase()
		);
		if (!taskTags.some((t: string) => t.includes(cleanQuery))) {
			return false;
		}
	}

	// Date filters
	const today = todayString();
	const activeFields = [
		{ val: item.task.metadata.dates.start, field: filter.startDate },
		{ val: item.task.metadata.dates.scheduled, field: filter.scheduledDate },
		{ val: item.task.metadata.dates.due, field: filter.dueDate }
	].filter(x => x.field && x.field.mode !== "all");

	if (activeFields.length > 0) {
		const relation = filter.dateFilterRelation || "or";
		if (relation === "and") {
			for (const { val, field } of activeFields) {
				if (!matchDateField(val, field, today)) {
					return false;
				}
			}
		} else {
			let matchedAny = false;
			for (const { val, field } of activeFields) {
				if (matchDateField(val, field, today)) {
					matchedAny = true;
					break;
				}
			}
			if (!matchedAny) {
				return false;
			}
		}
	}

	return true;
}

function getPriorityKey(emoji: string | null): string {
	if (!emoji) return "none";
	switch (emoji) {
		case "🔺": return "highest";
		case "⏫": return "high";
		case "🔼": return "medium";
		case "🔽": return "low";
		case "⏬": return "lowest";
		default: return "none";
	}
}

function matchDateField(dateString: string | null, field: DateFilterField, today: string): boolean {
	if (!field || field.mode === "all") {
		return true;
	}
	if (field.mode === "no-date") {
		return !dateString;
	}
	if (field.mode === "has-date") {
		return dateString !== null && dateString !== "";
	}
	if (!dateString) {
		return false;
	}

	switch (field.mode) {
		case "today":
			return dateString === today;
		case "tomorrow":
			return dateString === shiftDate(today, 1);
		case "this-week": {
			const nextWeek = shiftDate(today, 7);
			return dateString >= today && dateString <= nextWeek;
		}
		case "overdue":
			return dateString < today;
		case "later": {
			const nextWeek = shiftDate(today, 7);
			return dateString > nextWeek;
		}
		case "custom": {
			if (field.customStart && dateString < field.customStart) return false;
			if (field.customEnd && dateString > field.customEnd) return false;
			return true;
		}
		default:
			return true;
	}
}

function extractTags(description: string): string[] {
	const tagRegex = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+/g;
	return Array.from(description.matchAll(tagRegex)).map((match) => match[0].trim());
}
