import {
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  App,
  Modal,
} from "obsidian";
import { t, type I18nKey } from "./i18n";
import { getTaskLiteHost, type TaskTodoHost } from "./host";
import { TASKTODO_VIEW, TaskTodoTaskListView } from "./taskTodo/taskListView";
import { type SortKey } from "./taskTodo/taskTodoSort";
import { parseDQLToFilter, filterConfigToDQL } from "./taskTodo/taskTodoFilter";

export interface DateFilterField {
  mode:
    | "all"
    | "today"
    | "tomorrow"
    | "this-week"
    | "no-date"
    | "overdue"
    | "has-date"
    | "later"
    | "custom"
    | "today-or-overdue";
  customStart?: string;
  customEnd?: string;
}

export interface FilterConfig {
  completed: "all" | "completed" | "uncompleted";
  cancelled: "all" | "cancelled" | "uncancelled";
  priority: string[];
  text?: string;
  tag?: string;
  assignee?: string;
  dateFilterRelation?: "or" | "and";
  startDate: DateFilterField;
  scheduledDate: DateFilterField;
  dueDate: DateFilterField;
  // Backward compatibility:
  dates?:
    | "all"
    | "today"
    | "tomorrow"
    | "this-week"
    | "no-date"
    | "overdue"
    | "has-date"
    | "later"
    | "custom";
  customDateStart?: string;
  customDateEnd?: string;
}

export interface TabConfig {
  id: string;
  title: string;
  queryMode?: "gui" | "advanced";
  query?: string;
  filter?: FilterConfig;
  columns: ColumnConfig[];
}

export interface ColumnConfig {
  id: string;
  title: string;
  queryMode?: "gui" | "advanced";
  query?: string;
  filter?: FilterConfig;
}

export interface PriorityColorConfig {
  highest: string;
  high: string;
  medium: string;
  low: string;
  lowest: string;
  none: string;
}

export const DEFAULT_PRIORITY_COLORS: PriorityColorConfig = {
  highest: "#e5484d",
  high: "#f76b15",
  medium: "#f5a623",
  low: "#00b8db",
  lowest: "#8e8e93",
  none: "#636366",
};

export interface TaskTodoSettings {
  sortOrder: SortKey[];
  tabs: TabConfig[];
  columns?: ColumnConfig[];
  priorityColors?: PriorityColorConfig;
}

