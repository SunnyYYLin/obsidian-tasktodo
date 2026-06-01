import { ItemView, Menu, Modal, Notice, setIcon, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import { TASK_SYMBOLS, serializeTaskLine, type TaskTodoHost, type TaskTodoTaskLine, type TaskTodoTaskRecord, type EditTaskPatch, type CreateTaskInput } from "../taskLiteInterop";
import { compareTaskTodoItems } from "./taskTodoSort";
import type TaskTodoPlugin from "../main";
import type { FilterConfig, ColumnConfig } from "../main";
import { matchFilter, type TaskListItem } from "./taskTodoFilter";
import { openTaskLineModal as openLocalTaskLineModal, openTaskLineModalWithTarget, type TaskLineModalResult, type TaskLiteSettings } from "./taskLineModal";
import { fieldsFromTaskLine, type StatusRegistry } from "./taskLineFields";

export const TASKTODO_VIEW = "tasktodo-task-list";

interface TaskGroup {
	id: string;
	title: string;
	items: TaskListItem[];
	collapsed: boolean;
}

interface TaskListTab {
	id: string;
	title: string;
}

export class TaskTodoTaskListView extends ItemView {
	private readonly collapsedGroups = new Set<string>(["overdue"]);
	private readonly expandedTasks = new Set<string>();
	private activeTab = "";
	private renderVersion = 0;
	private renderTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly appRef: App,
		private readonly host: TaskTodoHost,
		private readonly plugin: TaskTodoPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TASKTODO_VIEW;
	}

	getDisplayText(): string {
		return "TaskTodo"; // eslint-disable-line obsidianmd/ui/sentence-case
	}

	getIcon(): string {
		return "list-todo";
	}

	async onOpen(): Promise<void> {
		this.containerEl.addClass("taskslite-list-view");
		this.registerEvent(this.appRef.vault.on("modify", () => this.queueRender()));
		this.registerEvent(this.appRef.vault.on("create", () => this.queueRender()));
		this.registerEvent(this.appRef.vault.on("delete", () => this.queueRender()));
		this.registerEvent(this.appRef.vault.on("rename", () => this.queueRender()));
		await this.render();
	}

	async onClose(): Promise<void> {
		if (this.renderTimer !== null) {
			window.clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
	}

	queueRender(): void {
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			void this.render();
		}, 150);
	}

	private async render(): Promise<void> {
		const version = ++this.renderVersion;
		const tasks = await this.loadTasks();
		if (version !== this.renderVersion) return;

		const content = this.contentEl;
		content.empty();
		content.addClass("taskslite-list-root");
		const layout = content.createDiv({cls: "taskslite-list-layout"});

		if (this.activeTab === "" || !this.plugin.settings.tabs.some(t => t.id === this.activeTab)) {
			this.activeTab = this.plugin.settings.tabs[0]?.id || "";
		}

		const tabs = this.plugin.settings.tabs.map(t => ({ id: t.id, title: t.title }));
		const activeTabConfig = this.plugin.settings.tabs.find(t => t.id === this.activeTab) || this.plugin.settings.tabs[0];
		
		const visibleTasks = activeTabConfig ? tasks.filter(task => matchFilter(task, activeTabConfig.filter)) : [];
		this.renderHeader(layout, visibleTasks.length);
		this.renderTabs(layout, tabs, visibleTasks);

		if (activeTabConfig) {
			const columns = activeTabConfig.columns || [];
			for (const group of groupTasksCustom(visibleTasks, columns, this.collapsedGroups)) {
				this.renderGroup(layout, group, activeTabConfig.filter);
			}
		}
	}

	private renderHeader(container: HTMLElement, count: number): void {
		const header = container.createDiv({cls: "taskslite-list-header"});
		const titleGroup = header.createDiv({cls: "taskslite-list-title-group"});
		const title = titleGroup.createDiv({cls: "taskslite-list-title"});
		const icon = title.createSpan({cls: "taskslite-list-title-icon"});
		setIcon(icon, "list-todo");
		title.createSpan({text: "TaskTodo"});
		titleGroup.createSpan({text: `${count}`, cls: "taskslite-list-count"});

		const actions = header.createDiv({cls: "taskslite-list-header-actions"});

		const refreshButton = actions.createEl("button", {cls: "taskslite-refresh-tasks", attr: {"aria-label": t("taskTodo.refresh")}});
		const refreshIcon = refreshButton.createSpan();
		setIcon(refreshIcon, "refresh-cw");
		refreshButton.createSpan({text: t("taskTodo.refresh")});
		refreshButton.addEventListener("click", () => {
			void this.render();
		});

		const addButton = actions.createEl("button", {cls: "taskslite-add-task", attr: {"aria-label": t("taskTodo.addTask")}});
		const addIcon = addButton.createSpan();
		setIcon(addIcon, "plus");
		addButton.createSpan({text: t("taskTodo.addTask")});
		addButton.addEventListener("click", () => {
			void this.createInboxTask();
		});
	}

	private renderTabs(container: HTMLElement, tabs: TaskListTab[], tasks: TaskListItem[]): void {
		const tabBar = container.createDiv({cls: "taskslite-list-tabs"});
		for (const tab of tabs) {
			const isActive = tab.id === this.activeTab;
			const button = tabBar.createEl("button", {
				cls: `taskslite-list-tab${isActive ? " is-active" : ""}`,
				text: tab.title,
				attr: {type: "button", "aria-pressed": String(isActive)},
			});
			button.addEventListener("click", () => {
				if (this.activeTab === tab.id) return;
				this.activeTab = tab.id;
				void this.render();
			});
		}

		if (tasks.length > 0) return;
		const emptyState = container.createDiv({cls: "taskslite-list-empty"});
		emptyState.setText(
			this.activeTab === "in-plan"
				? t("taskTodo.empty.inPlan")
				: this.activeTab === "today"
				? t("taskTodo.empty.today")
				: (t("common.none") || "No tasks.")
		);
	}

	private renderGroup(container: HTMLElement, group: TaskGroup, filter: FilterConfig): void {
		const section = container.createEl("section", {cls: "taskslite-list-section"});
		const header = section.createDiv({cls: "taskslite-section-header"});
		const chevron = header.createSpan({cls: "taskslite-section-chevron"});
		setIcon(chevron, group.collapsed ? "chevron-right" : "chevron-down");
		header.createSpan({text: group.title, cls: "taskslite-section-title"});
		header.createSpan({text: `${group.items.length}`, cls: "taskslite-section-count"});

		header.addEventListener("click", () => {
			if (this.collapsedGroups.has(group.id)) this.collapsedGroups.delete(group.id);
			else this.collapsedGroups.add(group.id);
			void this.render();
		});

		if (group.collapsed) return;
		const list = section.createDiv({cls: "taskslite-task-list"});
		for (const item of group.items) {
			this.renderTaskItem(list, item, filter);
		}
	}

	private renderTaskItem(container: HTMLElement, item: TaskListItem, filter: FilterConfig): void {
		const wrapper = container.createDiv({cls: "taskslite-list-item-wrapper"});
		const row = wrapper.createDiv({cls: "taskslite-list-item"});
		row.dataset.taskStatusType = item.task.status;
		row.dataset.taskStatusSymbol = this.host.statusRegistry.getByType(item.task.status).symbol;
		const checkbox = row.createEl("button", {cls: "taskslite-list-checkbox", attr: {"aria-label": t("task.action.complete")}});
		const checkboxIcon = checkbox.createSpan({cls: "taskslite-list-checkbox-icon"});
		applyTaskStatusIcon(checkboxIcon, item.task.status);
		checkbox.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			checkbox.setAttr("disabled", "true");
			void (async () => {
				const currentStatus = this.host.statusRegistry.getByType(item.task.status);
				const nextSymbol = currentStatus.nextStatusSymbol || (item.task.status === "DONE" ? " " : "x");
				await this.host.api.updateTaskStatus(item.path, item.lineNumber, nextSymbol);
				await this.render();
			})();
		});

		const body = row.createDiv({cls: "taskslite-list-item-body"});
		this.renderItemTitle(body, item);
		this.renderItemMeta(body, item);

		row.addEventListener("click", async () => {
			const file = this.appRef.vault.getAbstractFileByPath(item.path);
			if (file instanceof TFile) {
				const leaf = this.appRef.workspace.getLeaf(false);
				await leaf.openFile(file, {
					eState: { line: item.lineNumber }
				});
			}
		});

		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();
			
			const menu = new Menu();

			// 1. 添加子任务 (Add subtask)
			menu.addItem((menuItem) => {
				menuItem
					.setTitle(t("task.action.addSubtask"))
					.setIcon("list-plus")
					.onClick(() => {
						void this.createSubtask(item);
					});
			});

			// 2. 编辑 (Edit)
			menu.addItem((menuItem) => {
				menuItem
					.setTitle(t("task.action.edit"))
					.setIcon("pencil")
					.onClick(() => {
						void this.editTask(item);
					});
			});

			// 3. 进行中 (In progress)
			const isInProgress = item.task.status === "IN_PROGRESS";
			menu.addItem((menuItem) => {
				const statusSettings = this.host.settings.statusSettings as {
					coreStatuses?: Array<{ symbol: string; type: string }>;
					customStatuses?: Array<{ symbol: string; type: string }>;
				} | undefined;
				const allStatuses = [
					...(statusSettings?.coreStatuses || []),
					...(statusSettings?.customStatuses || [])
				];
				const inProgressStatus = allStatuses.find(s => s.type === "IN_PROGRESS") || { symbol: "/", name: "In progress" };
				menuItem
					.setTitle(t("task.action.inProgress"))
					.setIcon("minus")
					.setChecked(isInProgress)
					.onClick(async () => {
						const newSymbol = isInProgress ? " " : inProgressStatus.symbol;
						await this.host.api.updateTaskStatus(item.path, item.lineNumber, newSymbol);
						await this.render();
					});
			});

			// 4. 取消 (Cancel)
			const isCancelled = item.task.status === "CANCELLED";
			menu.addItem((menuItem) => {
				menuItem
					.setTitle(isCancelled ? t("task.action.uncancel") : t("task.action.cancel"))
					.setIcon(isCancelled ? "rotate-ccw" : "circle-slash")
					.onClick(async () => {
						const targetSymbol = isCancelled ? " " : "-";
						await this.host.api.updateTaskStatus(item.path, item.lineNumber, targetSymbol);
						await this.render();
					});
			});

			// 5. 删除 (Delete)
			menu.addItem((menuItem) => {
				menuItem
					.setTitle(t("task.action.delete"))
					.setIcon("trash")
					.onClick(() => {
						new ConfirmModal(
							this.appRef,
							t("task.action.deleteConfirmTitle"),
							t("task.action.deleteConfirmMessage").replace("{description}", item.task.description),
							async () => {
								await this.host.api.deleteTask(item.path, item.lineNumber);
								await this.render();
							}
						).open();
					});
			});

			menu.showAtMouseEvent(event);
		});

		if (item.hasChildren && this.expandedTasks.has(taskKey(item))) {
			this.renderChildList(wrapper, item, filter);
		}
	}

	private renderItemTitle(container: HTMLElement, item: TaskListItem): void {
		const titleRow = container.createDiv({cls: "taskslite-list-item-title-row"});
		if (item.hasChildren) {
			const expanded = this.expandedTasks.has(taskKey(item));
			const expandButton = titleRow.createEl("button", {
				cls: "taskslite-task-expand",
				attr: {"aria-label": expanded ? t("task.action.collapseSubtasks") : t("task.action.expandSubtasks"), "aria-expanded": String(expanded)},
			});
			setIcon(expandButton, expanded ? "chevron-down" : "chevron-right");
			expandButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.toggleTaskExpanded(item);
			});
		}
		titleRow.createDiv({text: item.task.description, cls: "taskslite-list-item-title"});
	}

	private renderItemMeta(container: HTMLElement, item: TaskListItem): void {
		const meta = container.createDiv({cls: "taskslite-list-item-meta"});
		const context = meta.createDiv({cls: "taskslite-list-item-context"});
		context.createSpan({text: item.basename});
		if (item.parent) context.createSpan({text: item.parent.task.description, cls: "taskslite-list-parent"});
		if (item.task.priority) context.createSpan({text: item.task.priority, cls: "taskslite-list-priority"});

		const dates = meta.createDiv({cls: "taskslite-list-item-dates"});
		for (const datePart of taskDateParts(item.task)) {
			const date = dates.createSpan({text: datePart, cls: "taskslite-list-date"});
			if (datePart.startsWith(TASK_SYMBOLS.due)) date.addClass("taskslite-list-date-due");
			if (datePart.startsWith(TASK_SYMBOLS.scheduled)) date.addClass("taskslite-list-date-scheduled");
		}

		const extra = otherMetadataParts(item.task);
		if (extra.length > 0) {
			const details = meta.createDiv({cls: "taskslite-list-item-details"});
			for (const part of extra) {
				details.createSpan({text: part, cls: "taskslite-list-metadata"});
			}
		}
	}

	private renderChildList(container: HTMLElement, item: TaskListItem, filter: FilterConfig): void {
		let children = item.children.filter((child) => isVisibleTask(child));
		if (filter.completed === "uncompleted") {
			children = children.filter((child) => child.task.status !== "DONE");
		} else if (filter.completed === "completed") {
			children = children.filter((child) => child.task.status === "DONE");
		}
		if (children.length === 0) return;

		const list = container.createDiv({cls: "taskslite-child-list"});
		for (const child of children) {
			this.renderTaskItem(list, child, filter);
		}
	}

	private async editTask(item: TaskListItem): Promise<void> {
		const currentLine = serializeTaskLine(item.task, this.host.statusRegistry);
		const updatedLine = await openTaskLineModal(this.host, this.appRef, currentLine, t("command.editTask"));
		if (!updatedLine || updatedLine === currentLine) return;

		const fields = fieldsFromTaskLine(updatedLine, this.host.statusRegistry as unknown as StatusRegistry);
		const patch: EditTaskPatch = {
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
		};

		await this.host.api.editTask(item.path, item.lineNumber, patch);

		const currentSymbol = this.host.statusRegistry.getByType(item.task.status).symbol;
		if (fields.statusSymbol !== currentSymbol) {
			await this.host.api.updateTaskStatus(item.path, item.lineNumber, fields.statusSymbol);
		}

		await this.render();
	}

	private toggleTaskExpanded(item: TaskListItem): void {
		const key = taskKey(item);
		if (this.expandedTasks.has(key)) this.expandedTasks.delete(key);
		else this.expandedTasks.add(key);
		void this.render();
	}

	private async loadTasks(): Promise<TaskListItem[]> {
		const records = await this.host.api.listTasks({
			includeChildren: true,
			includeCompleted: true,
			includeCancelled: true,
		});
		const items = taskRecordsToListItems(records).filter(isVisibleTask);
		const sortKeys = this.plugin.settings.sortOrder;
		return items.sort((a, b) => compareTaskTodoItems(a, b, sortKeys));
	}

	private async createInboxTask(): Promise<void> {
		const result = await openTaskLineModalWithTargetHelper(this.host, this.appRef, "", t("taskTodo.createTask"), {
			basePath: "",
			defaultValue: "Tasks",
		});
		if (!result || !result.line) return;
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
			path: result.targetPath || "Tasks.md",
		};
		try {
			await this.host.api.createTask(input);
		} catch (error) {
			new Notice(t("notice.inboxPathFolder"));
			console.warn("TaskTodo failed to create inbox task", error);
		}
		await this.render();
	}

	private async createSubtask(parent: TaskListItem): Promise<void> {
		const line = await openTaskLineModal(this.host, this.appRef, "", t("taskTodo.createTask"));
		if (!line) return;
		const fields = fieldsFromTaskLine(line, this.host.statusRegistry as unknown as StatusRegistry);
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
			path: parent.path,
			parentLineNumber: parent.lineNumber,
		};
		try {
			await this.host.api.createTask(input);
		} catch (error) {
			new Notice(t("notice.inboxPathFolder"));
			console.warn("TaskTodo failed to create subtask", error);
		}
		await this.render();
	}
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private titleText: string,
		private messageText: string,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("taskslite-confirm-modal");

		contentEl.createEl("h2", { text: this.titleText });
		contentEl.createEl("p", { text: this.messageText });

		const buttonContainer = contentEl.createDiv({ cls: "taskslite-modal-buttons" });
		
		const cancelButton = buttonContainer.createEl("button", { text: t("common.cancel") || "Cancel" });
		cancelButton.addEventListener("click", () => this.close());

		const confirmButton = buttonContainer.createEl("button", {
			text: t("common.confirm") || "Confirm",
			cls: "mod-warning"
		});
		confirmButton.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}



