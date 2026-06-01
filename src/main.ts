import { Notice, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, TFile, App, Modal } from "obsidian";
import { t, type I18nKey } from "./i18n";
import { getTaskLiteHost, type TaskTodoHost, type CreateTaskInput } from "./host";
import { TASKTODO_VIEW, TaskTodoTaskListView } from "./taskTodo/taskListView";
import { openTaskLineModal, openTaskLineModalWithTarget, type TaskLineModalResult } from "./taskTodo/taskLineModal";
import { type SortKey } from "./taskTodo/taskTodoSort";
import { fieldsFromTaskLine, type StatusRegistry } from "./taskTodo/taskLineFields";

export interface DateFilterField {
	mode: "all" | "today" | "tomorrow" | "this-week" | "no-date" | "overdue" | "has-date" | "later" | "custom";
	customStart?: string;
	customEnd?: string;
}

export interface FilterConfig {
	completed: "all" | "completed" | "uncompleted";
	cancelled: "all" | "cancelled" | "uncancelled";
	priority: string[];
	text?: string;
	tag?: string;
	dateFilterRelation?: "or" | "and";
	startDate: DateFilterField;
	scheduledDate: DateFilterField;
	dueDate: DateFilterField;
	// Backward compatibility:
	dates?: "all" | "today" | "tomorrow" | "this-week" | "no-date" | "overdue" | "has-date" | "later" | "custom";
	customDateStart?: string;
	customDateEnd?: string;
}

export interface TabConfig {
	id: string;
	title: string;
	filter: FilterConfig;
	columns: ColumnConfig[];
}

export interface ColumnConfig {
	id: string;
	title: string;
	filter: FilterConfig;
}

export interface TaskTodoSettings {
	sortOrder: SortKey[];
	tabs: TabConfig[];
	columns?: ColumnConfig[];
}

