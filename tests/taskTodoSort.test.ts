import { describe, expect, test } from "bun:test";
import { compareTaskTodoItems, getLifeLength, getTaskDateValue, type TaskTodoSortableItem } from "../src/taskTodo/taskTodoSort";
import { TASK_SYMBOLS } from "../src/taskLiteInterop";

function makeItem(overrides: Partial<TaskTodoSortableItem> = {}): TaskTodoSortableItem {
	const base = {
		path: "note.md",
		lineNumber: 1,
		depth: 0,
		task: {
			status: { symbol: " ", type: "TODO" },
			metadata: {
				description: "task",
				priority: null,
				dates: { start: null, scheduled: null, due: null, done: null },
				recurrence: null,
				onCompletion: null,
				id: null,
				dependsOn: null,
			},
		},
		date: null,
		dateType: null,
	};

	const mergedTask = {
		...base.task,
		status: overrides.task?.status ? { ...base.task.status, ...overrides.task.status } : base.task.status,
		metadata: overrides.task?.metadata
			? {
					...base.task.metadata,
					...overrides.task.metadata,
					dates: overrides.task.metadata.dates ? { ...base.task.metadata.dates, ...overrides.task.metadata.dates } : base.task.metadata.dates,
				}
			: base.task.metadata,
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
				status: { symbol: " ", type: "TODO" },
				metadata: {
					description: "t",
					priority: null,
					dates: { start: null, scheduled: "2024-06-15", due: "2024-06-10", done: null },
					recurrence: null,
					onCompletion: null,
					id: null,
					dependsOn: null,
				},
			},
		});
		expect(getTaskDateValue(item1.task)).toBe("2024-06-10");

		const item2 = makeItem({
			task: {
				status: { symbol: " ", type: "TODO" },
				metadata: {
					description: "t",
					priority: null,
					dates: { start: null, scheduled: "2024-06-05", due: "2024-06-10", done: null },
					recurrence: null,
					onCompletion: null,
					id: null,
					dependsOn: null,
				},
			},
		});
		expect(getTaskDateValue(item2.task)).toBe("2024-06-05");
	});

	test("getLifeLength 计算 min(due-start, scheduled-start)", () => {
		const item = makeItem({
			task: {
				status: { symbol: " ", type: "TODO" },
				metadata: {
					description: "t",
					priority: null,
					dates: { start: "2024-06-01", scheduled: "2024-06-11", due: "2024-06-06", done: null },
					recurrence: null,
					onCompletion: null,
					id: null,
					dependsOn: null,
				},
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
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: TASK_SYMBOLS.priority.highest,
						dates: { start: null, scheduled: null, due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			const high = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: TASK_SYMBOLS.priority.high,
						dates: { start: null, scheduled: null, due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			expect(compareTaskTodoItems(highest, high, ["importance"])).toBeLessThan(0);
		});

		test("high 排在 medium 前面", () => {
			const high = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: TASK_SYMBOLS.priority.high,
						dates: { start: null, scheduled: null, due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			const medium = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: TASK_SYMBOLS.priority.medium,
						dates: { start: null, scheduled: null, due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			expect(compareTaskTodoItems(high, medium, ["importance"])).toBeLessThan(0);
		});

		test("无优先级排在 low 前面", () => {
			const none = makeItem();
			const low = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: TASK_SYMBOLS.priority.low,
						dates: { start: null, scheduled: null, due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			expect(compareTaskTodoItems(none, low, ["importance"])).toBeLessThan(0);
		});
	});

	describe("是否取消排序", () => {
		test("普通任务排在取消任务前面", () => {
			const todo = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: null, scheduled: null, due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			const cancelled = makeItem({
				task: {
					status: { symbol: "-", type: "CANCELLED" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: null, scheduled: null, due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
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
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: null, scheduled: "2024-06-01", due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			const later = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: null, scheduled: "2024-06-15", due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			expect(compareTaskTodoItems(earlier, later, ["date"])).toBeLessThan(0);
		});

		test("有日期排在无日期前面", () => {
			const withDate = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: null, scheduled: "2024-06-15", due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
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
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: "2024-06-01", scheduled: "2024-06-06", due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			const long = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: "2024-06-01", scheduled: "2024-06-11", due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
				},
			});
			expect(compareTaskTodoItems(short, long, ["lifeLength"])).toBeLessThan(0);
		});

		test("有生命长度排在无生命长度前面", () => {
			const withLife = makeItem({
				task: {
					status: { symbol: " ", type: "TODO" },
					metadata: {
						description: "t",
						priority: null,
						dates: { start: "2024-06-01", scheduled: "2024-06-06", due: null, done: null },
						recurrence: null,
						onCompletion: null,
						id: null,
						dependsOn: null,
					},
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
