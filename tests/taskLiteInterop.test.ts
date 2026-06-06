import { describe, expect, test } from "bun:test";
import { serializeTaskLine, TASK_SYMBOLS, todayString } from "../src/taskLiteInterop";
import type { TaskTodoTaskLine } from "../src/host";

const mockRegistry = {
	getByType: (type: string) => {
		if (type === "DONE") return { symbol: "x" };
		if (type === "CANCELLED") return { symbol: "-" };
		if (type === "IN_PROGRESS") return { symbol: "/" };
		return { symbol: " " };
	}
};

function makeTask(overrides: Partial<TaskTodoTaskLine> = {}): TaskTodoTaskLine {
	return {
		status: "TODO",
		description: "test task",
		priority: null,
		dates: { start: null, created: null, scheduled: null, due: null, done: null, cancelled: null, remind: null },
		recurrence: null,
		onCompletion: null,
		id: null,
		dependsOn: null,
		assignee: [],
		blockLink: null,
		...overrides,
	};
}

describe("serializeTaskLine", () => {
	test("最小任务：只有 description", () => {
		const task = makeTask();
		expect(serializeTaskLine(task, mockRegistry)).toBe("- [ ] test task");
	});

	test("description 前后空格被 trim", () => {
		const task = makeTask({ description: "  hello  " });
		expect(serializeTaskLine(task, mockRegistry)).toBe("- [ ] hello");
	});

	test("status symbol x (DONE)", () => {
		const task = makeTask({ status: "DONE" });
		expect(serializeTaskLine(task, mockRegistry)).toStartWith("- [x]");
	});

	test("status symbol - (IN_PROGRESS)", () => {
		const task = makeTask({ status: "IN_PROGRESS" });
		expect(serializeTaskLine(task, mockRegistry)).toStartWith("- [/]");
	});

	test("带优先级", () => {
		const task = makeTask({ priority: TASK_SYMBOLS.priority.highest });
		expect(serializeTaskLine(task, mockRegistry)).toContain(TASK_SYMBOLS.priority.highest);
	});

	test("带 due 日期", () => {
		const task = makeTask({ dates: { start: null, created: null, scheduled: null, due: "2024-06-15", done: null, cancelled: null, remind: null } });
		expect(serializeTaskLine(task, mockRegistry)).toBe(`- [ ] test task ${TASK_SYMBOLS.due} 2024-06-15`);
	});

	test("带 scheduled 日期", () => {
		const task = makeTask({ dates: { start: null, created: null, scheduled: "2024-06-10", due: null, done: null, cancelled: null, remind: null } });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.scheduled} 2024-06-10`);
	});

	test("带 start 日期", () => {
		const task = makeTask({ dates: { start: "2024-06-01", created: null, scheduled: null, due: null, done: null, cancelled: null, remind: null } });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.start} 2024-06-01`);
	});

	test("带 done 日期", () => {
		const task = makeTask({ dates: { start: null, created: null, scheduled: null, due: null, done: "2024-06-20", cancelled: null, remind: null } });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.done} 2024-06-20`);
	});

	test("带 created 日期", () => {
		const task = makeTask({ dates: { start: null, created: "2024-05-31", scheduled: null, due: null, done: null, cancelled: null, remind: null } });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.created} 2024-05-31`);
	});

	test("带 cancelled 日期", () => {
		const task = makeTask({ dates: { start: null, created: null, scheduled: null, due: null, done: null, cancelled: "2024-06-21", remind: null } });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.cancelled} 2024-06-21`);
	});

	test("带 remind 日期时间", () => {
		const task = makeTask({ dates: { start: null, created: null, scheduled: null, due: null, done: null, cancelled: null, remind: "2024-06-21 09:30" } });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.remind} 2024-06-21 09:30`);
	});

	test("带循环", () => {
		const task = makeTask({ recurrence: "every week" });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.recurrence} every week`);
	});

	test("带 id", () => {
		const task = makeTask({ id: "abc123" });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.id} abc123`);
	});

	test("带 dependsOn", () => {
		const task = makeTask({ dependsOn: "xyz" });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.dependsOn} xyz`);
	});

	test("带 onCompletion", () => {
		const task = makeTask({ onCompletion: "delete" });
		expect(serializeTaskLine(task, mockRegistry)).toContain(`${TASK_SYMBOLS.onCompletion} delete`);
	});

	test("带 blockLink", () => {
		const task = makeTask({ blockLink: "^block" });
		expect(serializeTaskLine(task, mockRegistry)).toEndWith("^block");
	});

	test("全字段任务", () => {
		const task: TaskTodoTaskLine = {
			status: "DONE",
			description: "full task",
			priority: TASK_SYMBOLS.priority.high,
			dates: { start: "2024-01-01", created: "2024-05-31", scheduled: "2024-06-01", due: "2024-06-15", done: "2024-06-14", cancelled: "2024-06-21", remind: "2024-06-12 15:00" },
			recurrence: "every month",
			onCompletion: "archive",
			id: "tid1",
			dependsOn: "tid0",
			assignee: ["John", "Mary"],
			blockLink: "^abc",
		};
		const line = serializeTaskLine(task, mockRegistry);
		expect(line).toStartWith("- [x] full task");
		expect(line).toContain(TASK_SYMBOLS.priority.high);
		expect(line).toContain(`${TASK_SYMBOLS.start} 2024-01-01`);
		expect(line).toContain(`${TASK_SYMBOLS.created} 2024-05-31`);
		expect(line).toContain(`${TASK_SYMBOLS.scheduled} 2024-06-01`);
		expect(line).toContain(`${TASK_SYMBOLS.due} 2024-06-15`);
		expect(line).toContain(`${TASK_SYMBOLS.done} 2024-06-14`);
		expect(line).toContain(`${TASK_SYMBOLS.cancelled} 2024-06-21`);
		expect(line).toContain(`${TASK_SYMBOLS.remind} 2024-06-12 15:00`);
		expect(line).toContain(`${TASK_SYMBOLS.recurrence} every month`);
		expect(line).toContain(`${TASK_SYMBOLS.onCompletion} archive`);
		expect(line).toContain(`${TASK_SYMBOLS.dependsOn} tid0`);
		expect(line).toContain(`${TASK_SYMBOLS.id} tid1`);
		expect(line).toContain(`${TASK_SYMBOLS.assignee} John & Mary`);
		expect(line).toEndWith("^abc");
	});

	test("日期为 null 时不输出", () => {
		const task = makeTask();
		const line = serializeTaskLine(task, mockRegistry);
		expect(line).not.toContain(TASK_SYMBOLS.due);
		expect(line).not.toContain(TASK_SYMBOLS.scheduled);
		expect(line).not.toContain(TASK_SYMBOLS.start);
		expect(line).not.toContain(TASK_SYMBOLS.created);
		expect(line).not.toContain(TASK_SYMBOLS.done);
		expect(line).not.toContain(TASK_SYMBOLS.cancelled);
		expect(line).not.toContain(TASK_SYMBOLS.remind);
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
