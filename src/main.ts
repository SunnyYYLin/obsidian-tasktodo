import { Notice, Plugin, PluginSettingTab, Setting, Editor, MarkdownView, TFile, App, Modal } from "obsidian";
import { t, type I18nKey } from "./i18n";
import { getTaskLiteHost, type TaskTodoHost, type CreateTaskInput } from "./host";
import { TASKTODO_VIEW, TaskTodoTaskListView } from "./taskTodo/taskListView";
import { openTaskLineModal, openTaskLineModalWithTarget, type TaskLineModalResult } from "./taskTodo/taskLineModal";
import { type SortKey } from "./taskTodo/taskTodoSort";
import { fieldsFromTaskLine, type StatusRegistry } from "./taskTodo/taskLineFields";

export interface DateFilterField {
	mode: "all" | "today" | "tomorrow" | "this-week" | "no-date" | "overdue" | "has-date" | "later" | "custom" | "today-or-overdue";
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
	queryMode?: "gui" | "advanced";
	query?: string;
	filter: FilterConfig;
	columns: ColumnConfig[];
}

export interface ColumnConfig {
	id: string;
	title: string;
	queryMode?: "gui" | "advanced";
	query?: string;
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

		const createDefaultInPlanColumns = (): ColumnConfig[] => [
			{
				id: "overdue_" + Math.random(),
				title: t("taskTodo.group.earlier") || "早前",
				queryMode: "gui",
				query: getEnforcedColumnDQL("in-plan", "overdue"),
				filter: getEnforcedColumnFilter("overdue")
			},
			{
				id: "today_" + Math.random(),
				title: t("taskTodo.group.today") || "今天",
				queryMode: "gui",
				query: getEnforcedColumnDQL("in-plan", "today"),
				filter: getEnforcedColumnFilter("today")
			},
			{
				id: "tomorrow_" + Math.random(),
				title: t("taskTodo.group.tomorrow") || "明天",
				queryMode: "gui",
				query: getEnforcedColumnDQL("in-plan", "tomorrow"),
				filter: getEnforcedColumnFilter("tomorrow")
			},
			{
				id: "week_" + Math.random(),
				title: t("taskTodo.group.next7Days") || "本周",
				queryMode: "gui",
				query: getEnforcedColumnDQL("in-plan", "week"),
				filter: getEnforcedColumnFilter("week")
			},
			{
				id: "later_" + Math.random(),
				title: t("taskTodo.group.later") || "以后",
				queryMode: "gui",
				query: getEnforcedColumnDQL("in-plan", "later"),
				filter: getEnforcedColumnFilter("later")
			},
			{
				id: "no-date_" + Math.random(),
				title: t("taskTodo.group.noDate") || "无日期",
				queryMode: "gui",
				query: getEnforcedColumnDQL("in-plan", "no-date"),
				filter: getEnforcedColumnFilter("no-date")
			}
		];

		const createDefaultTodayColumns = (): ColumnConfig[] => [
			{
				id: "overdue_" + Math.random(),
				title: t("taskTodo.group.overdue") || "已过期",
				queryMode: "gui",
				query: getEnforcedColumnDQL("today", "overdue"),
				filter: getEnforcedColumnFilter("overdue")
			},
			{
				id: "today_" + Math.random(),
				title: t("taskTodo.group.today") || "今天",
				queryMode: "gui",
				query: getEnforcedColumnDQL("today", "today"),
				filter: getEnforcedColumnFilter("today")
			}
		];

