import {
  ItemView,
  MarkdownRenderer,
  Menu,
  Modal,
  Notice,
  setIcon,
  TFile,
  type App,
  type WorkspaceLeaf,
} from "obsidian";
import { t } from "../i18n";
import {
  TASK_SYMBOLS,
  type TaskTodoHost,
  type TaskTodoTaskLine,
  type TaskTodoTaskRecord,
  type CreateTaskInput,
  type EditTaskPatch,
} from "../taskLiteInterop";
import { compareTaskTodoItems } from "./taskTodoSort";
import type TaskTodoPlugin from "../main";
import type { ColumnConfig } from "../main";
import { DEFAULT_PRIORITY_COLORS } from "../main";
import { matchFilterWithDQL, type TaskListItem } from "./taskTodoFilter";
import { TaskFormModal } from "./taskFormModal";

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
    this.registerEvent(
      this.appRef.vault.on("modify", () => this.queueRender()),
    );
    this.registerEvent(
      this.appRef.vault.on("create", () => this.queueRender()),
    );
    this.registerEvent(
      this.appRef.vault.on("delete", () => this.queueRender()),
    );
    this.registerEvent(
      this.appRef.vault.on("rename", () => this.queueRender()),
    );
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
    const layout = content.createDiv({ cls: "taskslite-list-layout" });

    if (
      this.activeTab === "" ||
      !this.plugin.settings.tabs.some((t) => t.id === this.activeTab)
    ) {
      this.activeTab = this.plugin.settings.tabs[0]?.id || "";
    }

    const tabs = this.plugin.settings.tabs.map((t) => ({
      id: t.id,
      title: t.title,
    }));
    const activeTabConfig =
      this.plugin.settings.tabs.find((t) => t.id === this.activeTab) ||
      this.plugin.settings.tabs[0];

    const visibleTasks = activeTabConfig
      ? tasks.filter((task) =>
          matchFilterWithDQL(task, undefined, activeTabConfig.query, this.host),
        )
      : [];
    this.renderHeader(layout, visibleTasks.length);
    this.renderTabs(layout, tabs, visibleTasks);

    if (activeTabConfig) {
      let showCompleted = true;
      if (activeTabConfig.query) {
        const q = activeTabConfig.query.toUpperCase();
        if (
          q.includes('STATUS != "DONE"') ||
          q.includes('STATUS = "TODO"') ||
          q.includes('STATUS = "IN_PROGRESS"')
        ) {
          showCompleted = false;
        }
      }

      const columns = activeTabConfig.columns || [];
      for (const group of groupTasksCustom(
        visibleTasks,
        columns,
        this.collapsedGroups,
        this.host,
      )) {
        await this.renderGroup(layout, group, showCompleted);
      }
    }
  }

  private renderHeader(container: HTMLElement, count: number): void {
    const header = container.createDiv({ cls: "taskslite-list-header" });
    const titleGroup = header.createDiv({ cls: "taskslite-list-title-group" });
    const title = titleGroup.createDiv({ cls: "taskslite-list-title" });
    const icon = title.createSpan({ cls: "taskslite-list-title-icon" });
    setIcon(icon, "list-todo");
    title.createSpan({ text: "TaskTodo" });
    titleGroup.createSpan({ text: `${count}`, cls: "taskslite-list-count" });

    const actions = header.createDiv({ cls: "taskslite-list-header-actions" });

    const addButton = actions.createEl("button", {
      cls: "taskslite-add-task",
      attr: { "aria-label": t("taskTodo.addTask") },
    });
    const addIcon = addButton.createSpan();
    setIcon(addIcon, "plus");
    addButton.createSpan({ text: t("taskTodo.addTask") });
    addButton.addEventListener("click", () => {
      this.createInboxTask();
    });

    const refreshButton = actions.createEl("button", {
      cls: "taskslite-refresh-tasks",
      attr: { "aria-label": t("taskTodo.refresh") },
    });
    const refreshIcon = refreshButton.createSpan();
    setIcon(refreshIcon, "refresh-cw");
    refreshButton.createSpan({ text: t("taskTodo.refresh") });
    refreshButton.addEventListener("click", () => {
      void this.render();
    });
  }

  private renderTabs(
    container: HTMLElement,
    tabs: TaskListTab[],
    tasks: TaskListItem[],
  ): void {
    const tabBar = container.createDiv({ cls: "taskslite-list-tabs" });
    for (const tab of tabs) {
      const isActive = tab.id === this.activeTab;
      const button = tabBar.createEl("button", {
        cls: `taskslite-list-tab${isActive ? " is-active" : ""}`,
        text: tab.title,
        attr: { type: "button", "aria-pressed": String(isActive) },
      });
      button.addEventListener("click", () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        void this.render();
      });
    }

    if (tasks.length > 0) return;
    const emptyState = container.createDiv({ cls: "taskslite-list-empty" });
    emptyState.setText(
      this.activeTab === "in-plan"
        ? t("taskTodo.empty.inPlan")
        : this.activeTab === "today"
          ? t("taskTodo.empty.today")
          : t("common.none") || "No tasks.",
    );
  }

  private async renderGroup(
    container: HTMLElement,
    group: TaskGroup,
    showCompleted: boolean,
  ): Promise<void> {
    const section = container.createEl("section", {
      cls: "taskslite-list-section",
    });
    const header = section.createDiv({ cls: "taskslite-section-header" });
    const chevron = header.createSpan({ cls: "taskslite-section-chevron" });
    setIcon(chevron, group.collapsed ? "chevron-right" : "chevron-down");
    header.createSpan({ text: group.title, cls: "taskslite-section-title" });
    header.createSpan({
      text: `${group.items.length}`,
      cls: "taskslite-section-count",
    });

    header.addEventListener("click", () => {
      if (this.collapsedGroups.has(group.id))
        this.collapsedGroups.delete(group.id);
      else this.collapsedGroups.add(group.id);
      void this.render();
    });

    if (group.collapsed) return;
    const list = section.createDiv({ cls: "taskslite-task-list" });
    for (const item of group.items) {
      await this.renderTaskItem(list, item, showCompleted);
    }
  }

  private async renderTaskItem(
    container: HTMLElement,
    item: TaskListItem,
    showCompleted: boolean,
  ): Promise<void> {
    const wrapper = container.createDiv({ cls: "taskslite-list-item-wrapper" });
    const row = wrapper.createDiv({ cls: "taskslite-list-item" });
    row.dataset.taskStatusType = item.task.status;
    row.dataset.taskStatusSymbol = this.host.statusRegistry.getByType(
      item.task.status,
    ).symbol;
    // 优先级左侧指示条
    const priorityColor = getPriorityColor(item.task.priority, this.plugin);
    row.style.borderLeft = `3px solid ${priorityColor}`;
    const checkbox = row.createEl("button", {
      cls: "taskslite-list-checkbox",
      attr: { "aria-label": t("task.action.complete") },
    });
    const checkboxIcon = checkbox.createSpan({
      cls: "taskslite-list-checkbox-icon",
    });
    applyTaskStatusIcon(checkboxIcon, item.task.status);
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      checkbox.setAttr("disabled", "true");
      void (async () => {
        const currentStatus = this.host.statusRegistry.getByType(
          item.task.status,
        );
        const nextSymbol =
          currentStatus.nextStatusSymbol ||
          (item.task.status === "DONE" ? " " : "x");
        await this.host.api.updateTaskStatus(
          item.path,
          item.lineNumber,
          nextSymbol,
        );
        await this.render();
      })();
    });

    const body = row.createDiv({ cls: "taskslite-list-item-body" });
    await this.renderItemTitle(body, item);
    this.renderItemDates(body, item);
    this.renderItemDetails(body, item);

    row.addEventListener("click", () => {
      const file = this.appRef.vault.getAbstractFileByPath(item.path);
      if (file instanceof TFile) {
        const leaf = this.appRef.workspace.getLeaf(false);
        void leaf.openFile(file, {
          eState: { line: item.lineNumber },
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
            this.createSubtask(item);
          });
      });

      // 2. 编辑 (Edit)
      menu.addItem((menuItem) => {
        menuItem
          .setTitle(t("task.action.edit"))
          .setIcon("pencil")
          .onClick(() => {
            this.editTask(item);
          });
      });

      // 3. 进行中 (In progress)
      const isInProgress = item.task.status === "IN_PROGRESS";
      menu.addItem((menuItem) => {
        const statusSettings = this.host.settings.statusSettings as
          | {
              coreStatuses?: Array<{ symbol: string; type: string }>;
              customStatuses?: Array<{ symbol: string; type: string }>;
            }
          | undefined;
        const allStatuses = [
          ...(statusSettings?.coreStatuses || []),
          ...(statusSettings?.customStatuses || []),
        ];
        const inProgressStatus = allStatuses.find(
          (s) => s.type === "IN_PROGRESS",
        ) || { symbol: "/", name: "In progress" };
        menuItem
          .setTitle(t("task.action.inProgress"))
          .setIcon("minus")
          .setChecked(isInProgress)
          .onClick(async () => {
            const newSymbol = isInProgress ? " " : inProgressStatus.symbol;
            await this.host.api.updateTaskStatus(
              item.path,
              item.lineNumber,
              newSymbol,
            );
            await this.render();
          });
      });

      // 4. 取消 (Cancel)
      const isCancelled = item.task.status === "CANCELLED";
      menu.addItem((menuItem) => {
        menuItem
          .setTitle(
            isCancelled ? t("task.action.uncancel") : t("task.action.cancel"),
          )
          .setIcon(isCancelled ? "rotate-ccw" : "circle-slash")
          .onClick(async () => {
            const targetSymbol = isCancelled ? " " : "-";
            await this.host.api.updateTaskStatus(
              item.path,
              item.lineNumber,
              targetSymbol,
            );
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
              t("task.action.deleteConfirmMessage").replace(
                "{description}",
                item.task.description,
              ),
              () => {
                void (async () => {
                  await this.host.api.deleteTask(item.path, item.lineNumber);
                  await this.render();
                })();
              },
            ).open();
          });
      });

      menu.showAtMouseEvent(event);
    });

    if (item.hasChildren && this.expandedTasks.has(taskKey(item))) {
      await this.renderChildList(wrapper, item, showCompleted);
    }
  }

  private async renderItemTitle(
    container: HTMLElement,
    item: TaskListItem,
  ): Promise<void> {
    const titleRow = container.createDiv({
      cls: "taskslite-list-item-title-row",
    });
    if (item.hasChildren) {
      const expanded = this.expandedTasks.has(taskKey(item));
      const expandButton = titleRow.createEl("button", {
        cls: "taskslite-task-expand",
        attr: {
          "aria-label": expanded
            ? t("task.action.collapseSubtasks")
            : t("task.action.expandSubtasks"),
          "aria-expanded": String(expanded),
        },
      });
      setIcon(expandButton, expanded ? "chevron-down" : "chevron-right");
      expandButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleTaskExpanded(item);
      });
    }
    const titleDiv = titleRow.createDiv({ cls: "taskslite-list-item-title" });
    await MarkdownRenderer.render(
      this.appRef,
      item.task.description,
      titleDiv,
      item.path,
      this,
    );
  }

  private renderItemDates(container: HTMLElement, item: TaskListItem): void {
    const datesData: Array<{
      dateStr: string;
      dateType:
        | "due"
        | "scheduled"
        | "start"
        | "done"
        | "created"
        | "cancelled";
    }> = [];
    if (item.task.dates.start)
      datesData.push({ dateStr: item.task.dates.start, dateType: "start" });
    if (item.task.dates.scheduled)
      datesData.push({
        dateStr: item.task.dates.scheduled,
        dateType: "scheduled",
      });
    if (item.task.dates.due)
      datesData.push({ dateStr: item.task.dates.due, dateType: "due" });
    if (item.task.dates.cancelled)
      datesData.push({ dateStr: item.task.dates.cancelled, dateType: "cancelled" });
    if (item.task.dates.done)
      datesData.push({ dateStr: item.task.dates.done, dateType: "done" });
    if (datesData.length === 0) return;

    const dates = container.createDiv({ cls: "taskslite-list-item-dates" });
    for (const { dateStr, dateType } of datesData) {
      const { text, cssClass } = formatSmartDate(dateStr, dateType);
      dates.createSpan({ text, cls: `taskslite-date-badge ${cssClass}` });
    }
  }

  private renderItemDetails(container: HTMLElement, item: TaskListItem): void {
    const details = container.createDiv({ cls: "taskslite-list-item-details" });

    // File path (show relative path, truncate if too long)
    const pathText =
      item.path.length > 40 ? "\u2026" + item.path.slice(-37) : item.path;
    const pathEl = details.createSpan({
      text: `\ud83d\udcc1 ${pathText}`,
      cls: "taskslite-list-file-path",
    });
    pathEl.setAttribute("title", item.path); // full path on hover

    // Parent task
    if (item.parent) {
      details.createSpan({
        text: `\u21b3 ${item.parent.task.description}`,
        cls: "taskslite-list-parent",
      });
    }

    // Assignee
    if (item.task.assignee && item.task.assignee.length > 0) {
      details.createSpan({
        text: `\ud83d\udc64 ${item.task.assignee.join(" & ")}`,
        cls: "taskslite-list-assignee",
      });
    }

    // Other metadata
    if (item.task.recurrence) {
      details.createSpan({
        text: `${TASK_SYMBOLS.recurrence} ${item.task.recurrence}`,
        cls: "taskslite-list-metadata",
      });
    }
    if (item.task.dependsOn) {
      details.createSpan({
        text: `${TASK_SYMBOLS.dependsOn} ${item.task.dependsOn}`,
        cls: "taskslite-list-metadata",
      });
    }
    if (item.task.onCompletion) {
      details.createSpan({
        text: `${TASK_SYMBOLS.onCompletion} ${item.task.onCompletion}`,
        cls: "taskslite-list-metadata",
      });
    }
    if (item.task.id) {
      details.createSpan({
        text: `${TASK_SYMBOLS.id} ${item.task.id}`,
        cls: "taskslite-list-metadata",
      });
    }
    if (item.task.blockLink) {
      details.createSpan({
        text: item.task.blockLink,
        cls: "taskslite-list-metadata",
      });
    }
  }

  private async renderChildList(
    container: HTMLElement,
    item: TaskListItem,
    showCompleted: boolean,
  ): Promise<void> {
    let children = item.children.filter((child) => isVisibleTask(child));
    if (!showCompleted) {
      children = children.filter((child) => child.task.status !== "DONE");
    }
    if (children.length === 0) return;

    const list = container.createDiv({ cls: "taskslite-child-list" });
    for (const child of children) {
      await this.renderTaskItem(list, child, showCompleted);
    }
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

  private createInboxTask(): void {
    new TaskFormModal(
      this.appRef,
      this.host,
      t("taskTodo.createTask"),
      "create",
      (data, targetPath) => {
        void (async () => {
          const input: CreateTaskInput = {
            description: data.description,
            status: data.statusSymbol,
            priority: data.priority || null,
            dates: {
              start: data.startDate || null,
              scheduled: data.scheduledDate || null,
              due: data.dueDate || null,
            },
            recurrence: data.recurrence || null,
            onCompletion: data.onCompletion || null,
            id: data.id || null,
            dependsOn: data.dependsOn || null,
            assignee: data.assignee,
            path: targetPath || "Tasks.md",
          };
          try {
            await this.host.api.createTask(input);
          } catch (error) {
            new Notice(t("notice.inboxPathFolder"));
            console.warn("TaskTodo failed to create inbox task", error);
          }
          await this.render();
        })();
      },
      { path: "Tasks.md" },
    ).open();
  }

  private createSubtask(parent: TaskListItem): void {
    new TaskFormModal(
      this.appRef,
      this.host,
      t("taskTodo.createTask"),
      "create",
      (data) => {
        void (async () => {
          const input: CreateTaskInput = {
            description: data.description,
            status: data.statusSymbol,
            priority: data.priority || null,
            dates: {
              start: data.startDate || null,
              scheduled: data.scheduledDate || null,
              due: data.dueDate || null,
            },
            recurrence: data.recurrence || null,
            onCompletion: data.onCompletion || null,
            id: data.id || null,
            dependsOn: data.dependsOn || null,
            assignee: data.assignee,
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
        })();
      },
      { path: parent.path, parentLineNumber: parent.lineNumber },
    ).open();
  }

  private editTask(item: TaskListItem): void {
    new TaskFormModal(
      this.appRef,
      this.host,
      t("command.editTask"),
      "edit",
      (data) => {
        void (async () => {
          const patch: EditTaskPatch = {
            description: data.description,
            priority: data.priority || null,
            dates: {
              start: data.startDate || null,
              scheduled: data.scheduledDate || null,
              due: data.dueDate || null,
            },
            recurrence: data.recurrence || null,
            onCompletion: data.onCompletion || null,
            id: data.id || null,
            dependsOn: data.dependsOn || null,
            assignee: data.assignee,
          };
          await this.host.api.editTask(item.path, item.lineNumber, patch);

          const currentSymbol = this.host.statusRegistry.getByType(
            item.task.status,
          ).symbol;
          if (data.statusSymbol !== currentSymbol) {
            await this.host.api.updateTaskStatus(
              item.path,
              item.lineNumber,
              data.statusSymbol,
            );
          }
          await this.render();
        })();
      },
      { task: item.task },
    ).open();
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

    const buttonContainer = contentEl.createDiv({
      cls: "taskslite-modal-buttons",
    });

    const cancelButton = buttonContainer.createEl("button", {
      text: t("common.cancel") || "Cancel",
    });
    cancelButton.addEventListener("click", () => this.close());

    const confirmButton = buttonContainer.createEl("button", {
      text: t("common.confirm") || "Confirm",
      cls: "mod-warning",
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
  collapsedGroups: Set<string>,
  host: TaskTodoHost,
): TaskGroup[] {
  const buckets: TaskGroup[] = columns.map((col) => ({
    id: col.id,
    title: col.title,
    items: [],
    collapsed: collapsedGroups.has(col.id),
  }));

  for (const task of tasks) {
    for (let idx = 0; idx < columns.length; idx++) {
      const col = columns[idx];
      if (col && matchFilterWithDQL(task, undefined, col.query, host)) {
        const bucket = buckets[idx];
        if (bucket) {
          bucket.items.push(task);
        }
        break;
      }
    }
  }

  return buckets.filter((group) => group.items.length > 0);
}

function taskRecordsToListItems(records: TaskTodoTaskRecord[]): TaskListItem[] {
  const items: TaskListItem[] = records.map((record): TaskListItem => {
    const { date, dateType } = taskListDate(record.task);
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

function taskListDate(
  task: TaskTodoTaskLine,
): Pick<TaskListItem, "date" | "dateType"> {
  if (task.dates.due) return { date: task.dates.due, dateType: "due" };
  if (task.dates.scheduled)
    return { date: task.dates.scheduled, dateType: "scheduled" };
  if (task.dates.start) return { date: task.dates.start, dateType: "start" };
  return { date: null, dateType: null };
}

function getPriorityColor(
  priority: string | null,
  plugin: TaskTodoPlugin,
): string {
  const colors = plugin.settings.priorityColors || DEFAULT_PRIORITY_COLORS;
  if (!priority) return colors.none;
  const key = priority as keyof typeof colors;
  return colors[key] || colors.none;
}

function formatSmartDate(
  dateStr: string,
  dateType: "due" | "scheduled" | "start" | "done" | "created" | "cancelled",
): { text: string; cssClass: string } {
  const m = (window as any).moment;
  const today = m().startOf("day");
  // Use flexible parsing to support both YYYY-MM-DD and YYYY-MM-DD HH:mm:ss
  const date = m(dateStr).startOf("day");
  const diff = date.diff(today, "days");

  const symbol =
    dateType === "due"
      ? TASK_SYMBOLS.due
      : dateType === "scheduled"
        ? TASK_SYMBOLS.scheduled
        : dateType === "start"
          ? TASK_SYMBOLS.start
          : dateType === "done"
            ? TASK_SYMBOLS.done
            : dateType === "created"
              ? TASK_SYMBOLS.created
              : TASK_SYMBOLS.cancelled;

  let label: string;
  let cssClass: string;

  // Check if dateStr contains time information (hour-minute-second)
  const hasTime = dateStr.length > 10 && dateStr.includes(":");
  let timeSuffix = "";
  if (hasTime) {
    const parsedDate = m(dateStr);
    if (parsedDate.isValid()) {
      const hasSeconds = dateStr.split(":").length - 1 >= 2;
      timeSuffix = " " + parsedDate.format(hasSeconds ? "HH:mm:ss" : "HH:mm");
    }
  }

  // 完成/取消/创建日期，以及 start 日期在过去的，都用中性样式
  const isNeutralPast =
    dateType === "done" ||
    dateType === "created" ||
    dateType === "cancelled" ||
    (dateType === "start" && diff < 0);

  if (isNeutralPast) {
    label = m(dateStr).format("M\u6708D\u65e5 ddd") + timeSuffix;
    cssClass = dateType === "done" ? "task-date-done" : "task-date-future";
  } else if (diff === 0) {
    const suffix =
      dateType === "start"
        ? ""
        : dateType === "due"
          ? ` \u00b7 ${t("task.date.due")}`
          : ` \u00b7 ${t("task.date.scheduled")}`;
    const prefix =
      dateType === "start" ? t("task.date.startsToday") : t("task.date.today");
    label = `${prefix}${timeSuffix}${suffix}`;
    cssClass = "task-date-today";
  } else if (diff === 1) {
    if (dateType === "start") {
      label = t("task.date.startsTomorrow") + timeSuffix;
    } else {
      const suffix =
        dateType === "due"
          ? ` \u00b7 ${t("task.date.due")}`
          : ` \u00b7 ${t("task.date.scheduled")}`;
      label = `${t("task.date.tomorrow")}${timeSuffix}${suffix}`;
    }
    cssClass = "task-date-soon";
  } else if (diff > 1 && diff <= 7) {
    const weekday = m(dateStr).format("ddd");
    label = `${weekday}${timeSuffix} \u00b7 ${t("task.date.daysLater").replace("{n}", String(diff))}`;
    cssClass = "task-date-soon";
  } else if (diff > 7) {
    const weekday = m(dateStr).format("ddd");
    label = `${m(dateStr).format("M\u6708D\u65e5")}${timeSuffix} \u00b7 ${weekday}`;
    cssClass = "task-date-future";
  } else {
    // 只有 due/scheduled 的过去日期才会走到这里
    let overdueLabel: string;
    if (diff === -1) {
      overdueLabel = t("task.date.yesterday");
    } else if (diff >= -7) {
      overdueLabel = t("task.date.daysAgo").replace("{n}", String(Math.abs(diff)));
    } else {
      overdueLabel = m(dateStr).format("M\u6708D\u65e5");
    }
    label = `${overdueLabel}${timeSuffix}`;
    cssClass = "task-date-overdue";
  }

  return { text: `${symbol} ${label}`, cssClass };
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