function groupTasksCustom(
	tasks: TaskListItem[],
	columns: ColumnConfig[],
	collapsedGroups: Set<string>
): TaskGroup[] {
	const buckets: TaskGroup[] = columns.map(col => ({
		id: col.id,
		title: col.title,
		items: [],
		collapsed: collapsedGroups.has(col.id)
	}));

	for (const task of tasks) {
		for (let idx = 0; idx < columns.length; idx++) {
			const col = columns[idx];
			if (col && matchFilter(task, col.filter)) {
				const bucket = buckets[idx];
				if (bucket) {
					bucket.items.push(task);
				}
				break;
			}
		}
	}

	return buckets.filter(group => group.items.length > 0);
}

function taskRecordsToListItems(records: TaskTodoTaskRecord[]): TaskListItem[] {
	const items: TaskListItem[] = records.map((record): TaskListItem => {
		const {date, dateType} = taskListDate(record.task);
		return {
			path: record.path,
			basename: record.basename,
			lineNumber: record.lineNumber,
			parentLine: record.parentLine,
			depth: record.depth,
			hasChildren: record.hasChildren,
			task: record.task,
			date,
			dateType,
			parent: null,
			children: [],
		};
	});

	const byKey = new Map(items.map((item) => [taskKey(item), item]));
	for (const item of items) {
		if (item.parentLine === null) continue;
		const parent = byKey.get(`${item.path}:${item.parentLine}`);
		if (!parent) continue;
		item.parent = parent;
		parent.children.push(item);
	}
	return items;
}

