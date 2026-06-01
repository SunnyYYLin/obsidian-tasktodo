import { describe, expect, test } from "bun:test";
import { compareTaskTodoItems, getLifeLength, getTaskDateValue, type TaskTodoSortableItem } from "../src/taskTodo/taskTodoSort";
import { TASK_SYMBOLS } from "../src/taskLiteInterop";

function makeItem(overrides: Partial<TaskTodoSortableItem> = {}): TaskTodoSortableItem {
	const base = {
		path: "note.md",
		lineNumber: 1,
		depth: 0,
		task: {
			status: "TODO",
			description: "task",
			priority: null,
			dates: { start: null, created: null, scheduled: null, due: null, done: null, cancelled: null },
			recurrence: null,
			onCompletion: null,
			id: null,
			dependsOn: null,
			blockLink: null,
		},
		date: null,
		dateType: null,
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


describe("getTaskDateValue 和 getLifeLength", () => {
	test("getTaskDateValue 取 due 和 scheduled 中较小的", () => {
		const item1 = makeItem({
			task: {
				status: "TODO",
				description: "t",
				dates: { start: null, created: null, scheduled: "2024-06-15", due: "2024-06-10", done: null, cancelled: null },
			},
		});
		expect(getTaskDateValue(item1.task)).toBe("2024-06-10");

		const item2 = makeItem({
			task: {
				status: "TODO",
				description: "t",
				dates: { start: null, created: null, scheduled: "2024-06-05", due: "2024-06-10", done: null, cancelled: null },
			},
		});
		expect(getTaskDateValue(item2.task)).toBe("2024-06-05");
	});

	test("getLifeLength 计算 min(due-start, scheduled-start)", () => {
		const item = makeItem({
			task: {
				status: "TODO",
				description: "t",
				dates: { start: "2024-06-01", created: null, scheduled: "2024-06-11", due: "2024-06-06", done: null, cancelled: null },
			},
		});
		expect(getLifeLength(item.task)).toBe(5);
	});
});

describe("compareTaskTodoItems", () => {
	test("完全相同返回 0", () => {
		const a = makeItem();
		const b = makeItem();
		expect(compareTaskTodoItems(a, b)).toBe(0);
	});

	describe("优先级/重要性排序", () => {
		test("highest 排在 high 前面", () => {
			const highest = makeItem({
				task: {
					status: "TODO",
					description: "t",
					priority: TASK_SYMBOLS.priority.highest,
				},
			});
			const high = makeItem({
				task: {
					status: "TODO",
					description: "t",
					priority: TASK_SYMBOLS.priority.high,
				},
			});
			expect(compareTaskTodoItems(highest, high, ["importance"])).toBeLessThan(0);
		});

		test("high 排在 medium 前面", () => {
			const high = makeItem({
				task: {
					status: "TODO",
					description: "t",
					priority: TASK_SYMBOLS.priority.high,
				},
			});
			const medium = makeItem({
				task: {
					status: "TODO",
					description: "t",
					priority: TASK_SYMBOLS.priority.medium,
				},
			});
			expect(compareTaskTodoItems(high, medium, ["importance"])).toBeLessThan(0);
		});

		test("无优先级排在 low 前面", () => {
			const none = makeItem();
			const low = makeItem({
				task: {
					status: "TODO",
					description: "t",
					priority: TASK_SYMBOLS.priority.low,
				},
			});
			expect(compareTaskTodoItems(none, low, ["importance"])).toBeLessThan(0);
		});
	});

	describe("是否取消排序", () => {
		test("普通任务排在取消任务前面", () => {
			const todo = makeItem({
				task: {
					status: "TODO",
					description: "t",
				},
			});
			const cancelled = makeItem({
				task: {
					status: "CANCELLED",
					description: "t",
				},
			});
			expect(compareTaskTodoItems(todo, cancelled, ["cancelled"])).toBeLessThan(0);
			expect(compareTaskTodoItems(cancelled, todo, ["cancelled"])).toBeGreaterThan(0);
		});
	});

	describe("日期排序", () => {
		test("较早日期排在较晚日期前面", () => {
			const earlier = makeItem({
				task: {
					status: "TODO",
					description: "t",
					dates: { start: null, created: null, scheduled: "2024-06-01", due: null, done: null, cancelled: null },
				},
			});
			const later = makeItem({
				task: {
					status: "TODO",
					description: "t",
					dates: { start: null, created: null, scheduled: "2024-06-15", due: null, done: null, cancelled: null },
				},
			});
			expect(compareTaskTodoItems(earlier, later, ["date"])).toBeLessThan(0);
		});

		test("有日期排在无日期前面", () => {
			const withDate = makeItem({
				task: {
					status: "TODO",
					description: "t",
					dates: { start: null, created: null, scheduled: "2024-06-15", due: null, done: null, cancelled: null },
				},
			});
			const noDate = makeItem();
			expect(compareTaskTodoItems(withDate, noDate, ["date"])).toBeLessThan(0);
		});
	});

	describe("生命长度排序", () => {
		test("短生命长度排在长生命长度前面", () => {
			const short = makeItem({
				task: {
					status: "TODO",
					description: "t",
					dates: { start: "2024-06-01", created: null, scheduled: "2024-06-06", due: null, done: null, cancelled: null },
				},
			});
			const long = makeItem({
				task: {
					status: "TODO",
					description: "t",
					dates: { start: "2024-06-01", created: null, scheduled: "2024-06-11", due: null, done: null, cancelled: null },
				},
			});
			expect(compareTaskTodoItems(short, long, ["lifeLength"])).toBeLessThan(0);
		});

		test("有生命长度排在无生命长度前面", () => {
			const withLife = makeItem({
				task: {
					status: "TODO",
					description: "t",
					dates: { start: "2024-06-01", created: null, scheduled: "2024-06-06", due: null, done: null, cancelled: null },
				},
			});
			const noLife = makeItem();
			expect(compareTaskTodoItems(withLife, noLife, ["lifeLength"])).toBeLessThan(0);
		});
	});

	describe("tiebreaker", () => {
		test("depth 小的排在前面", () => {
			const shallow = makeItem({ depth: 0 });
			const deep = makeItem({ depth: 2 });
			expect(compareTaskTodoItems(shallow, deep)).toBeLessThan(0);
		});

		test("path 按字典序", () => {
			const a = makeItem({ path: "a.md" });
			const b = makeItem({ path: "b.md" });
			expect(compareTaskTodoItems(a, b)).toBeLessThan(0);
		});

		test("lineNumber 小的排在前面", () => {
			const first = makeItem({ lineNumber: 1 });
			const second = makeItem({ lineNumber: 5 });
			expect(compareTaskTodoItems(first, second)).toBeLessThan(0);
		});
	});
});
