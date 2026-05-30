import { describe, expect, test } from "bun:test";
import { getTaskLiteHost, TASKLITE_PLUGIN_ID } from "../src/host";

function makeApp(plugins?: Record<string, unknown>) {
	return { plugins: { plugins } } as Parameters<typeof getTaskLiteHost>[0];
}

function makeHostPlugin(overrides: Record<string, unknown> = {}) {
	return {
		api: { listTasks: async () => [] },
		statusRegistry: { get: () => ({ symbol: " ", name: "Todo", type: "TODO" }) },
		settings: { statusSettings: {} },
		...overrides,
	};
}

describe("getTaskLiteHost", () => {
	test("正常返回 host 对象", () => {
		const plugin = makeHostPlugin();
		const app = makeApp({ [TASKLITE_PLUGIN_ID]: plugin });
		const host = getTaskLiteHost(app);
		expect(host).not.toBeNull();
		expect(host!.api).toBe(plugin.api);
		expect(host!.statusRegistry).toBe(plugin.statusRegistry);
		expect(host!.settings).toBe(plugin.settings);
	});

	test("缺少 api 返回 null", () => {
		const plugin = makeHostPlugin({ api: undefined });
		const app = makeApp({ [TASKLITE_PLUGIN_ID]: plugin });
		expect(getTaskLiteHost(app)).toBeNull();
	});

	test("缺少 statusRegistry 返回 null", () => {
		const plugin = makeHostPlugin({ statusRegistry: undefined });
		const app = makeApp({ [TASKLITE_PLUGIN_ID]: plugin });
		expect(getTaskLiteHost(app)).toBeNull();
	});

	test("缺少 settings 返回 null", () => {
		const plugin = makeHostPlugin({ settings: undefined });
		const app = makeApp({ [TASKLITE_PLUGIN_ID]: plugin });
		expect(getTaskLiteHost(app)).toBeNull();
	});

	test("插件不存在返回 null", () => {
		const app = makeApp({});
		expect(getTaskLiteHost(app)).toBeNull();
	});

	test("app.plugins 为 undefined 返回 null", () => {
		const app = { plugins: undefined } as unknown as Parameters<typeof getTaskLiteHost>[0];
		expect(getTaskLiteHost(app)).toBeNull();
	});
});