function isVisibleTask(_item: TaskListItem): boolean {
	return true;
}

function taskListDate(task: TaskTodoTaskLine): Pick<TaskListItem, "date" | "dateType"> {
	if (task.dates.due) return {date: task.dates.due, dateType: "due"};
	if (task.dates.scheduled) return {date: task.dates.scheduled, dateType: "scheduled"};
	if (task.dates.start) return {date: task.dates.start, dateType: "start"};
	return {date: null, dateType: null};
}

function taskDateParts(task: TaskTodoTaskLine): string[] {
	const parts: string[] = [];
	if (task.dates.scheduled) parts.push(`${TASK_SYMBOLS.scheduled} ${task.dates.scheduled}`);
	if (task.dates.due) parts.push(`${TASK_SYMBOLS.due} ${task.dates.due}`);
	if (task.dates.start) parts.push(`${TASK_SYMBOLS.start} ${task.dates.start}`);
	if (task.dates.done) parts.push(`${TASK_SYMBOLS.done} ${task.dates.done}`);
	return parts;
}

function otherMetadataParts(task: TaskTodoTaskLine): string[] {
	const parts: string[] = [];
	if (task.recurrence) parts.push(`${TASK_SYMBOLS.recurrence} ${task.recurrence}`);
	if (task.id) parts.push(`${TASK_SYMBOLS.id} ${task.id}`);
	if (task.onCompletion) parts.push(`${TASK_SYMBOLS.onCompletion} ${task.onCompletion}`);
	if (task.dependsOn) parts.push(`${TASK_SYMBOLS.dependsOn} ${task.dependsOn}`);
	if (task.blockLink) parts.push(task.blockLink);
	return parts;
}

