import { Notice, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, TFile } from "obsidian";
import { t, type I18nKey } from "./i18n";
import { getTaskLiteHost, type TaskTodoHost, type CreateTaskInput } from "./host";
import { TASKTODO_VIEW, TaskTodoTaskListView } from "./taskTodo/taskListView";
import { openTaskLineModal, openTaskLineModalWithTarget, type TaskLineModalResult } from "./taskTodo/taskLineModal";
import { type SortKey } from "./taskTodo/taskTodoSort";
import { fieldsFromTaskLine, type StatusRegistry } from "./taskTodo/taskLineFields";

export interface TaskTodoSettings {
	sortOrder: SortKey[];
}

export const DEFAULT_SETTINGS: TaskTodoSettings = {
	sortOrder: ["date", "cancelled", "importance", "lifeLength"],
};

export default class TaskTodoPlugin extends Plugin {
	private host: TaskTodoHost | null = null;
	settings!: TaskTodoSettings;
	private originalTasksApi: unknown = null;

	async onload(): Promise<void> {
		this.host = getTaskLiteHost(this.app);
		if (!this.host) {
			new Notice(t("notice.taskLiteMissing"));
			return;
		}

		await this.loadSettings();

		this.originalTasksApi = (window as any).TasksPluginApi;
		(window as any).TasksPluginApi = {
			getApi: (version: string) => {
				if (version !== "v1") return undefined;
				return {
					isTasksPluginEnabled: () => true,
					createTaskLineModal: () => {
						return this.openTaskLineModal({
							title: t("command.createTask"),
							initialLine: "",
						});
					},
					editTaskLineModal: (taskLine: string) => {
						return this.openTaskLineModal({
							title: t("command.editTask"),
							initialLine: taskLine,
						});
					},
					executeToggleTaskDoneCommand: (line: string, path: string) => {
						if (!this.host) return line;
						return this.host.api.executeTasksToggleCommand(line, path);
					},
				};
			},
		};

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
			// 写入其他文件时，通过 TaskLite API 创建任务，避免直接操作 vault
			const fields = fieldsFromTaskLine(result.line, this.host.statusRegistry as unknown as StatusRegistry);
			const input: CreateTaskInput = {
				description: fields.description,
				status: fields.statusSymbol,
				priority: fields.priority || null,
				dates: {
					start: fields.start || null,
					scheduled: fields.scheduled || null,
					due: fields.due || null,
				},
				recurrence: fields.recurrence || null,
				onCompletion: fields.onCompletion || null,
				id: fields.id || null,
				dependsOn: fields.dependsOn || null,
				path: targetPath,
			};
			try {
				await this.host.api.createTask(input);
			} catch (error) {
				new Notice(t("notice.inboxPathFolder"));
				console.warn("TaskTodo failed to create task in target file", error);
			}
			return;
		}

		// 写入当前正在编辑的文件时，通过编辑器 API 在光标位置插入，保留光标上下文
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

	onunload(): void {
		if (this.originalTasksApi !== undefined) {
			(window as any).TasksPluginApi = this.originalTasksApi;
		}
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
			.addButton((button) =>
				button
					.setButtonText(t("common.reset"))
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.sortOrder = [...DEFAULT_SETTINGS.sortOrder];
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		const sortContainer = containerEl.createDiv({ cls: "tasktodo-sort-container" });
		let currentKeys = [...this.plugin.settings.sortOrder];

		const getSortKeyI18nKey = (key: SortKey): I18nKey => {
			switch (key) {
				case "date":
					return "settings.sortKey.date";
				case "cancelled":
					return "settings.sortKey.cancelled";
				case "importance":
					return "settings.sortKey.importance";
				case "lifeLength":
					return "settings.sortKey.lifeLength";
			}
		};

		const saveKeys = async (keys: SortKey[]) => {
			this.plugin.settings.sortOrder = keys;
			await this.plugin.saveSettings();
		};

		const renderList = () => {
			sortContainer.empty();

			currentKeys.forEach((key, index) => {
				const itemEl = sortContainer.createDiv({ cls: "tasktodo-sort-item" });
				itemEl.setAttribute("draggable", "true");
				itemEl.setAttribute("data-key", key);
				itemEl.setAttribute("data-index", String(index));

				itemEl.createDiv({ cls: "tasktodo-sort-item-handle", text: "⋮⋮" });
				itemEl.createDiv({ cls: "tasktodo-sort-item-title", text: t(getSortKeyI18nKey(key)) });

				const actionsEl = itemEl.createDiv({ cls: "tasktodo-sort-item-actions" });

				const upBtn = actionsEl.createEl("button", {
					cls: "tasktodo-sort-item-btn",
					text: "▲",
					title: "Move up",
				});
				if (index === 0) {
					upBtn.setAttribute("disabled", "true");
				} else {
					upBtn.addEventListener("click", async (e) => {
						e.stopPropagation();
						const temp = currentKeys[index]!;
						currentKeys[index] = currentKeys[index - 1]!;
						currentKeys[index - 1] = temp;
						await saveKeys(currentKeys);
						renderList();
					});
				}

				const downBtn = actionsEl.createEl("button", {
					cls: "tasktodo-sort-item-btn",
					text: "▼",
					title: "Move down",
				});
				if (index === currentKeys.length - 1) {
					downBtn.setAttribute("disabled", "true");
				} else {
					downBtn.addEventListener("click", async (e) => {
						e.stopPropagation();
						const temp = currentKeys[index]!;
						currentKeys[index] = currentKeys[index + 1]!;
						currentKeys[index + 1] = temp;
						await saveKeys(currentKeys);
						renderList();
					});
				}

				itemEl.addEventListener("dragstart", (e) => {
					if (e.dataTransfer) {
						e.dataTransfer.setData("text/plain", String(index));
						e.dataTransfer.effectAllowed = "move";
					}
					itemEl.addClass("is-dragging");
				});

				itemEl.addEventListener("dragend", async () => {
					itemEl.removeClass("is-dragging");
					const childElements = Array.from(sortContainer.querySelectorAll(".tasktodo-sort-item"));
					const newKeys = childElements
						.map((el) => el.getAttribute("data-key") as SortKey)
						.filter(Boolean);

					currentKeys = newKeys;
					await saveKeys(currentKeys);
					renderList();
				});

				itemEl.addEventListener("dragover", (e) => {
					e.preventDefault();
					const draggingEl = sortContainer.querySelector(".is-dragging") as HTMLElement;
					if (!draggingEl || draggingEl === itemEl) return;

					const rect = itemEl.getBoundingClientRect();
					const next = (e.clientY - rect.top) / rect.height > 0.5;
					sortContainer.insertBefore(draggingEl, next ? itemEl.nextSibling : itemEl);
				});
			});
		};

		renderList();
	}
}