		if (!this.settings.tabs || this.settings.tabs.length === 0) {
			this.settings.tabs = [
				{
					id: "in-plan",
					title: t("taskTodo.tab.inPlan"),
					queryMode: "gui",
					query: getEnforcedTabDQL("in-plan"),
					filter: getEnforcedTabFilter("in-plan"),
					columns: createDefaultInPlanColumns()
				},
				{
					id: "today",
					title: t("taskTodo.tab.today"),
					queryMode: "gui",
					query: getEnforcedTabDQL("today"),
					filter: getEnforcedTabFilter("today"),
					columns: createDefaultTodayColumns()
				}
			];
		} else {
			for (const tab of this.settings.tabs) {
				if (!tab.queryMode) {
					tab.queryMode = "gui";
				}
				if (!tab.query || tab.query.trim() === "") {
					tab.query = getEnforcedTabDQL(tab.id);
				}
				tab.filter = getEnforcedTabFilter(tab.id);
				tab.columns = alignTabColumns(tab.id, tab.columns || []);
			}
		}
	}

	async saveSettings(): Promise<void> {
		if (this.settings.tabs) {
			for (const tab of this.settings.tabs) {
				if (tab.id === "today" || tab.id === "in-plan") {
					tab.filter = getEnforcedTabFilter(tab.id);
				}
				if (tab.queryMode === "gui" || !tab.queryMode) {
					tab.queryMode = "gui";
					tab.query = filterConfigToDQL(tab.filter);
				}
				if (tab.columns) {
					for (const col of tab.columns) {
						const key = getColumnKey(col.id);
						if (key && (tab.id === "today" || tab.id === "in-plan")) {
							col.filter = getEnforcedColumnFilter(col.id);
							if (col.id.startsWith("overdue")) {
								col.title = tab.id === "today" ? (t("taskTodo.group.overdue") || "已过期") : (t("taskTodo.group.earlier") || "早前");
							}
						}
						if (col.queryMode === "gui" || !col.queryMode) {
							col.queryMode = "gui";
							col.query = filterConfigToDQL(col.filter);
						}
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
							queryMode: "gui",
							query: filterConfigToDQL(getEnforcedTabFilter("tab_" + Date.now())),
							filter: getEnforcedTabFilter("tab_" + Date.now()),
							columns: []
						};
						new TabOrColumnModal(this.app, newTab, async (result) => {
							const tab: TabConfig = {
								id: newTab.id,
								title: result.title,
								queryMode: result.queryMode,
								query: result.query,
								filter: result.filter,
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
					tab.queryMode = result.queryMode;
					tab.query = result.query;
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
					queryMode: "gui",
					query: filterConfigToDQL(getEnforcedColumnFilter("col_" + Date.now())),
					filter: getEnforcedColumnFilter("col_" + Date.now())
				};
				new TabOrColumnModal(this.app, newCol, async (result) => {
					const col: ColumnConfig = {
						id: newCol.id,
						title: result.title,
						queryMode: result.queryMode,
						query: result.query,
						filter: result.filter
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
						col.queryMode = result.queryMode;
						col.query = result.query;
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
					e.stopPropagation();
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
	}
	if (tabId === "today") {
		return {
			completed: "uncompleted",
			cancelled: "uncancelled",
			priority: [],
			text: "",
			tag: "",
			dateFilterRelation: "or",
			startDate: { mode: "today-or-overdue" },
			scheduledDate: { mode: "today-or-overdue" },
			dueDate: { mode: "today-or-overdue" },
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
	if (colId.startsWith("tomorrow")) {
		return {
			completed: "uncompleted",
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
			completed: "uncompleted",
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
			completed: "uncompleted",
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
			completed: "uncompleted",
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

export const getColumnKey = (colId: string): string | null => {
	if (colId.startsWith("overdue")) return "overdue";
	if (colId.startsWith("today")) return "today";
	if (colId.startsWith("tomorrow")) return "tomorrow";
	if (colId.startsWith("week") || colId.startsWith("this-week")) return "week";
	if (colId.startsWith("later")) return "later";
	if (colId.startsWith("no-date")) return "no-date";
	return null;
};

export const getEnforcedTabDQL = (tabId: string): string => {
	if (tabId === "in-plan") {
		return 'status != "CANCELLED"';
	}
	if (tabId === "today") {
		return 'status != "DONE" AND status != "CANCELLED" AND (due <= date(today) OR scheduled <= date(today) OR start <= date(today))';
	}
	return "";
};

export const getEnforcedColumnDQL = (tabId: string, colKey: string): string => {
	if (colKey === "overdue") {
		if (tabId === "today") {
			return 'status != "DONE" AND status != "CANCELLED" AND (due < date(today) OR scheduled < date(today) OR start < date(today))';
		} else {
			return 'status != "CANCELLED" AND (due < date(today) OR scheduled < date(today) OR start < date(today))';
		}
	}
	if (colKey === "today") {
		return 'status != "DONE" AND status != "CANCELLED" AND (due = date(today) OR scheduled = date(today) OR start = date(today))';
	}
	if (colKey === "tomorrow") {
		return 'status != "DONE" AND status != "CANCELLED" AND (due = date(tomorrow) OR scheduled = date(tomorrow) OR start = date(tomorrow))';
	}
	if (colKey === "week") {
		return 'status != "DONE" AND status != "CANCELLED" AND ((due >= date(today) AND due <= date(next-week)) OR (scheduled >= date(today) AND scheduled <= date(next-week)) OR (start >= date(today) AND start <= date(next-week)))';
	}
	if (colKey === "later") {
		return 'status != "DONE" AND status != "CANCELLED" AND (due > date(next-week) OR scheduled > date(next-week) OR start > date(next-week))';
	}
	if (colKey === "no-date") {
		return 'status != "DONE" AND status != "CANCELLED" AND due = null AND scheduled = null AND start = null';
	}
	return "";
};

export const filterConfigToDQL = (filter: FilterConfig): string => {
	if (!filter) return "";
	const parts: string[] = [];

	// 1. Completed
	if (filter.completed === "completed") {
		parts.push('status = "DONE"');
	} else if (filter.completed === "uncompleted") {
		parts.push('status != "DONE"');
	}

	// 2. Cancelled
	if (filter.cancelled === "cancelled") {
		parts.push('status = "CANCELLED"');
	} else if (filter.cancelled === "uncancelled") {
		parts.push('status != "CANCELLED"');
	}

	// 3. Priority
	if (filter.priority && filter.priority.length > 0) {
		const priParts = filter.priority.map(pri => {
			if (pri === "none") return 'priority = ""';
			let emoji = "";
			if (pri === "highest") emoji = "⏫";
			else if (pri === "high") emoji = "🔼";
			else if (pri === "medium") emoji = "🔽";
			else if (pri === "low") emoji = "🔻";
			else if (pri === "lowest") emoji = "⏬";
			return `priority = "${emoji}"`;
		}).filter(Boolean);
		if (priParts.length > 0) {
			parts.push(`(${priParts.join(" OR ")})`);
		}
	}

	// 4. Dates
	const dateParts: string[] = [];
	const handleDateField = (field: DateFilterField, name: string) => {
		if (!field || field.mode === "all") return;
		if (field.mode === "no-date") {
			dateParts.push(`${name} = null`);
		} else if (field.mode === "has-date") {
			dateParts.push(`${name} != null`);
		} else if (field.mode === "today") {
			dateParts.push(`${name} = date(today)`);
		} else if (field.mode === "tomorrow") {
			dateParts.push(`${name} = date(tomorrow)`);
		} else if (field.mode === "this-week") {
			dateParts.push(`(${name} >= date(today) AND ${name} <= date(next-week))`);
		} else if (field.mode === "overdue") {
			dateParts.push(`${name} < date(today)`);
		} else if (field.mode === "today-or-overdue") {
			dateParts.push(`${name} <= date(today)`);
		} else if (field.mode === "later") {
			dateParts.push(`${name} > date(next-week)`);
		}
	};

	if (filter.startDate) handleDateField(filter.startDate, "start");
	if (filter.scheduledDate) handleDateField(filter.scheduledDate, "scheduled");
	if (filter.dueDate) handleDateField(filter.dueDate, "due");

	if (dateParts.length > 0) {
		const rel = filter.dateFilterRelation || "or";
		parts.push(`(${dateParts.join(` ${rel.toUpperCase()} `)})`);
	}

	// 5. Text search
	if (filter.text && filter.text.trim() !== "") {
		parts.push(`description contains "${filter.text.replace(/"/g, '\\"')}"`);
	}

	// 6. Tag filter
	if (filter.tag && filter.tag.trim() !== "") {
		parts.push(`tags contains "${filter.tag}"`);
	}

	return parts.join(" AND ");
};

export const alignTabColumns = (tabId: string, columns: ColumnConfig[]): ColumnConfig[] => {
	const defaultKeys = tabId === "today" 
		? ["overdue", "today"] 
		: ["overdue", "today", "tomorrow", "week", "later", "no-date"];

	const createDefaultCol = (key: string): ColumnConfig => {
		const id = key + "_" + Math.random();
		let title = "";
		if (key === "overdue") {
			title = tabId === "today" ? (t("taskTodo.group.overdue") || "已过期") : (t("taskTodo.group.earlier") || "早前");
		} else if (key === "today") {
			title = t("taskTodo.group.today") || "今天";
		} else if (key === "tomorrow") {
			title = t("taskTodo.group.tomorrow") || "明天";
		} else if (key === "week") {
			title = t("taskTodo.group.next7Days") || "本周";
		} else if (key === "later") {
			title = t("taskTodo.group.later") || "以后";
		} else if (key === "no-date") {
			title = t("taskTodo.group.noDate") || "无日期";
		}
		return {
			id,
			title,
			queryMode: "gui",
			query: getEnforcedColumnDQL(tabId, key),
			filter: getEnforcedColumnFilter(id)
		};
	};

	// 1. Keep only valid, non-duplicate columns
	const seenKeys = new Set<string>();
	const filtered: ColumnConfig[] = [];
	for (const col of columns) {
		const key = getColumnKey(col.id);
		if (key && defaultKeys.includes(key) && !seenKeys.has(key)) {
			seenKeys.add(key);
			filtered.push(col);
		}
	}

	// 2. Insert missing keys in their default relative positions
	const result = [...filtered];
	for (const key of defaultKeys) {
		if (!seenKeys.has(key)) {
			const newCol = createDefaultCol(key);
			const afterKeyIndex = defaultKeys.indexOf(key);
			let insertIdx = -1;
			for (let i = afterKeyIndex + 1; i < defaultKeys.length; i++) {
				const nextKey = defaultKeys[i];
				const idx = result.findIndex(c => getColumnKey(c.id) === nextKey);
				if (idx !== -1) {
					insertIdx = idx;
					break;
				}
			}
			if (insertIdx !== -1) {
				result.splice(insertIdx, 0, newCol);
			} else {
				result.push(newCol);
			}
			seenKeys.add(key);
		}
	}

	// 3. Enforce latest filters, titles and DQL queries on all result columns
	for (const col of result) {
		col.filter = getEnforcedColumnFilter(col.id);
		const key = getColumnKey(col.id);
		if (!col.queryMode) {
			col.queryMode = "gui";
		}
		if (key && (!col.query || col.query.trim() === "")) {
			col.query = getEnforcedColumnDQL(tabId, key);
		}
		if (key === "overdue") {
			col.title = tabId === "today" ? (t("taskTodo.group.overdue") || "已过期") : (t("taskTodo.group.earlier") || "早前");
		} else if (key === "today") {
			col.title = t("taskTodo.group.today") || "今天";
		} else if (key === "tomorrow") {
			col.title = t("taskTodo.group.tomorrow") || "明天";
		} else if (key === "week") {
			col.title = t("taskTodo.group.next7Days") || "本周";
		} else if (key === "later") {
			col.title = t("taskTodo.group.later") || "以后";
		} else if (key === "no-date") {
			col.title = t("taskTodo.group.noDate") || "无日期";
		}
	}

	return result;
};

class TabOrColumnModal extends Modal {
	private result: {
		title: string;
		queryMode?: "gui" | "advanced";
		query?: string;
		filter: FilterConfig;
	};

	constructor(
		app: App,
		private initialData: { title: string; filter: FilterConfig; queryMode?: "gui" | "advanced"; query?: string },
		private onSave: (data: { title: string; filter: FilterConfig; queryMode?: "gui" | "advanced"; query?: string }) => void
	) {
		super(app);
		this.result = JSON.parse(JSON.stringify(initialData));
		if (!this.result.queryMode) {
			this.result.queryMode = "gui";
		}
		if (!this.result.filter) {
			this.result.filter = createDefaultFilter();
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("taskslite-modal");

		this.setTitle(t("modal.editConfig"));

		// Title Setting
		new Setting(contentEl)
			.setName(t("modal.name"))
			.addText((text) =>
				text
					.setValue(this.result.title)
					.onChange((val) => {
						this.result.title = val;
					})
			);

		// Tabs container
		const tabsDiv = contentEl.createDiv({ cls: "tasktodo-modal-tabs" });
		const btnGui = tabsDiv.createEl("button", {
			cls: "tasktodo-modal-tab-btn",
			text: "普通过滤"
		});
		const btnAdvanced = tabsDiv.createEl("button", {
			cls: "tasktodo-modal-tab-btn",
			text: "高级 DQL"
		});

		// Content containers
		const contentGui = contentEl.createDiv({ cls: "tasktodo-modal-tab-content" });
		const contentAdvanced = contentEl.createDiv({ cls: "tasktodo-modal-tab-content" });

		// Tab switching logic
		const setActiveTab = (mode: "gui" | "advanced") => {
			this.result.queryMode = mode;
			if (mode === "gui") {
				btnGui.addClass("is-active");
				btnAdvanced.removeClass("is-active");
				contentGui.addClass("is-active");
				contentAdvanced.removeClass("is-active");
			} else {
				btnGui.removeClass("is-active");
				btnAdvanced.addClass("is-active");
				contentGui.removeClass("is-active");
				contentAdvanced.addClass("is-active");
			}
		};

		btnGui.addEventListener("click", () => setActiveTab("gui"));
		btnAdvanced.addEventListener("click", () => setActiveTab("advanced"));

		// ------------------ GUI Tab Content ------------------
		// Status Settings
		new Setting(contentGui)
			.setName("状态 (Completed)")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("all", "不限")
					.addOption("uncompleted", "未完成")
					.addOption("completed", "已完成")
					.setValue(this.result.filter.completed)
					.onChange((val) => {
						this.result.filter.completed = val as any;
					});
			});

		new Setting(contentGui)
			.setName("取消 (Cancelled)")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("all", "不限")
					.addOption("uncancelled", "未取消")
					.addOption("cancelled", "已取消")
					.setValue(this.result.filter.cancelled)
					.onChange((val) => {
						this.result.filter.cancelled = val as any;
					});
			});

		// Priority (Checkboxes)
		const prioritySetting = new Setting(contentGui)
			.setName("重要性 (Priority)")
			.setDesc("勾选以过滤特定优先级任务，均不勾选代表不限");
		
		const priorityContainer = prioritySetting.controlEl.createDiv({ cls: "tasktodo-priority-container" });
		const priorities = [
			{ key: "highest", label: "Highest ⏫" },
			{ key: "high", label: "High 🔼" },
			{ key: "medium", label: "Medium 🔽" },
			{ key: "low", label: "Low 🔻" },
			{ key: "lowest", label: "Lowest ⏬" },
			{ key: "none", label: "None 无" },
		];
		
		priorities.forEach((pri) => {
			const wrapper = priorityContainer.createEl("label", { cls: "tasktodo-priority-label" });
			const input = wrapper.createEl("input", { type: "checkbox" });
			wrapper.createSpan({ text: pri.label });

			const list = this.result.filter.priority || [];
			input.checked = list.includes(pri.key);

			input.addEventListener("change", () => {
				const current = this.result.filter.priority || [];
				if (input.checked) {
					if (!current.includes(pri.key)) {
						this.result.filter.priority = [...current, pri.key];
					}
				} else {
					this.result.filter.priority = current.filter(k => k !== pri.key);
				}
			});
		});

		// Dates dropdowns: Start, Scheduled, Due date mode
		const dateOptions = [
			{ mode: "all", label: "不限 (All)" },
			{ mode: "today", label: "今天 (Today)" },
			{ mode: "tomorrow", label: "明天 (Tomorrow)" },
			{ mode: "this-week", label: "本周 (This Week)" },
			{ mode: "no-date", label: "无日期 (No Date)" },
			{ mode: "overdue", label: "已逾期 (Overdue)" },
			{ mode: "today-or-overdue", label: "今天或逾期 (Today/Overdue)" },
			{ mode: "has-date", label: "有日期 (Has Date)" },
			{ mode: "later", label: "以后 (Later)" },
		];

		const addDateDropdown = (name: string, field: DateFilterField) => {
			new Setting(contentGui)
				.setName(name)
				.addDropdown((dropdown) => {
					dateOptions.forEach(opt => dropdown.addOption(opt.mode, opt.label));
					dropdown.setValue(field.mode || "all");
					dropdown.onChange((val) => {
						field.mode = val as any;
					});
				});
		};

		if (!this.result.filter.startDate) this.result.filter.startDate = { mode: "all" };
		if (!this.result.filter.scheduledDate) this.result.filter.scheduledDate = { mode: "all" };
		if (!this.result.filter.dueDate) this.result.filter.dueDate = { mode: "all" };

		addDateDropdown("开始日期 (Start Date)", this.result.filter.startDate);
		addDateDropdown("计划日期 (Scheduled Date)", this.result.filter.scheduledDate);
		addDateDropdown("截止日期 (Due Date)", this.result.filter.dueDate);

		// Date filter relation (AND / OR)
		new Setting(contentGui)
			.setName("多日期关联逻辑 (Relation)")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("or", "或 (OR) - 任一日期满足条件即可")
					.addOption("and", "与 (AND) - 所有日期必须满足条件")
					.setValue(this.result.filter.dateFilterRelation || "or")
					.onChange((val) => {
						this.result.filter.dateFilterRelation = val as any;
					});
			});

		// Legacy tag/text filters (optional but good to have)
		new Setting(contentGui)
			.setName("文本包含 (Description contains)")
			.addText((text) => {
				text.setValue(this.result.filter.text || "")
					.onChange((val) => {
						this.result.filter.text = val;
					});
			});

		new Setting(contentGui)
			.setName("标签包含 (Tags contains)")
			.addText((text) => {
				text.setValue(this.result.filter.tag || "")
					.onChange((val) => {
						this.result.filter.tag = val;
					});
			});


		// ------------------ Advanced Tab Content ------------------
		contentAdvanced.createEl("div", {
			text: "直接编辑过滤任务的 DQL 查询语句。支持 status, priority, due, scheduled, start, path, tags 等字段。",
			attr: { style: "font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;" }
		});

		const textarea = contentAdvanced.createEl("textarea", {
			cls: "tasktodo-advanced-textarea",
			value: this.result.query || ""
		});
		textarea.placeholder = 'e.g. status = "TODO" AND due <= date(today)';
		textarea.addEventListener("input", () => {
			this.result.query = textarea.value;
		});


		// Set initial active tab
		setActiveTab(this.result.queryMode || "gui");

		// Save/Cancel Action Buttons
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
						// If in GUI mode, compile filter config to DQL query
						if (this.result.queryMode === "gui") {
							this.result.query = filterConfigToDQL(this.result.filter);
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