export const DEFAULT_SETTINGS: TaskTodoSettings = {
  sortOrder: ["date", "cancelled", "importance", "lifeLength"],
  tabs: [],
  priorityColors: { ...DEFAULT_PRIORITY_COLORS },
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

    this.registerView(
      TASKTODO_VIEW,
      (leaf) => new TaskTodoTaskListView(leaf, this.app, this.host!, this),
    );
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
    await leaf.setViewState({ type: TASKTODO_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as Partial<TaskTodoSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});

    const createDefaultInPlanColumns = (): ColumnConfig[] => [
      {
        id: "overdue_" + Math.random(),
        title: t("taskTodo.group.earlier") || "早前",
        queryMode: "advanced",
        query: "scheduled < date(today) OR due < date(today)",
        filter: getEnforcedColumnFilter("overdue"),
      },
      {
        id: "today_" + Math.random(),
        title: t("taskTodo.group.today") || "今天",
        queryMode: "advanced",
        query: "scheduled = date(today) OR due = date(today)",
        filter: getEnforcedColumnFilter("today"),
      },
      {
        id: "tomorrow_" + Math.random(),
        title: t("taskTodo.group.tomorrow") || "明天",
        queryMode: "advanced",
        query: "scheduled = date(tomorrow) OR due = date(tomorrow)",
        filter: getEnforcedColumnFilter("tomorrow"),
      },
      {
        id: "week_" + Math.random(),
        title: t("taskTodo.group.next7Days") || "本周",
        queryMode: "advanced",
        query:
          "(scheduled > date(tomorrow) AND scheduled <= date(next-week)) OR (due > date(tomorrow) AND due <= date(next-week))",
        filter: getEnforcedColumnFilter("week"),
      },
      {
        id: "later_" + Math.random(),
        title: t("taskTodo.group.later") || "以后",
        queryMode: "advanced",
        query: "scheduled > date(next-week) OR due > date(next-week)",
        filter: getEnforcedColumnFilter("later"),
      },
    ];

    const createDefaultTodayColumns = (): ColumnConfig[] => [
      {
        id: "overdue_" + Math.random(),
        title: t("taskTodo.group.overdue") || "已过期",
        queryMode: "advanced",
        query:
          'status != "CANCELLED" AND status != "DONE" AND (scheduled < date(today) OR due < date(today))',
        filter: getEnforcedColumnFilter("overdue"),
      },
      {
        id: "today_" + Math.random(),
        title: t("taskTodo.group.today") || "今天",
        queryMode: "advanced",
        query:
          "(start <= date(today) AND (scheduled > date(today) OR due > date(today))) OR scheduled = date(today) OR due = date(today)",
        filter: getEnforcedColumnFilter("today"),
      },
      {
        id: "no-date_" + Math.random(),
        title: t("taskTodo.group.noDate") || "无日期",
        queryMode: "advanced",
        query:
          'status != "CANCELLED" AND status != "DONE" AND parentLine = null AND scheduled = null AND due = null',
        filter: getEnforcedColumnFilter("no-date"),
      },
    ];

    if (!this.settings.tabs || this.settings.tabs.length === 0) {
      this.settings.tabs = [
        {
          id: "in-plan",
          title: t("taskTodo.tab.inPlan"),
          queryMode: "advanced",
          query: "due != null OR scheduled != null OR start != null",
          filter: getEnforcedTabFilter("in-plan"),
          columns: createDefaultInPlanColumns(),
        },
        {
          id: "today",
          title: t("taskTodo.tab.today"),
          queryMode: "advanced",
          query:
            'status != "DONE" AND status != "CANCELLED" AND (start <= date(today) OR scheduled <= date(today) OR due <= date(today))',
          filter: getEnforcedTabFilter("today"),
          columns: createDefaultTodayColumns(),
        },
      ];
    } else {
      for (const tab of this.settings.tabs) {
        if (!tab.queryMode) {
          tab.queryMode = "gui";
        }
        if (!tab.filter) {
          tab.filter = getEnforcedTabFilter(tab.id);
        }
        if (!tab.query || tab.query.trim() === "") {
          tab.query = filterConfigToDQL(tab.filter);
        }
        if (!tab.columns || tab.columns.length === 0) {
          tab.columns =
            tab.id === "today"
              ? createDefaultTodayColumns()
              : createDefaultInPlanColumns();
        } else {
          for (const col of tab.columns) {
            if (!col.queryMode) {
              col.queryMode = "gui";
            }
            if (!col.filter) {
              col.filter = getEnforcedColumnFilter(col.id);
            }
            if (!col.query || col.query.trim() === "") {
              col.query = filterConfigToDQL(col.filter);
            }
          }
        }
      }
    }
  }

  async saveSettings(): Promise<void> {
    if (this.settings.tabs) {
      for (const tab of this.settings.tabs) {
        if (tab.queryMode === "gui" || !tab.queryMode) {
          tab.queryMode = "gui";
          tab.query = filterConfigToDQL(tab.filter);
        }
        if (tab.columns) {
          for (const col of tab.columns) {
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

  onunload(): void {}
}

class TaskTodoSettingTab extends PluginSettingTab {
  constructor(
    app: typeof Plugin.prototype.app,
    private plugin: TaskTodoPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(t("settings.title")).setHeading();

    // 导入配置按钮
    new Setting(containerEl)
      .setName(t("settings.importData.name"))
      .setDesc(t("settings.importData.desc"))
      .addButton((button) =>
        button
          .setButtonText(t("settings.import"))
          .setCta()
          .onClick(() => {
            const input = activeDocument.createElement("input");
            input.type = "file";
            input.accept = ".json";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                const raw = JSON.parse(text) as Record<string, unknown>;
                if (Array.isArray(raw.tabs)) {
                  this.plugin.settings.tabs = raw.tabs as TabConfig[];
                }
                if (Array.isArray(raw.sortOrder)) {
                  this.plugin.settings.sortOrder = raw.sortOrder as SortKey[];
                }
                if (Array.isArray(raw.columns)) {
                  this.plugin.settings.columns = raw.columns as ColumnConfig[];
                }
                await this.plugin.saveSettings();
                new Notice(t("settings.importData.success"));
                this.display();
              } catch {
                new Notice(t("settings.importData.error"));
              }
            };
            input.click();
          }),
      );

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

    const sortContainer = containerEl.createDiv({
      cls: "tasktodo-sort-container",
    });
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
        itemEl.createDiv({
          cls: "tasktodo-sort-item-title",
          text: t(getSortKeyI18nKey(key)),
        });

        const actionsEl = itemEl.createDiv({
          cls: "tasktodo-sort-item-actions",
        });

        const upBtn = actionsEl.createEl("button", {
          cls: "tasktodo-sort-item-btn",
          text: "▲",
          title: "Move up",
        });
        if (index === 0) {
          upBtn.setAttribute("disabled", "true");
        } else {
          upBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void (async () => {
              const temp = currentKeys[index]!;
              currentKeys[index] = currentKeys[index - 1]!;
              currentKeys[index - 1] = temp;
              await saveKeys(currentKeys);
              renderList();
            })();
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
          downBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void (async () => {
              const temp = currentKeys[index]!;
              currentKeys[index] = currentKeys[index + 1]!;
              currentKeys[index + 1] = temp;
              await saveKeys(currentKeys);
              renderList();
            })();
          });
        }

        itemEl.addEventListener("dragstart", (e) => {
          if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", String(index));
            e.dataTransfer.effectAllowed = "move";
          }
          itemEl.addClass("is-dragging");
        });

        itemEl.addEventListener("dragend", () => {
          itemEl.removeClass("is-dragging");
          void (async () => {
            const childElements = Array.from(
              sortContainer.querySelectorAll(".tasktodo-sort-item"),
            );
            const newKeys = childElements
              .map((el) => el.getAttribute("data-key") as SortKey)
              .filter(Boolean);

            currentKeys = newKeys;
            await saveKeys(currentKeys);
            renderList();
          })();
        });

        itemEl.addEventListener("dragover", (e) => {
          e.preventDefault();
          const draggingEl = sortContainer.querySelector(
            ".is-dragging",
          ) as HTMLElement;
          if (!draggingEl || draggingEl === itemEl) return;

          const rect = itemEl.getBoundingClientRect();
          const next = (e.clientY - rect.top) / rect.height > 0.5;
          sortContainer.insertBefore(
            draggingEl,
            next ? itemEl.nextSibling : itemEl,
          );
        });
      });
    };

    renderList();

    // Priority Colors settings
    new Setting(containerEl).setName(t("settings.priorityColors.name")).setHeading();
    new Setting(containerEl).setDesc(t("settings.priorityColors.desc"));

    const colors = {
      ...(this.plugin.settings.priorityColors || DEFAULT_PRIORITY_COLORS),
    };
    const priorityLevels: Array<{
      key: keyof PriorityColorConfig;
      label: string;
      emoji: string;
    }> = [
      { key: "highest", label: t("priority.highest"), emoji: "🔺" },
      { key: "high", label: t("priority.high"), emoji: "⏫" },
      { key: "medium", label: t("priority.medium"), emoji: "🔼" },
      { key: "low", label: t("priority.low"), emoji: "🔽" },
      { key: "lowest", label: t("priority.lowest"), emoji: "⏬" },
      { key: "none", label: t("priority.none"), emoji: "" },
    ];

    for (const level of priorityLevels) {
      new Setting(containerEl)
        .setName(`${level.emoji} ${level.label}`)
        .addColorPicker((picker) =>
          picker.setValue(colors[level.key]).onChange(async (val) => {
            colors[level.key] = val;
            this.plugin.settings.priorityColors = { ...colors };
            await this.plugin.saveSettings();
          }),
        )
        .addButton((button) =>
          button
            .setIcon("rotate-ccw")
            .setTooltip(t("common.reset"))
            .onClick(async () => {
              colors[level.key] = DEFAULT_PRIORITY_COLORS[level.key];
              this.plugin.settings.priorityColors = { ...colors };
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    }

    // Tabs settings
    new Setting(containerEl).setName(t("settings.tabs.title")).setHeading();
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
              query: filterConfigToDQL(
                getEnforcedTabFilter("tab_" + Date.now()),
              ),
              columns: [],
            };
            new TabOrColumnModal(this.app, newTab, (result) => {
              void (async () => {
                const tab: TabConfig = {
                  id: newTab.id,
                  title: result.title,
                  query: result.query,
                  columns: [],
                };
                this.plugin.settings.tabs.push(tab);
                await this.plugin.saveSettings();
                this.display();
              })();
            }).open();
          }),
      );

    const tabsContainer = containerEl.createDiv({
      cls: "tasktodo-tabs-container",
    });

    this.plugin.settings.tabs.forEach((tab, tabIndex) => {
      const tabCard = tabsContainer.createDiv({ cls: "tasktodo-card" });
      tabCard.setAttribute("draggable", "true");
      tabCard.setAttribute("data-id", tab.id);

      const tabHeader = tabCard.createDiv({ cls: "tasktodo-card-header" });
      tabHeader.createDiv({
        cls: "tasktodo-sort-item-handle",
        text: "⋮⋮",
        attr: { style: "cursor: grab; margin-right: 0.5rem;" },
      });
      tabHeader.createDiv({ cls: "tasktodo-card-title", text: tab.title });

      const tabActions = tabHeader.createDiv({
        cls: "tasktodo-sort-item-actions",
      });

      const editTabBtn = tabActions.createEl("button", {
        cls: "tasktodo-sort-item-btn",
        text: "✏️",
        title: t("settings.edit"),
      });
      editTabBtn.addEventListener("click", () => {
        new TabOrColumnModal(this.app, tab, (result) => {
          void (async () => {
            tab.title = result.title;
            tab.query = result.query;
            await this.plugin.saveSettings();
            this.display();
          })();
        }).open();
      });

      const delTabBtn = tabActions.createEl("button", {
        cls: "tasktodo-sort-item-btn",
        text: "❌",
        title: t("settings.delete"),
      });
      delTabBtn.addEventListener("click", () => {
        void (async () => {
          this.plugin.settings.tabs.splice(tabIndex, 1);
          await this.plugin.saveSettings();
          this.display();
        })();
      });

      const colHeader = tabCard.createDiv({ cls: "tasktodo-nested-header" });
      colHeader.createDiv({
        cls: "tasktodo-nested-title",
        text: t("settings.columns.title"),
      });

      const addColBtn = colHeader.createEl("button", {
        cls: "taskslite-add-task",
        text: t("settings.add"),
        attr: {
          style: "height: 1.6rem; padding: 0 0.5rem; font-size: 0.8rem;",
        },
      });
      addColBtn.addEventListener("click", () => {
        const newCol: ColumnConfig = {
          id: "col_" + Date.now(),
          title: "New Column",
          query: filterConfigToDQL(
            getEnforcedColumnFilter("col_" + Date.now()),
          ),
        };
        new TabOrColumnModal(this.app, newCol, (result) => {
          void (async () => {
            const col: ColumnConfig = {
              id: newCol.id,
              title: result.title,
              query: result.query,
            };
            tab.columns.push(col);
            await this.plugin.saveSettings();
            this.display();
          })();
        }).open();
      });

      const columnsContainer = tabCard.createDiv({
        cls: "tasktodo-sort-container",
        attr: { "data-tab-id": tab.id },
      });

      tab.columns.forEach((col: ColumnConfig, colIndex: number) => {
        const colEl = columnsContainer.createDiv({ cls: "tasktodo-sort-item" });
        colEl.setAttribute("draggable", "true");
        colEl.setAttribute("data-id", col.id);
        colEl.setAttribute("data-index", String(colIndex));

        colEl.createDiv({ cls: "tasktodo-sort-item-handle", text: "⋮⋮" });

        const titleContainer = colEl.createDiv({
          cls: "tasktodo-sort-item-title",
        });
        titleContainer.createEl("strong", { text: col.title });

        const colActions = colEl.createDiv({
          cls: "tasktodo-sort-item-actions",
        });

        const editColBtn = colActions.createEl("button", {
          cls: "tasktodo-sort-item-btn",
          text: "✏️",
          title: t("settings.edit"),
        });
        editColBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          new TabOrColumnModal(this.app, col, (result) => {
            void (async () => {
              col.title = result.title;
              col.query = result.query;
              await this.plugin.saveSettings();
              this.display();
            })();
          }).open();
        });

        const delColBtn = colActions.createEl("button", {
          cls: "tasktodo-sort-item-btn",
          text: "❌",
          title: t("settings.delete"),
        });
        delColBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void (async () => {
            tab.columns.splice(colIndex, 1);
            await this.plugin.saveSettings();
            this.display();
          })();
        });

        colEl.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          if (e.dataTransfer) {
            e.dataTransfer.setData("text/plain", String(colIndex));
            e.dataTransfer.effectAllowed = "move";
          }
          colEl.addClass("is-dragging-column");
        });

        colEl.addEventListener("dragend", () => {
          colEl.removeClass("is-dragging-column");
          void (async () => {
            const childElements = Array.from(
              columnsContainer.querySelectorAll(".tasktodo-sort-item"),
            );
            const newCols = childElements
              .map((el) => {
                const id = el.getAttribute("data-id");
                return tab.columns.find((c: ColumnConfig) => c.id === id);
              })
              .filter(Boolean) as ColumnConfig[];

            tab.columns = newCols;
            await this.plugin.saveSettings();
            this.display();
          })();
        });

        colEl.addEventListener("dragover", (e) => {
          e.preventDefault();
          const draggingEl = columnsContainer.querySelector(
            ".is-dragging-column",
          ) as HTMLElement;
          if (!draggingEl || draggingEl === colEl) return;

          const rect = colEl.getBoundingClientRect();
          const next = (e.clientY - rect.top) / rect.height > 0.5;
          columnsContainer.insertBefore(
            draggingEl,
            next ? colEl.nextSibling : colEl,
          );
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

      tabCard.addEventListener("dragend", () => {
        tabCard.removeClass("is-dragging-tab");
        void (async () => {
          const childElements = Array.from(
            tabsContainer.querySelectorAll(".tasktodo-card"),
          );
          const newTabs = childElements
            .map((el) => {
              const id = el.getAttribute("data-id");
              return this.plugin.settings.tabs.find((t) => t.id === id);
            })
            .filter(Boolean) as TabConfig[];

          this.plugin.settings.tabs = newTabs;
          await this.plugin.saveSettings();
          this.display();
        })();
      });

      tabCard.addEventListener("dragover", (e) => {
        e.preventDefault();
        const draggingEl = tabsContainer.querySelector(
          ".is-dragging-tab",
        ) as HTMLElement;
        if (!draggingEl || draggingEl === tabCard) return;

        const rect = tabCard.getBoundingClientRect();
        const next = (e.clientY - rect.top) / rect.height > 0.5;
        tabsContainer.insertBefore(
          draggingEl,
          next ? tabCard.nextSibling : tabCard,
        );
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
    return "due != null OR scheduled != null OR start != null";
  }
  if (tabId === "today") {
    return 'status != "DONE" AND status != "CANCELLED" AND (start <= date(today) OR scheduled <= date(today) OR due <= date(today))';
  }
  return "";
};

export const getEnforcedColumnDQL = (tabId: string, colKey: string): string => {
  if (colKey === "overdue") {
    if (tabId === "today") {
      return 'status != "CANCELLED" AND status != "DONE" AND (scheduled < date(today) OR due < date(today))';
    } else {
      return "scheduled < date(today) OR due < date(today)";
    }
  }
  if (colKey === "today") {
    if (tabId === "today") {
      return "(start <= date(today) AND (scheduled > date(today) OR due > date(today))) OR scheduled = date(today) OR due = date(today)";
    } else {
      return "scheduled = date(today) OR due = date(today)";
    }
  }
  if (colKey === "tomorrow") {
    return "scheduled = date(tomorrow) OR due = date(tomorrow)";
  }
  if (colKey === "week") {
    return "(scheduled > date(tomorrow) AND scheduled <= date(next-week)) OR (due > date(tomorrow) AND due <= date(next-week))";
  }
  if (colKey === "later") {
    return "scheduled > date(next-week) OR due > date(next-week)";
  }
  if (colKey === "no-date") {
    return 'status != "CANCELLED" AND status != "DONE" AND parentLine = null AND scheduled = null AND due = null';
  }
  return "";
};

export const alignTabColumns = (
  tabId: string,
  columns: ColumnConfig[],
): ColumnConfig[] => {
  const defaultKeys =
    tabId === "today"
      ? ["overdue", "today"]
      : ["overdue", "today", "tomorrow", "week", "later", "no-date"];

  const createDefaultCol = (key: string): ColumnConfig => {
    const id = key + "_" + Math.random();
    let title = "";
    if (key === "overdue") {
      title =
        tabId === "today"
          ? t("taskTodo.group.overdue") || "已过期"
          : t("taskTodo.group.earlier") || "早前";
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
      query: getEnforcedColumnDQL(tabId, key),
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
        const idx = result.findIndex((c) => getColumnKey(c.id) === nextKey);
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

  // 3. Enforce latest titles and DQL queries on all result columns
  for (const col of result) {
    const key = getColumnKey(col.id);
    if (key) {
      col.query = getEnforcedColumnDQL(tabId, key);
    }
    if (key === "overdue") {
      col.title =
        tabId === "today"
          ? t("taskTodo.group.overdue") || "已过期"
          : t("taskTodo.group.earlier") || "早前";
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
    private initialData: {
      title: string;
      query?: string;
      filter?: FilterConfig;
    },
    private onSave: (data: { title: string; query: string }) => void,
  ) {
    super(app);

    const queryStr =
      initialData.query ||
      (initialData.filter ? filterConfigToDQL(initialData.filter) : "");
    const { filter, isPerfect } = parseDQLToFilter(queryStr);

    this.result = {
      title: initialData.title || "",
      query: queryStr,
      queryMode: isPerfect ? "gui" : "advanced",
      filter: filter,
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("taskslite-modal");

    this.setTitle(t("modal.editConfig"));

    // Title Setting
    new Setting(contentEl).setName(t("modal.name")).addText((text) =>
      text.setValue(this.result.title).onChange((val) => {
        this.result.title = val;
      }),
    );

    // Tabs container
    const tabsDiv = contentEl.createDiv({ cls: "tasktodo-modal-tabs" });
    const btnGui = tabsDiv.createEl("button", {
      cls: "tasktodo-modal-tab-btn",
      text: "普通过滤",
    });
    const btnAdvanced = tabsDiv.createEl("button", {
      cls: "tasktodo-modal-tab-btn",
      text: "高级 DQL",
    });

    // Content containers
    const contentGui = contentEl.createDiv({
      cls: "tasktodo-modal-tab-content",
    });
    const contentAdvanced = contentEl.createDiv({
      cls: "tasktodo-modal-tab-content",
    });

    // Tab switching logic
    const setActiveTab = (mode: "gui" | "advanced") => {
      this.result.queryMode = mode;
      if (mode === "gui") {
        btnGui.addClass("is-active");
        btnAdvanced.removeClass("is-active");
        contentGui.addClass("is-active");
        contentAdvanced.removeClass("is-active");
        renderGuiContent();
      } else {
        btnGui.removeClass("is-active");
        btnAdvanced.addClass("is-active");
        contentGui.removeClass("is-active");
        contentAdvanced.addClass("is-active");
      }
    };

    // Advanced Tab Content
    contentAdvanced.createEl("div", {
      text: "直接编辑过滤任务的 DQL 查询语句。支持 status, priority, due, scheduled, start, path, tags 等字段。",
      attr: {
        style:
          "font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;",
      },
    });

    const textarea = contentAdvanced.createEl("textarea", {
      cls: "tasktodo-advanced-textarea",
    });
    textarea.value = this.result.query || "";
    textarea.placeholder = 'e.g. status = "TODO" AND due <= date(today)';
    textarea.addEventListener("input", () => {
      this.result.query = textarea.value;
    });

    // GUI Tab Content renderer
    const renderGuiContent = () => {
      contentGui.empty();

      const { filter, isPerfect } = parseDQLToFilter(this.result.query || "");
      this.result.filter = filter;

      if (!isPerfect) {
        // Show a warning banner at the top of the GUI fields
        const banner = contentGui.createDiv({
          cls: "tasktodo-modal-warning-banner",
          attr: {
            style:
              "padding: 0.75rem 1rem; background-color: color-mix(in srgb, var(--color-yellow) 15%, var(--background-primary)); color: var(--color-yellow); border-radius: 6px; border: 1px solid color-mix(in srgb, var(--color-yellow) 30%, transparent); margin-bottom: 1rem; font-size: 0.85rem; line-height: 1.4;",
          },
        });
        banner.createEl("span", {
          text: "⚠️ 提示：当前 DQL 查询包含高级语法（如日期过滤或复杂逻辑）。在普通模式下编辑或保存将会清除并覆盖这些高级查询条件。",
        });
      }

      const updateDQL = () => {
        const q = filterConfigToDQL(this.result.filter);
        this.result.query = q;
        textarea.value = q;
      };

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
              this.result.filter.completed = val as "all" | "completed" | "uncompleted";
              updateDQL();
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
              this.result.filter.cancelled = val as "all" | "cancelled" | "uncancelled";
              updateDQL();
            });
        });

      // Priority (Checkboxes)
      const prioritySetting = new Setting(contentGui)
        .setName("重要性 (Priority)")
        .setDesc("勾选以过滤特定优先级任务，均不勾选代表不限");

      const priorityContainer = prioritySetting.controlEl.createDiv({
        cls: "tasktodo-priority-container",
      });
      const priorities = [
        { key: "highest", label: "Highest ⏫" },
        { key: "high", label: "High 🔼" },
        { key: "medium", label: "Medium 🔽" },
        { key: "low", label: "Low 🔻" },
        { key: "lowest", label: "Lowest ⏬" },
        { key: "none", label: "None 无" },
      ];

      priorities.forEach((pri) => {
        const wrapper = priorityContainer.createEl("label", {
          cls: "tasktodo-priority-label",
        });
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
            this.result.filter.priority = current.filter((k) => k !== pri.key);
          }
          updateDQL();
        });
      });

      // Description Contains text search
      new Setting(contentGui)
        .setName("文本包含 (Description contains)")
        .addText((text) => {
          text.setValue(this.result.filter.text || "").onChange((val) => {
            this.result.filter.text = val;
            updateDQL();
          });
        });

      // Tags contains filter
      new Setting(contentGui)
        .setName("标签包含 (Tags contains)")
        .addText((text) => {
          text.setValue(this.result.filter.tag || "").onChange((val) => {
            this.result.filter.tag = val;
            updateDQL();
          });
        });

      // Assignee (Person) Filter
      new Setting(contentGui).setName("负责人 (Assignee)").addText((text) => {
        text.setValue(this.result.filter.assignee || "").onChange((val) => {
          this.result.filter.assignee = val;
          updateDQL();
        });
      });
    };

    btnGui.addEventListener("click", () => {
      setActiveTab("gui");
    });

    btnAdvanced.addEventListener("click", () => {
      setActiveTab("advanced");
    });

    // Set initial active tab & sync initial DQL string to textarea
    setActiveTab(this.result.queryMode || "gui");

    // Save/Cancel Action Buttons
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(t("common.cancel")).onClick(() => this.close()),
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
            if (this.result.queryMode === "gui") {
              this.result.query = filterConfigToDQL(this.result.filter);
            }
            this.onSave({
              title: this.result.title,
              query: this.result.query || "",
            });
            this.close();
          }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
