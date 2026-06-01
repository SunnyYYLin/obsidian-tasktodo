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
	if (filter.completed === "completed" && item.task.status !== "DONE") {
		return false;
	}
	if (filter.completed === "uncompleted" && item.task.status === "DONE") {
		return false;
	}

	if (filter.cancelled === "cancelled" && item.task.status !== "CANCELLED") {
		return false;
	}
	if (filter.cancelled === "uncancelled" && item.task.status === "CANCELLED") {
		return false;
	}

	// Priority filter
	if (filter.priority && filter.priority.length > 0) {
		const key = getPriorityKey(item.task.priority);
		if (!filter.priority.includes(key)) {
			return false;
		}
	}

	// Text query filter
	if (filter.text && filter.text.trim() !== "") {
		const query = filter.text.toLowerCase().trim();
		const desc = item.task.description.toLowerCase();
		if (!desc.includes(query)) {
			return false;
		}
	}

	// Tag filter
	if (filter.tag && filter.tag.trim() !== "") {
		const tagQuery = filter.tag.toLowerCase().trim();
		const cleanQuery = tagQuery.startsWith("#") ? tagQuery.substring(1) : tagQuery;
		const taskTags = extractTags(item.task.description).map((t: string) => 
			t.toLowerCase().startsWith("#") ? t.toLowerCase().substring(1) : t.toLowerCase()
		);
		if (!taskTags.some((t: string) => t.includes(cleanQuery))) {
			return false;
		}
	}

	// Assignee filter
	if (filter.assignee && filter.assignee.trim() !== "") {
		const assigneeQuery = filter.assignee.toLowerCase().trim();
		const cleanQuery = assigneeQuery.startsWith("@") ? assigneeQuery.substring(1) : assigneeQuery;
		const taskPeople = extractPeople(item.task.description).map((p: string) => 
			p.toLowerCase().startsWith("@") ? p.toLowerCase().substring(1) : p.toLowerCase()
		);
		if (!taskPeople.some((p: string) => p.includes(cleanQuery))) {
			return false;
		}
	}

	// Date filters
	const today = todayString();
	const activeFields = [
		{ val: item.task.dates.start, field: filter.startDate },
		{ val: item.task.dates.scheduled, field: filter.scheduledDate },
		{ val: item.task.dates.due, field: filter.dueDate }
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
		case "today-or-overdue":
			return dateString <= today;
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

function extractPeople(description: string): string[] {
	const peopleRegex = /(^|\s)@[^ !@#$%^&*(),.?":{}|<>]+/g;
	return Array.from(description.matchAll(peopleRegex)).map((match) => match[0].trim());
}

export function preprocessDQLQuery(query: string): string {
	if (!query) return query;
	const today = todayString();
	const tomorrow = (window as any).moment(today, "YYYY-MM-DD").add(1, "days").format("YYYY-MM-DD");
	const nextWeek = (window as any).moment(today, "YYYY-MM-DD").add(7, "days").format("YYYY-MM-DD");

	let result = query;
	result = result.replace(/\bdate\(\s*["']?tomorrow["']?\s*\)/gi, `date("${tomorrow}")`);
	result = result.replace(/\bdate\(\s*["']?next-week["']?\s*\)/gi, `date("${nextWeek}")`);
	return result;
}

export function matchFilterWithDQL(
	item: TaskListItem,
	filter: FilterConfig | undefined,
	query: string | undefined,
	host: any
): boolean {
	if (query && query.trim() !== "") {
		const preprocessed = preprocessDQLQuery(query);
		if (host && host.api && typeof host.api.filterTasks === "function") {
			const record = {
				path: item.path,
				basename: item.basename,
				lineNumber: item.lineNumber,
				parentLine: item.parentLine,
				depth: item.depth,
				hasChildren: item.hasChildren,
				task: item.task,
			};
			try {
				const result = host.api.filterTasks([record], preprocessed);
				return result.length > 0;
			} catch (err) {
				console.warn("DQL filter matching failed for query:", query, err);
				return false;
			}
		}
	}
	return filter ? matchFilter(item, filter) : true;
}
