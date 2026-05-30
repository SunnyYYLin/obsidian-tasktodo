import { describe, expect, test } from "bun:test";
import { serializeTaskLine, TASK_SYMBOLS, todayString } from "../src/taskLiteInterop";
import type { TaskTodoTaskLine } from "../src/host";

function makeTask(overrides: Partial<TaskTodoTaskLine> = {}): TaskTodoTaskLine {
	return {
		status: { symbol: " ", type: "TODO" },
		metadata: {
			description: "test task",
			priority: null,
			dates: { start: null, scheduled: null, due: null, done: null },
			recurrence: null,
			onCompletion: null,
			id: null,
			dependsOn: null,
			blockLink: null,
		},
		...overrides,
	};
}

describe("serializeTaskLine", () => {
	test("最小任务：只有 description", () => {
		const task = makeTask();
		expect(serializeTaskLine(task)).toBe("- [ ] test task");
	});

	test("description 前后空格被 trim", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, description: "  hello  " } });
		expect(serializeTaskLine(task)).toBe("- [ ] hello");
	});

	test("status symbol x (DONE)", () => {
		const task = makeTask({ status: { symbol: "x", type: "DONE" } });
		expect(serializeTaskLine(task)).toStartWith("- [x]");
	});

	test("status symbol - (IN_PROGRESS)", () => {
		const task = makeTask({ status: { symbol: "-", type: "IN_PROGRESS" } });
		expect(serializeTaskLine(task)).toStartWith("- [-]");
	});

	test("带优先级", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, priority: TASK_SYMBOLS.priority.highest } });
		expect(serializeTaskLine(task)).toContain(TASK_SYMBOLS.priority.highest);
	});

	test("带 due 日期", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, dates: { ...makeTask().metadata.dates, due: "2024-06-15" } } });
		expect(serializeTaskLine(task)).toBe(`- [ ] test task ${TASK_SYMBOLS.due} 2024-06-15`);
	});

	test("带 scheduled 日期", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, dates: { ...makeTask().metadata.dates, scheduled: "2024-06-10" } } });
		expect(serializeTaskLine(task)).toContain(`${TASK_SYMBOLS.scheduled} 2024-06-10`);
	});

	test("带 start 日期", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, dates: { ...makeTask().metadata.dates, start: "2024-06-01" } } });
		expect(serializeTaskLine(task)).toContain(`${TASK_SYMBOLS.start} 2024-06-01`);
	});

	test("带 done 日期", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, dates: { ...makeTask().metadata.dates, done: "2024-06-20" } } });
		expect(serializeTaskLine(task)).toContain(`${TASK_SYMBOLS.done} 2024-06-20`);
	});

	test("带循环", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, recurrence: "every week" } });
		expect(serializeTaskLine(task)).toContain(`${TASK_SYMBOLS.recurrence} every week`);
	});

	test("带 id", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, id: "abc123" } });
		expect(serializeTaskLine(task)).toContain(`${TASK_SYMBOLS.id} abc123`);
	});

	test("带 dependsOn", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, dependsOn: "xyz" } });
		expect(serializeTaskLine(task)).toContain(`${TASK_SYMBOLS.dependsOn} xyz`);
	});

	test("带 onCompletion", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, onCompletion: "delete" } });
		expect(serializeTaskLine(task)).toContain(`${TASK_SYMBOLS.onCompletion} delete`);
	});

	test("带 blockLink", () => {
		const task = makeTask({ metadata: { ...makeTask().metadata, blockLink: "^block" } });
		expect(serializeTaskLine(task)).toEndWith("^block");
	});

	test("全字段任务", () => {
		const task: TaskTodoTaskLine = {
			status: { symbol: "x", type: "DONE" },
			metadata: {
				description: "full task",
				priority: TASK_SYMBOLS.priority.high,
				dates: { start: "2024-01-01", scheduled: "2024-06-01", due: "2024-06-15", done: "2024-06-14" },
				recurrence: "every month",
				onCompletion: "archive",
				id: "tid1",
				dependsOn: "tid0",
				blockLink: "^abc",
			},
		};
		const line = serializeTaskLine(task);
		expect(line).toStartWith("- [x] full task");
		expect(line).toContain(TASK_SYMBOLS.priority.high);
		expect(line).toContain(`${TASK_SYMBOLS.start} 2024-01-01`);
		expect(line).toContain(`${TASK_SYMBOLS.scheduled} 2024-06-01`);
		expect(line).toContain(`${TASK_SYMBOLS.due} 2024-06-15`);
		expect(line).toContain(`${TASK_SYMBOLS.done} 2024-06-14`);
		expect(line).toContain(`${TASK_SYMBOLS.recurrence} every month`);
		expect(line).toContain(`${TASK_SYMBOLS.onCompletion} archive`);
		expect(line).toContain(`${TASK_SYMBOLS.dependsOn} tid0`);
		expect(line).toContain(`${TASK_SYMBOLS.id} tid1`);
		expect(line).toEndWith("^abc");
	});

	test("日期为 null 时不输出", () => {
		const task = makeTask();
		const line = serializeTaskLine(task);
		expect(line).not.toContain(TASK_SYMBOLS.due);
		expect(line).not.toContain(TASK_SYMBOLS.scheduled);
		expect(line).not.toContain(TASK_SYMBOLS.start);
		expect(line).not.toContain(TASK_SYMBOLS.done);
	});
});

describe("todayString", () => {
	test("返回 YYYY-MM-DD 格式", () => {
		(globalThis as Record<string, unknown>).window = {
			moment: () => ({ format: (fmt: string) => "2024-06-15" }),
		};
		const result = todayString();
		expect(result).toBe("2024-06-15");
	});
});