function taskKey(item: Pick<TaskListItem, "path" | "lineNumber">): string {
	return `${item.path}:${item.lineNumber}`;
}



function applyTaskStatusIcon(container: HTMLElement, statusType: string): void {
	container.empty();
	if (statusType === "DONE") {
		setIcon(container, "check");
		return;
	}
	if (statusType === "CANCELLED") {
		setIcon(container, "slash");
		return;
	}
	if (statusType === "IN_PROGRESS") {
		setIcon(container, "minus");
		return;
	}
}

function openTaskLineModal(host: TaskTodoHost, app: App, initialLine: string, title: string): Promise<string> {
	return openLocalTaskLineModal({
		app,
		title,
		initialLine,
		registry: host.statusRegistry as unknown as StatusRegistry,
		settings: host.settings as unknown as TaskLiteSettings,
	});
}

function openTaskLineModalWithTargetHelper(
	host: TaskTodoHost,
	app: App,
	initialLine: string,
	title: string,
	targetFile: { basePath: string; defaultValue: string }
): Promise<TaskLineModalResult | null> {
	return openTaskLineModalWithTarget({
		app,
		title,
		initialLine,
		registry: host.statusRegistry as unknown as StatusRegistry,
		settings: host.settings as unknown as TaskLiteSettings,
		targetFile,
	});
}
