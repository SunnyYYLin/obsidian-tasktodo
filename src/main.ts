import { Notice, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, TFile } from "obsidian";
import { t } from "./i18n";
import { getTaskLiteHost, type TaskTodoHost } from "./host";
import { TASKTODO_VIEW, TaskTodoTaskListView } from "./taskTodo/taskListView";
import { openTaskLineModal, openTaskLineModalWithTarget, type TaskLineModalResult } from "./taskTodo/taskLineModal";

export interface TaskTodoSettings {
	sortOrderSetting: string;
}

export const DEFAULT_SETTINGS: TaskTodoSettings = {
	sortOrderSetting: "日期, 是否取消, 重要性, 生命长度",
};

export default class TaskTodoPlugin extends Plugin {
	private host: TaskTodoHost | null = null;
	settings!: TaskTodoSettings;

	async onload(): Promise<void> {
		this.host = getTaskLiteHost(this.app);
		if (!this.host) {
			new Notice(t("notice.taskLiteMissing"));
			return;
		}

		await this.loadSettings();

		this.registerView(TASKTODO_VIEW, (leaf) => new TaskTodoTaskListView(leaf, this.app, this.host!, this));
		this.addRibbonIcon("list-todo", t("command.openTaskTodo"), () => {
			void this.activateTaskTodoView();
		});
		this.addCommand({
			id: "open-task-list",
			name: t("command.openTaskList"),
			callback: () => {
				void this.activateTaskTodoView();
			},
		});

		this.addCommand({
			id: "create-task",
			name: t("command.createTask"),
			editorCheckCallback: (checking: boolean, editor: Editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				if (checking) return true;
				const file = view.file;
				if (!file) return false;
				void this.createTaskInEditor(editor, file);
				return true;
			},
		});

		this.addCommand({
			id: "edit-task",
			name: t("command.editTask"),
			editorCheckCallback: (checking: boolean, editor: Editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				if (checking) return true;
				void this.editTaskInEditor(editor);
				return true;
			},
		});

		this.addCommand({
			id: "create-or-edit-task",
			name: t("command.createOrEditTask"),
			editorCheckCallback: (checking: boolean, editor: Editor, view) => {
				if (!(view instanceof MarkdownView)) return false;
				if (checking) return true;
				const file = view.file;
				if (!file) return false;
				void this.createOrEditTaskInEditor(editor, file);
				return true;
			},
		});

		this.addSettingTab(new TaskTodoSettingTab(this.app, this));
	}

	private async activateTaskTodoView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(TASKTODO_VIEW);
		const leaf = leaves[0] ?? this.app.workspace.getLeaf("tab");
		await leaf.setViewState({type: TASKTODO_VIEW, active: true});
		await this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// 当设置更改时，重新渲染视图
		const leaves = this.app.workspace.getLeavesOfType(TASKTODO_VIEW);
		for (const leaf of leaves) {
			if (leaf.view instanceof TaskTodoTaskListView) {
				leaf.view.queueRender();
			}
		}
	}

	openTaskLineModal(options: {title: string; initialLine: string}): Promise<string> {
		if (!this.host) return Promise.resolve(options.initialLine);
		return openTaskLineModal({
			app: this.app,
			title: options.title,
			initialLine: options.initialLine,
			registry: this.host.statusRegistry as any,
			settings: this.host.settings as any,
		});
	}

	openTaskLineModalWithTarget(options: {
		title: string;
		initialLine: string;
		targetFile: {basePath: string; defaultValue: string};
		parentTask?: {
			options: Array<{label: string; path: string; lineNumber: number}>;
			initialValue?: {path: string; lineNumber: number};
		};
	}): Promise<TaskLineModalResult | null> {
		if (!this.host) return Promise.resolve(null);
		return openTaskLineModalWithTarget({
			app: this.app,
			title: options.title,
			initialLine: options.initialLine,
			registry: this.host.statusRegistry as any,
			settings: this.host.settings as any,
			targetFile: options.targetFile,
			parentTask: options.parentTask,
		});
	}

	private async createTaskInEditor(editor: Editor, currentFile: TFile): Promise<void> {
		if (!this.host) return;
		const result = await openTaskLineModalWithTarget({
			app: this.app,
			title: t("command.createTask"),
			initialLine: "",
			registry: this.host.statusRegistry as any,
			settings: this.host.settings as any,
			targetFile: {basePath: currentFile.parent?.path ?? "", defaultValue: currentFile.basename},
		});
		if (!result?.line) return;

		const targetPath = result.targetPath ?? currentFile.path;
		if (targetPath !== currentFile.path) {
			const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (targetFile instanceof TFile) {
				const content = await this.app.vault.read(targetFile);
				const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
				await this.app.vault.modify(targetFile, `${content}${separator}${result.line}\n`);
			}
			return;
		}

		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		if (currentLine.trim() === "") {
			editor.replaceRange(result.line, {line: cursor.line, ch: 0}, {line: cursor.line, ch: currentLine.length});
			editor.setCursor({line: cursor.line, ch: result.line.length});
			return;
		}

		editor.replaceRange(`\n${result.line}`, {line: cursor.line, ch: currentLine.length});
		editor.setCursor({line: cursor.line + 1, ch: result.line.length});
	}

	private async editTaskInEditor(editor: Editor): Promise<void> {
		if (!this.host) return;
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		const line = await openTaskLineModal({
			app: this.app,
			title: t("command.editTask"),
			initialLine: currentLine,
			registry: this.host.statusRegistry as any,
			settings: this.host.settings as any,
		});
		if (!line) return;

		editor.replaceRange(line, {line: cursor.line, ch: 0}, {line: cursor.line, ch: currentLine.length});
		editor.setCursor({line: cursor.line, ch: Math.min(cursor.ch, line.length)});
	}

	private async createOrEditTaskInEditor(editor: Editor, file: TFile): Promise<void> {
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		if (currentLine.trim() === "") {
			await this.createTaskInEditor(editor, file);
			return;
		}
		await this.editTaskInEditor(editor);
	}
}

class TaskTodoSettingTab extends PluginSettingTab {
	constructor(app: typeof Plugin.prototype.app, private plugin: TaskTodoPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: t("settings.title") });

		new Setting(containerEl)
			.setName(t("settings.sortOrder.name"))
			.setDesc(t("settings.sortOrder.desc"))
			.addText((text) =>
				text
					.setPlaceholder("日期, 是否取消, 重要性, 生命长度")
					.setValue(this.plugin.settings.sortOrderSetting)
					.onChange(async (value) => {
						this.plugin.settings.sortOrderSetting = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
