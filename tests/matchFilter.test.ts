import { describe, expect, test, beforeAll } from "bun:test";
import { matchFilter, preprocessDQLQuery, matchFilterWithDQL } from "../src/taskTodo/taskTodoFilter";
import type { FilterConfig } from "../src/main";

// Setup global mock for moment
beforeAll(() => {
	const momentMock = (val?: string) => {
		let currentVal = val || "2026-06-01";
		return {
			format: (fmt: string) => currentVal,
			add: (amount: number, unit: string) => {
				// Simple YYYY-MM-DD addition mock
				const date = new Date(currentVal);
				date.setDate(date.getDate() + amount);
				const y = date.getFullYear();
				const m = String(date.getMonth() + 1).padStart(2, "0");
				const d = String(date.getDate()).padStart(2, "0");
				currentVal = `${y}-${m}-${d}`;
				return {
					format: (fmt: string) => currentVal
				};
			}
		};
	};
	(globalThis as any).window = {
		moment: momentMock
	};
});

// Mock TaskListItem creator
function makeTestItem(overrides: any = {}): any {
	const base = {
		path: "test.md",
		basename: "test",
		lineNumber: 1,
		parentLine: null,
		depth: 0,
		hasChildren: false,
		task: {
			status: "TODO",
			description: "Buy milk #grocery @john",
			priority: null,
			dates: {
				start: null,
				created: null,
				scheduled: null,
				due: null,
				done: null,
				cancelled: null,
			},
			recurrence: null,
			onCompletion: null,
			id: null,
			dependsOn: null,
			blockLink: null,
		},
		date: null,
		dateType: null,
		parent: null,
		children: [],
	};

	const mergedTask = {
		...base.task,
		...overrides.task,
		dates: overrides.task?.dates ? { ...base.task.dates, ...overrides.task.dates } : base.task.dates,
	};

	return {
		...base,
		...overrides,
		task: mergedTask,
	};
}

// Helper to create basic filter config
function makeFilter(overrides: Partial<FilterConfig> = {}): FilterConfig {
	return {
		completed: "all",
		cancelled: "all",
		priority: [],
		text: "",
		tag: "",
		dateFilterRelation: "or",
		startDate: { mode: "all" },
		scheduledDate: { mode: "all" },
		dueDate: { mode: "all" },
		...overrides
	};
}

