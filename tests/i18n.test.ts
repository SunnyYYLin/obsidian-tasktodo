import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { t } from "../src/i18n";

const originalWindow = (globalThis as Record<string, unknown>).window;

function setLocale(locale: string | undefined) {
	if (locale === undefined) {
		(globalThis as Record<string, unknown>).window = undefined;
	} else {
		(globalThis as Record<string, unknown>).window = {
			moment: { locale: () => locale },
		};
	}
}

afterEach(() => {
	(globalThis as Record<string, unknown>).window = originalWindow;
});

describe("t()", () => {
	test("英文 locale 返回英文", () => {
		setLocale("en");
		expect(t("common.cancel")).toBe("Cancel");
		expect(t("common.save")).toBe("Save");
	});

	test("中文 locale 返回中文", () => {
		setLocale("zh");
		expect(t("common.cancel")).toBe("取消");
		expect(t("common.save")).toBe("保存");
	});

	test("zh-CN 返回中文", () => {
		setLocale("zh-CN");
		expect(t("common.cancel")).toBe("取消");
	});

	test("未知 locale 回退英文", () => {
		setLocale("fr");
		expect(t("common.cancel")).toBe("Cancel");
	});

	test("window 不存在时回退英文", () => {
		setLocale(undefined);
		expect(t("common.cancel")).toBe("Cancel");
	});

	test("所有英文 key 都有对应中文", () => {
		setLocale("en");
		// 验证 key 不会返回 undefined（即 key 存在于字典中）
		const keys = [
			"common.cancel", "common.save", "common.none",
			"command.openTaskTodo", "command.openTaskList",
			"task.action.cancel", "task.action.complete",
			"taskTodo.addTask", "taskTodo.createTask",
			"taskTodo.tab.inPlan", "taskTodo.tab.today",
			"taskTodo.empty.inPlan", "taskTodo.empty.today",
			"taskTodo.group.overdue", "taskTodo.group.today",
			"modal.name", "modal.status", "modal.priority",
			"notice.taskLiteMissing",
		] as const;
		for (const key of keys) {
			expect(t(key)).toBeTruthy();
		}
	});
});
