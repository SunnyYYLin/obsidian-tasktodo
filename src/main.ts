import { Notice, Plugin } from "obsidian";
import { t } from "./i18n";
import { getTaskLiteHost, type TaskTodoHost } from "./host";
import { TASKTODO_VIEW, TaskTodoTaskListView } from "./taskTodo/taskListView";

export default class TaskTodoPlugin extends Plugin {
	private host: TaskTodoHost | null = null;

	async onload(): Promise<void> {
		this.host = getTaskLiteHost(this.app);
		if (!this.host) {
			new Notice(t("notice.taskLiteMissing"));
			return;
		}

		this.registerView(TASKTODO_VIEW, (leaf) => new TaskTodoTaskListView(leaf, this.app, this.host!));
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
	}

	private async activateTaskTodoView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(TASKTODO_VIEW);
		const leaf = leaves[0] ?? this.app.workspace.getLeaf("tab");
		await leaf.setViewState({type: TASKTODO_VIEW, active: true});
		await this.app.workspace.revealLeaf(leaf);
	}
}
