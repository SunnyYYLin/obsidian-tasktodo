import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { t, type I18nKey } from "./i18n";
import { getTaskLiteHost, type TaskTodoHost } from "./host";
import { TASKTODO_VIEW, TaskTodoTaskListView } from "./taskTodo/taskListView";
import { openTaskLineModal, type TaskLiteSettings } from "./taskTodo/taskLineModal";
import { type StatusRegistry } from "./taskTodo/taskLineFields";
import { type SortKey } from "./taskTodo/taskTodoSort";

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
			registry: this.host.statusRegistry as unknown as StatusRegistry,
			settings: this.host.settings as unknown as TaskLiteSettings,
		});
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