describe("matchFilter", () => {
	test("completed status filtering", () => {
		const todoItem = makeTestItem({ task: { status: "TODO", description: "t" } });
		const doneItem = makeTestItem({ task: { status: "DONE", description: "t" } });

		expect(matchFilter(todoItem, makeFilter({ completed: "uncompleted" }))).toBe(true);
		expect(matchFilter(todoItem, makeFilter({ completed: "completed" }))).toBe(false);

		expect(matchFilter(doneItem, makeFilter({ completed: "uncompleted" }))).toBe(false);
		expect(matchFilter(doneItem, makeFilter({ completed: "completed" }))).toBe(true);

		expect(matchFilter(todoItem, makeFilter({ completed: "all" }))).toBe(true);
		expect(matchFilter(doneItem, makeFilter({ completed: "all" }))).toBe(true);
	});

	test("cancelled status filtering", () => {
		const todoItem = makeTestItem({ task: { status: "TODO", description: "t" } });
		const cancelledItem = makeTestItem({ task: { status: "CANCELLED", description: "t" } });

		expect(matchFilter(todoItem, makeFilter({ cancelled: "uncancelled" }))).toBe(true);
		expect(matchFilter(todoItem, makeFilter({ cancelled: "cancelled" }))).toBe(false);

		expect(matchFilter(cancelledItem, makeFilter({ cancelled: "uncancelled" }))).toBe(false);
		expect(matchFilter(cancelledItem, makeFilter({ cancelled: "cancelled" }))).toBe(true);

		expect(matchFilter(todoItem, makeFilter({ cancelled: "all" }))).toBe(true);
		expect(matchFilter(cancelledItem, makeFilter({ cancelled: "all" }))).toBe(true);
	});

	test("priority filtering", () => {
		const highItem = makeTestItem({ task: { status: "TODO", description: "t", priority: "⏫" } });
		const noneItem = makeTestItem({ task: { status: "TODO", description: "t", priority: null } });

		expect(matchFilter(highItem, makeFilter({ priority: ["high"] }))).toBe(true);
		expect(matchFilter(highItem, makeFilter({ priority: ["medium", "highest"] }))).toBe(false);
		expect(matchFilter(highItem, makeFilter({ priority: [] }))).toBe(true); // Empty means all

		expect(matchFilter(noneItem, makeFilter({ priority: ["none"] }))).toBe(true);
		expect(matchFilter(noneItem, makeFilter({ priority: ["high"] }))).toBe(false);
	});

	test("text and tag description filtering", () => {
		const item = makeTestItem();

		expect(matchFilter(item, makeFilter({ text: "milk" }))).toBe(true);
		expect(matchFilter(item, makeFilter({ text: "john" }))).toBe(true);
		expect(matchFilter(item, makeFilter({ text: "bread" }))).toBe(false);

		expect(matchFilter(item, makeFilter({ tag: "grocery" }))).toBe(true);
		expect(matchFilter(item, makeFilter({ tag: "#grocery" }))).toBe(true);
		expect(matchFilter(item, makeFilter({ tag: "other" }))).toBe(false);
	});

	test("multi date filters with AND/OR relations", () => {
		// Mock today is 2026-06-01
		const item = makeTestItem({
			task: {
				status: "TODO",
				description: "task",
				dates: {
					start: "2026-06-01",
					due: "2026-06-02",
					scheduled: null
				}
			}
		});

		// OR relation (default) - should match if either start is today OR due is tomorrow
		expect(matchFilter(item, makeFilter({
			dateFilterRelation: "or",
			startDate: { mode: "today" },
			dueDate: { mode: "tomorrow" }
		}))).toBe(true);

		// OR relation - should match if only one condition is met (start is today, due is today)
		expect(matchFilter(item, makeFilter({
			dateFilterRelation: "or",
			startDate: { mode: "today" },
			dueDate: { mode: "today" }
		}))).toBe(true);

		// OR relation - neither matches
		expect(matchFilter(item, makeFilter({
			dateFilterRelation: "or",
			startDate: { mode: "tomorrow" },
			dueDate: { mode: "today" }
		}))).toBe(false);

		// AND relation - should match if both match
		expect(matchFilter(item, makeFilter({
			dateFilterRelation: "and",
			startDate: { mode: "today" },
			dueDate: { mode: "tomorrow" }
		}))).toBe(true);

		// AND relation - fails if one doesn't match
		expect(matchFilter(item, makeFilter({
			dateFilterRelation: "and",
			startDate: { mode: "today" },
			dueDate: { mode: "today" }
		}))).toBe(false);
	});

	test("has-date and no-date modes", () => {
		const hasDateItem = makeTestItem({
			task: {
				status: "TODO",
				description: "task",
				dates: {
					start: "2026-06-01",
					due: null,
					scheduled: null
				}
			}
		});
		const noDateItem = makeTestItem({
			task: {
				status: "TODO",
				description: "task",
				dates: {
					start: null,
					due: null,
					scheduled: null
				}
			}
		});

		expect(matchFilter(hasDateItem, makeFilter({
			startDate: { mode: "has-date" }
		}))).toBe(true);
		expect(matchFilter(noDateItem, makeFilter({
			startDate: { mode: "no-date" }
		}))).toBe(true);
		expect(matchFilter(hasDateItem, makeFilter({
			startDate: { mode: "no-date" }
		}))).toBe(false);
		expect(noDateItem, makeFilter({
			startDate: { mode: "has-date" }
		})).not.toBeNull(); // expect wrapper
	});

	test("today-or-overdue mode", () => {
		const overdueItem = makeTestItem({
			task: {
				status: "TODO",
				description: "task",
				dates: { start: "2026-05-30", due: null, scheduled: null }
			}
		});
		const todayItem = makeTestItem({
			task: {
				status: "TODO",
				description: "task",
				dates: { start: "2026-06-01", due: null, scheduled: null }
			}
		});
		const tomorrowItem = makeTestItem({
			task: {
				status: "TODO",
				description: "task",
				dates: { start: "2026-06-02", due: null, scheduled: null }
			}
		});

		const filter = makeFilter({
			startDate: { mode: "today-or-overdue" as any }
		});

		expect(matchFilter(overdueItem, filter)).toBe(true);
		expect(matchFilter(todayItem, filter)).toBe(true);
		expect(matchFilter(tomorrowItem, filter)).toBe(false);
	});

	test("assignee filtering", () => {
		const itemJohn = makeTestItem({ task: { status: "TODO", description: "Buy milk @john" } });
		const itemMary = makeTestItem({ task: { status: "TODO", description: "Clean room @mary" } });
		const itemNone = makeTestItem({ task: { status: "TODO", description: "Do homework" } });

		expect(matchFilter(itemJohn, makeFilter({ assignee: "john" }))).toBe(true);
		expect(matchFilter(itemJohn, makeFilter({ assignee: "@john" }))).toBe(true);
		expect(matchFilter(itemMary, makeFilter({ assignee: "john" }))).toBe(false);
		expect(matchFilter(itemNone, makeFilter({ assignee: "john" }))).toBe(false);
	});

	test("custom date range filtering", () => {
		const itemStart = makeTestItem({ task: { status: "TODO", description: "task", dates: { start: "2026-06-05" } } });
		const itemBefore = makeTestItem({ task: { status: "TODO", description: "task", dates: { start: "2026-06-02" } } });
		const itemAfter = makeTestItem({ task: { status: "TODO", description: "task", dates: { start: "2026-06-12" } } });

		// start range: [2026-06-04, 2026-06-10]
		const filter = makeFilter({
			startDate: { mode: "custom", customStart: "2026-06-04", customEnd: "2026-06-10" }
		});

		expect(matchFilter(itemStart, filter)).toBe(true);
		expect(matchFilter(itemBefore, filter)).toBe(false);
		expect(matchFilter(itemAfter, filter)).toBe(false);
	});

	describe("matchFilterWithDQL and preprocessDQLQuery", () => {
		test("preprocessDQLQuery replaces tomorrow and next-week correctly", () => {
			const query = 'status = "TODO" AND due = date(tomorrow) AND start = date(next-week)';
			const preprocessed = preprocessDQLQuery(query);
			expect(preprocessed).toContain('date("2026-06-02")');
			expect(preprocessed).toContain('date("2026-06-08")');
		});

		test("matchFilterWithDQL uses DQL query if provided", () => {
			const item = makeTestItem({
				task: {
					status: "TODO",
					description: "task with DQL",
					dates: { start: "2026-06-01", due: null, scheduled: null }
				}
			});
			const hostMock = {
				api: {
					filterTasks: (records: any[], query: string) => {
						if (query.includes('status = "TODO"') && query.includes('start = date("2026-06-01")')) {
							return records;
						}
						return [];
					}
				}
			};

			const query = 'status = "TODO" AND start = date("2026-06-01")';
			expect(matchFilterWithDQL(item, undefined, query, hostMock)).toBe(true);
			expect(matchFilterWithDQL(item, undefined, 'status = "DONE"', hostMock)).toBe(false);
		});

		test("matchFilterWithDQL falls back to filter config if DQL query is missing", () => {
			const item = makeTestItem({
				task: {
					status: "TODO",
					description: "task with DQL",
					dates: { start: "2026-06-01", due: null, scheduled: null }
				}
			});
			const filter = makeFilter({
				completed: "uncompleted"
			});
			expect(matchFilterWithDQL(item, filter, undefined, null)).toBe(true);
		});
	});
});