export const DEFAULT_SETTINGS: TaskTodoSettings = {
	sortOrder: ["date", "cancelled", "importance", "lifeLength"],
	tabs: [],
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
				const file = view.file;
				if (!file) return false;
				void this.editTaskInEditor(editor, file);
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
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		const createDefaultColumns = (): ColumnConfig[] => [
			{
				id: "overdue_" + Math.random(),
				title: t("taskTodo.group.overdue") || "已过期",
				filter: getEnforcedColumnFilter("overdue")
			},
			{
				id: "today_" + Math.random(),
				title: t("taskTodo.group.today") || "今天",
				filter: getEnforcedColumnFilter("today")
			},
			{
				id: "tomorrow_" + Math.random(),
				title: t("taskTodo.group.tomorrow") || "明天",
				filter: getEnforcedColumnFilter("tomorrow")
			},
			{
				id: "week_" + Math.random(),
				title: t("taskTodo.group.next7Days") || "本周",
				filter: getEnforcedColumnFilter("week")
			},
			{
				id: "later_" + Math.random(),
				title: t("taskTodo.group.later") || "以后",
				filter: getEnforcedColumnFilter("later")
			},
			{
				id: "no-date_" + Math.random(),
				title: t("taskTodo.group.noDate") || "无日期",
				filter: getEnforcedColumnFilter("no-date")
			}
		];

		if (!this.settings.tabs || this.settings.tabs.length === 0) {
			this.settings.tabs = [
				{
					id: "in-plan",
					title: t("taskTodo.tab.inPlan"),
					filter: getEnforcedTabFilter("in-plan"),
					columns: createDefaultColumns()
				},
				{
					id: "today",
					title: t("taskTodo.tab.today"),
					filter: getEnforcedTabFilter("today"),
					columns: createDefaultColumns()
				}
			];
		} else {
			for (const tab of this.settings.tabs) {
				tab.filter = getEnforcedTabFilter(tab.id);
				if (!tab.columns) {
					tab.columns = [];
				}
				if (tab.columns.length === 0) {
					tab.columns = createDefaultColumns();
				} else {
					for (const col of tab.columns) {
						col.filter = getEnforcedColumnFilter(col.id);
					}
				}
			}
		}
	}

	async saveSettings(): Promise<void> {
		if (this.settings.tabs) {
			for (const tab of this.settings.tabs) {
				tab.filter = getEnforcedTabFilter(tab.id);
				if (tab.columns) {
					for (const col of tab.columns) {
						col.filter = getEnforcedColumnFilter(col.id);
					}
				}
			}
		}
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

		// 目标是当前文件：通过 TaskLite API 创建，追加到文件末尾
		const fields = fieldsFromTaskLine(result.line, this.host.statusRegistry as unknown as StatusRegistry);
		const input: CreateTaskInput = {
			description: fields.description,
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
			path: currentFile.path,
		};
		try {
			await this.host.api.createTask(input);
		} catch (error) {
			new Notice(t("notice.inboxPathFolder"));
			console.warn("TaskTodo failed to create task in current file", error);
		}
	}

	private async editTaskInEditor(editor: Editor, file: TFile): Promise<void> {
		if (!this.host) return;
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		const newLine = await openTaskLineModal({
			app: this.app,
			title: t("command.editTask"),
			initialLine: currentLine,
			registry: this.host.statusRegistry as any,
			settings: this.host.settings as any,
		});
		if (!newLine || newLine === currentLine) return;

		const registry = this.host.statusRegistry as unknown as StatusRegistry;
		const oldFields = fieldsFromTaskLine(currentLine, registry);
		const newFields = fieldsFromTaskLine(newLine, registry);

		// 通过 TaskLite API 更新元数据字段
		await this.host.api.editTask(file.path, cursor.line, {
			description: newFields.description,
			priority: newFields.priority || null,
			dates: {
				start: newFields.start || null,
				scheduled: newFields.scheduled || null,
				due: newFields.due || null,
			},
			recurrence: newFields.recurrence || null,
			onCompletion: newFields.onCompletion || null,
			id: newFields.id || null,
			dependsOn: newFields.dependsOn || null,
		});

		// 状态变更通过专用 API 处理（editTask 不涉及状态）
		if (newFields.statusSymbol !== oldFields.statusSymbol) {
			await this.host.api.updateTaskStatus(file.path, cursor.line, newFields.statusSymbol);
		}
	}

	private async createOrEditTaskInEditor(editor: Editor, file: TFile): Promise<void> {
		const cursor = editor.getCursor();
		const currentLine = editor.getLine(cursor.line);
		if (currentLine.trim() === "") {
			await this.createTaskInEditor(editor, file);
			return;
		}
		await this.editTaskInEditor(editor, file);
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

		// Tabs settings
		containerEl.createEl("h3", { text: t("settings.tabs.title") });
		new Setting(containerEl)
			.setDesc(t("settings.tabs.desc"))
			.addButton((button) =>
				button
					.setButtonText(t("settings.add"))
					.setCta()
					.onClick(() => {
						const newTab: TabConfig = {
							id: "tab_" + Date.now(),
							title: "New Tab",
							filter: getEnforcedTabFilter("tab_" + Date.now()),
							columns: []
						};
						new TabOrColumnModal(this.app, newTab, async (result) => {
							const tab: TabConfig = {
								id: newTab.id,
								title: result.title,
								filter: getEnforcedTabFilter(newTab.id),
								columns: []
							};
							this.plugin.settings.tabs.push(tab);
							await this.plugin.saveSettings();
							this.display();
						}).open();
					})
			);

		const tabsContainer = containerEl.createDiv({ cls: "tasktodo-tabs-container" });
		
		this.plugin.settings.tabs.forEach((tab, tabIndex) => {
			const tabCard = tabsContainer.createDiv({ cls: "tasktodo-card" });
			tabCard.setAttribute("draggable", "true");
			tabCard.setAttribute("data-id", tab.id);
			
			const tabHeader = tabCard.createDiv({ cls: "tasktodo-card-header" });
			tabHeader.createDiv({ cls: "tasktodo-sort-item-handle", text: "⋮⋮", attr: { style: "cursor: grab; margin-right: 0.5rem;" } });
			tabHeader.createDiv({ cls: "tasktodo-card-title", text: tab.title });
			
			const tabActions = tabHeader.createDiv({ cls: "tasktodo-sort-item-actions" });
			
			const editTabBtn = tabActions.createEl("button", {
				cls: "tasktodo-sort-item-btn",
				text: "✏️",
				title: t("settings.edit")
			});
			editTabBtn.addEventListener("click", () => {
				new TabOrColumnModal(this.app, tab, async (result) => {
					tab.title = result.title;
					tab.filter = result.filter;
					await this.plugin.saveSettings();
					this.display();
				}).open();
			});
			
			const delTabBtn = tabActions.createEl("button", {
				cls: "tasktodo-sort-item-btn",
				text: "❌",
				title: t("settings.delete")
			});
			delTabBtn.addEventListener("click", async () => {
				this.plugin.settings.tabs.splice(tabIndex, 1);
				await this.plugin.saveSettings();
				this.display();
			});
			


			const colHeader = tabCard.createDiv({ cls: "tasktodo-nested-header" });
			colHeader.createDiv({ cls: "tasktodo-nested-title", text: t("settings.columns.title") });
			
			const addColBtn = colHeader.createEl("button", {
				cls: "taskslite-add-task",
				text: t("settings.add"),
				attr: { style: "height: 1.6rem; padding: 0 0.5rem; font-size: 0.8rem;" }
			});
			addColBtn.addEventListener("click", () => {
				const newCol: ColumnConfig = {
					id: "col_" + Date.now(),
					title: "New Column",
					filter: getEnforcedColumnFilter("col_" + Date.now())
				};
				new TabOrColumnModal(this.app, newCol, async (result) => {
					const col: ColumnConfig = {
						id: newCol.id,
						title: result.title,
						filter: getEnforcedColumnFilter(newCol.id)
					};
					tab.columns.push(col);
					await this.plugin.saveSettings();
					this.display();
				}).open();
			});
			
			const columnsContainer = tabCard.createDiv({ cls: "tasktodo-sort-container", attr: { "data-tab-id": tab.id } });
			
			tab.columns.forEach((col: ColumnConfig, colIndex: number) => {
				const colEl = columnsContainer.createDiv({ cls: "tasktodo-sort-item" });
				colEl.setAttribute("draggable", "true");
				colEl.setAttribute("data-id", col.id);
				colEl.setAttribute("data-index", String(colIndex));
				
				colEl.createDiv({ cls: "tasktodo-sort-item-handle", text: "⋮⋮" });
				
				const titleContainer = colEl.createDiv({ cls: "tasktodo-sort-item-title" });
				titleContainer.createEl("strong", { text: col.title });
				
				const colActions = colEl.createDiv({ cls: "tasktodo-sort-item-actions" });
				
				const editColBtn = colActions.createEl("button", {
					cls: "tasktodo-sort-item-btn",
					text: "✏️",
					title: t("settings.edit")
				});
				editColBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					new TabOrColumnModal(this.app, col, async (result) => {
						col.title = result.title;
						col.filter = result.filter;
						await this.plugin.saveSettings();
						this.display();
					}).open();
				});
				
				const delColBtn = colActions.createEl("button", {
					cls: "tasktodo-sort-item-btn",
					text: "❌",
					title: t("settings.delete")
				});
				delColBtn.addEventListener("click", async (e) => {
					e.stopPropagation();
					tab.columns.splice(colIndex, 1);
					await this.plugin.saveSettings();
					this.display();
				});
				
				colEl.addEventListener("dragstart", (e) => {
					if (e.dataTransfer) {
						e.dataTransfer.setData("text/plain", String(colIndex));
						e.dataTransfer.effectAllowed = "move";
					}
					colEl.addClass("is-dragging-column");
				});
				
				colEl.addEventListener("dragend", async () => {
					colEl.removeClass("is-dragging-column");
					const childElements = Array.from(columnsContainer.querySelectorAll(".tasktodo-sort-item"));
					const newCols = childElements
						.map((el) => {
							const id = el.getAttribute("data-id");
							return tab.columns.find((c: ColumnConfig) => c.id === id);
						})
						.filter(Boolean) as ColumnConfig[];
					
					tab.columns = newCols;
					await this.plugin.saveSettings();
					this.display();
				});
				
				colEl.addEventListener("dragover", (e) => {
					e.preventDefault();
					const draggingEl = columnsContainer.querySelector(".is-dragging-column") as HTMLElement;
					if (!draggingEl || draggingEl === colEl) return;
					
					const rect = colEl.getBoundingClientRect();
					const next = (e.clientY - rect.top) / rect.height > 0.5;
					columnsContainer.insertBefore(draggingEl, next ? colEl.nextSibling : colEl);
				});
			});
			
			tabCard.addEventListener("dragstart", (e) => {
				if ((e.target as HTMLElement).closest(".tasktodo-sort-item")) {
					e.preventDefault();
					return;
				}
				if (e.dataTransfer) {
					e.dataTransfer.setData("text/plain", String(tabIndex));
					e.dataTransfer.effectAllowed = "move";
				}
				tabCard.addClass("is-dragging-tab");
			});
			
			tabCard.addEventListener("dragend", async () => {
				tabCard.removeClass("is-dragging-tab");
				const childElements = Array.from(tabsContainer.querySelectorAll(".tasktodo-card"));
				const newTabs = childElements
					.map((el) => {
						const id = el.getAttribute("data-id");
						return this.plugin.settings.tabs.find((t) => t.id === id);
					})
					.filter(Boolean) as TabConfig[];
				
				this.plugin.settings.tabs = newTabs;
				await this.plugin.saveSettings();
				this.display();
			});
			
			tabCard.addEventListener("dragover", (e) => {
				e.preventDefault();
				const draggingEl = tabsContainer.querySelector(".is-dragging-tab") as HTMLElement;
				if (!draggingEl || draggingEl === tabCard) return;
				
				const rect = tabCard.getBoundingClientRect();
				const next = (e.clientY - rect.top) / rect.height > 0.5;
				tabsContainer.insertBefore(draggingEl, next ? tabCard.nextSibling : tabCard);
			});
		});
	}
}

