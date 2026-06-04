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
		const taskPeople = [
			...extractPeople(item.task.description).map((p: string) => p.startsWith("@") ? p.substring(1) : p),
			...(item.task.assignee || [])
		].map((p: string) => p.toLowerCase());
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

export const filterConfigToDQL = (filter: FilterConfig | undefined): string => {
	if (!filter) return "";
	const parts: string[] = [];

	// 1. Completed
	if (filter.completed === "completed") {
		parts.push('status = "DONE"');
	} else if (filter.completed === "uncompleted") {
		parts.push('status != "DONE"');
	}

	// 2. Cancelled
	if (filter.cancelled === "cancelled") {
		parts.push('status = "CANCELLED"');
	} else if (filter.cancelled === "uncancelled") {
		parts.push('status != "CANCELLED"');
	}

	// 3. Priority
	if (filter.priority && filter.priority.length > 0) {
		const priParts = filter.priority.map(pri => {
			if (pri === "none") return 'priority = ""';
			let emoji = "";
			if (pri === "highest") emoji = "⏫";
			else if (pri === "high") emoji = "🔼";
			else if (pri === "medium") emoji = "🔽";
			else if (pri === "low") emoji = "🔻";
			else if (pri === "lowest") emoji = "⏬";
			return `priority = "${emoji}"`;
		}).filter(Boolean);
		if (priParts.length > 0) {
			parts.push(`(${priParts.join(" OR ")})`);
		}
	}

	// 4. Dates
	const dateParts: string[] = [];
	const handleDateField = (field: DateFilterField, name: string) => {
		if (!field || field.mode === "all") return;
		if (field.mode === "no-date") {
			dateParts.push(`${name} = null`);
		} else if (field.mode === "has-date") {
			dateParts.push(`${name} != null`);
		} else if (field.mode === "today") {
			dateParts.push(`${name} = date(today)`);
		} else if (field.mode === "tomorrow") {
			dateParts.push(`${name} = date(tomorrow)`);
		} else if (field.mode === "this-week") {
			dateParts.push(`(${name} >= date(today) AND ${name} <= date(next-week))`);
		} else if (field.mode === "overdue") {
			dateParts.push(`${name} < date(today)`);
		} else if (field.mode === "today-or-overdue") {
			dateParts.push(`${name} <= date(today)`);
		} else if (field.mode === "later") {
			dateParts.push(`${name} > date(next-week)`);
		} else if (field.mode === "custom") {
			const conds: string[] = [];
			if (field.customStart) {
				conds.push(`${name} >= date("${field.customStart}")`);
			}
			if (field.customEnd) {
				conds.push(`${name} <= date("${field.customEnd}")`);
			}
			if (conds.length > 0) {
				dateParts.push(`(${conds.join(" AND ")})`);
			}
		}
	};

	if (filter.startDate) handleDateField(filter.startDate, "start");
	if (filter.scheduledDate) handleDateField(filter.scheduledDate, "scheduled");
	if (filter.dueDate) handleDateField(filter.dueDate, "due");

	if (dateParts.length > 0) {
		const rel = filter.dateFilterRelation || "or";
		parts.push(`(${dateParts.join(` ${rel.toUpperCase()} `)})`);
	}

	// 5. Text search
	if (filter.text && filter.text.trim() !== "") {
		parts.push(`description contains "${filter.text.replace(/"/g, '\\"')}"`);
	}

	// 6. Tag filter
	if (filter.tag && filter.tag.trim() !== "") {
		parts.push(`tags contains "${filter.tag}"`);
	}

	// 7. Assignee filter
	if (filter.assignee && filter.assignee.trim() !== "") {
		parts.push(`assignee = "${filter.assignee.replace(/"/g, '\\"')}"`);
	}

	return parts.join(" AND ");
};