export const createDefaultFilter = (): FilterConfig => ({
	completed: "uncompleted",
	cancelled: "uncancelled",
	priority: [],
	text: "",
	tag: "",
	dateFilterRelation: "or",
	startDate: { mode: "all" },
	scheduledDate: { mode: "all" },
	dueDate: { mode: "all" },
});

export const getEnforcedTabFilter = (tabId: string): FilterConfig => {
	if (tabId === "in-plan") {
		return {
			completed: "uncompleted",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "has-date" },
			scheduledDate: { mode: "has-date" },
			dueDate: { mode: "has-date" },
		};
	}
	if (tabId === "today") {
		return {
			completed: "uncompleted",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "today" },
			scheduledDate: { mode: "today" },
			dueDate: { mode: "today" },
		};
	}
	return {
		completed: "uncompleted",
		cancelled: "uncancelled",
		priority: [],
		text: "",
		tag: "",
		dateFilterRelation: "or",
		startDate: { mode: "all" },
		scheduledDate: { mode: "all" },
		dueDate: { mode: "all" },
	};
};

export const getEnforcedColumnFilter = (colId: string): FilterConfig => {
	if (colId.startsWith("overdue")) {
		return {
			completed: "all",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "overdue" },
			scheduledDate: { mode: "overdue" },
			dueDate: { mode: "overdue" },
		};
	}
	if (colId.startsWith("today")) {
		return {
			completed: "all",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "today" },
			scheduledDate: { mode: "today" },
			dueDate: { mode: "today" },
		};
	}
	if (colId.startsWith("tomorrow")) {
		return {
			completed: "all",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "tomorrow" },
			scheduledDate: { mode: "tomorrow" },
			dueDate: { mode: "tomorrow" },
		};
	}
	if (colId.startsWith("week") || colId.startsWith("this-week")) {
		return {
			completed: "all",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "this-week" },
			scheduledDate: { mode: "this-week" },
			dueDate: { mode: "this-week" },
		};
	}
	if (colId.startsWith("later")) {
		return {
			completed: "all",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "later" },
			scheduledDate: { mode: "later" },
			dueDate: { mode: "later" },
		};
	}
	if (colId.startsWith("no-date")) {
		return {
			completed: "all",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "and",
			startDate: { mode: "no-date" },
			scheduledDate: { mode: "no-date" },
			dueDate: { mode: "no-date" },
		};
	}
	return {
		completed: "all",
		cancelled: "uncancelled",
		priority: [],
		text: "",
		tag: "",
		dateFilterRelation: "or",
		startDate: { mode: "all" },
		scheduledDate: { mode: "all" },
		dueDate: { mode: "all" },
	};
};

class TabOrColumnModal extends Modal {
	private result: {
		title: string;
		filter: FilterConfig;
	};

	constructor(
		app: App,
		private initialData: { title: string; filter: FilterConfig },
		private onSave: (data: { title: string; filter: FilterConfig }) => void
	) {
		super(app);
		this.result = JSON.parse(JSON.stringify(initialData));
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("taskslite-modal");

		this.setTitle(t("modal.editConfig"));

		new Setting(contentEl)
			.setName(t("modal.name"))
			.addText((text) =>
				text
					.setValue(this.result.title)
					.onChange((val) => {
						this.result.title = val;
					})
			);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(t("common.cancel"))
					.onClick(() => this.close())
			)
			.addButton((button) =>
				button
					.setButtonText(t("common.save"))
					.setCta()
					.onClick(() => {
						if (!this.result.title.trim()) {
							new Notice("Title cannot be empty");
							return;
						}
						this.onSave(this.result);
						this.close();
					})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