export function parseDQLToFilter(dql: string): { filter: FilterConfig; isPerfect: boolean } {
	const trimmedDql = dql.trim();
	const createDefaultFilter = (): FilterConfig => ({
		completed: "all",
		cancelled: "all",
		priority: [],
		text: "",
		tag: "",
		assignee: "",
		startDate: { mode: "all" },
		scheduledDate: { mode: "all" },
		dueDate: { mode: "all" },
	});

	if (!trimmedDql) {
		return { filter: createDefaultFilter(), isPerfect: true };
	}

	const filter = createDefaultFilter();
	let isPerfect = true;

	// Split by AND outside of parentheses or quotes
	const parts: string[] = [];
	let current = "";
	let parenDepth = 0;
	let inQuote: '"' | "'" | null = null;

	for (let idx = 0; idx < trimmedDql.length; idx++) {
		const char = trimmedDql[idx];
		if (char === '"' || char === "'") {
			if (!inQuote) {
				inQuote = char;
			} else if (inQuote === char && trimmedDql[idx - 1] !== '\\') {
				inQuote = null;
			}
			current += char;
		} else if (inQuote) {
			current += char;
		} else {
			if (char === "(") {
				parenDepth++;
				current += char;
			} else if (char === ")") {
				parenDepth--;
				current += char;
			} else if (parenDepth === 0 && trimmedDql.substring(idx, idx + 5).toUpperCase() === " AND ") {
				parts.push(current.trim());
				current = "";
				idx += 4; // skip " AND"
			} else {
				current += char;
			}
		}
	}
	if (inQuote || parenDepth !== 0) {
		return { filter: createDefaultFilter(), isPerfect: false };
	}
	if (current.trim()) {
		parts.push(current.trim());
	}

	const unquote = (str: string): string => {
		str = str.trim();
		if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
			return str.substring(1, str.length - 1).replace(/\\"/g, '"');
		}
		return str;
	};

	for (const part of parts) {
		const trimmedPart = part.trim();
		if (!trimmedPart) continue;

		// 1. Completed status
		if (/^status\s*=\s*["']DONE["']$/i.test(trimmedPart)) {
			filter.completed = "completed";
		} else if (/^status\s*!=\s*["']DONE["']$/i.test(trimmedPart)) {
			filter.completed = "uncompleted";
		}
		// 2. Cancelled status
		else if (/^status\s*=\s*["']CANCELLED["']$/i.test(trimmedPart)) {
			filter.cancelled = "cancelled";
		} else if (/^status\s*!=\s*["']CANCELLED["']$/i.test(trimmedPart)) {
			filter.cancelled = "uncancelled";
		}
		// 3. Text search: description contains "..."
		else if (/^description\s+contains\s+/i.test(trimmedPart)) {
			const val = trimmedPart.substring(trimmedPart.toLowerCase().indexOf("contains") + 8).trim();
			filter.text = unquote(val);
		}
		// 4. Tag filter: tags contains "..."
		else if (/^tags\s+contains\s+/i.test(trimmedPart)) {
			const val = trimmedPart.substring(trimmedPart.toLowerCase().indexOf("contains") + 8).trim();
			filter.tag = unquote(val);
		}
		// 5. Assignee: assignee = "..." or person = "..."
		else if (/^(?:assignee|person)\s*=\s*/i.test(trimmedPart)) {
			const val = trimmedPart.substring(trimmedPart.indexOf("=") + 1).trim();
			filter.assignee = unquote(val);
		}
		// 6. Priority: (priority = "⏬" OR priority = "🔼")
		else if (trimmedPart.startsWith("(") && trimmedPart.endsWith(")")) {
			const inside = trimmedPart.substring(1, trimmedPart.length - 1).trim();
			const orParts: string[] = [];
			let currentOr = "";
			let inOrQuote: '"' | "'" | null = null;
			for (let idx = 0; idx < inside.length; idx++) {
				const char = inside[idx];
				if (char === '"' || char === "'") {
					if (!inOrQuote) inOrQuote = char;
					else if (inOrQuote === char && inside[idx - 1] !== '\\') inOrQuote = null;
					currentOr += char;
				} else if (inOrQuote) {
					currentOr += char;
				} else {
					if (inside.substring(idx, idx + 4).toUpperCase() === " OR ") {
						orParts.push(currentOr.trim());
						currentOr = "";
						idx += 3; // skip " OR"
					} else {
						currentOr += char;
					}
				}
			}
			if (inOrQuote) {
				isPerfect = false;
				continue;
			}
			if (currentOr.trim()) orParts.push(currentOr.trim());

			const parsedPriorities: string[] = [];
			let isValidPriorityExpr = true;
			for (const orPart of orParts) {
				const trimmedOr = orPart.trim();
				const match = trimmedOr.match(/^priority\s*=\s*(.*)$/i);
				if (!match) {
					isValidPriorityExpr = false;
					break;
				}
				const priVal = unquote(match[1] || "");
				if (priVal === "") {
					parsedPriorities.push("none");
				} else if (priVal === "⏫") {
					parsedPriorities.push("highest");
				} else if (priVal === "🔼") {
					parsedPriorities.push("high");
				} else if (priVal === "🔽") {
					parsedPriorities.push("medium");
				} else if (priVal === "🔻") {
					parsedPriorities.push("low");
				} else if (priVal === "⏬") {
					parsedPriorities.push("lowest");
				} else {
					isValidPriorityExpr = false;
					break;
				}
			}
			if (isValidPriorityExpr) {
				filter.priority = parsedPriorities;
			} else {
				isPerfect = false;
			}
		}
		// Any other fields or operators (like date checks) mean it's advanced
		else {
			isPerfect = false;
		}
	}

	return { filter, isPerfect };
}
