const messages = {
	en: {
		"common.cancel": "Cancel",
		"common.save": "Save",
		"common.none": "None",
		"command.openTaskTodo": "Open TaskTodo",
		"command.openTaskList": "Open task list",
		"task.action.cancel": "Cancel task",
		"task.action.complete": "Complete task",
		"task.action.addSubtask": "Add subtask",
		"task.action.expandSubtasks": "Expand subtasks",
		"task.action.collapseSubtasks": "Collapse subtasks",
		"taskTodo.addTask": "Add task",
		"taskTodo.createTask": "Create task",
		"taskTodo.tab.inPlan": "In plan",
		"taskTodo.tab.today": "Today",
		"taskTodo.empty.inPlan": "No planned tasks.",
		"taskTodo.empty.today": "Nothing for today.",
		"taskTodo.group.earlier": "Earlier",
		"taskTodo.group.overdue": "Overdue",
		"taskTodo.group.today": "Today",
		"taskTodo.group.tomorrow": "Tomorrow",
		"taskTodo.group.next7Days": "Next 7 days",
		"taskTodo.group.later": "Later",
		"taskTodo.group.noDate": "No date",
		"modal.name": "Name",
		"modal.taskNamePlaceholder": "Task name",
		"modal.file": "File",
		"modal.parentTask": "Parent task",
		"modal.chooseFile": "Choose file",
		"modal.editFilePath": "Edit file path",
		"modal.filePlaceholder": "Choose or search a file",
		"modal.status": "Status",
		"modal.priority": "Priority",
		"modal.startDate": "Start date",
		"modal.scheduledDate": "Scheduled date",
		"modal.dueDate": "Due date",
		"modal.doneDate": "Done date",
		"modal.advanced": "Advanced",
		"modal.onCompletion": "On completion",
		"modal.recurrence": "Recurrence",
		"modal.taskId": "Task ID",
		"modal.dependsOn": "Depends on",
		"modal.blockLink": "Block link",
		"notice.taskLiteMissing": "TaskLite Core must be enabled to use TaskTodo.",
		"notice.inboxPathFolder": "The target path points to a folder.",
	},
	zh: {
		"common.cancel": "取消",
		"common.save": "保存",
		"common.none": "无",
		"command.openTaskTodo": "打开 TaskTodo",
		"command.openTaskList": "打开任务列表",
		"task.action.cancel": "取消任务",
		"task.action.complete": "完成任务",
		"task.action.addSubtask": "添加子任务",
		"task.action.expandSubtasks": "展开子任务",
		"task.action.collapseSubtasks": "收起子任务",
		"taskTodo.addTask": "添加任务",
		"taskTodo.createTask": "创建任务",
		"taskTodo.tab.inPlan": "计划中",
		"taskTodo.tab.today": "今日",
		"taskTodo.empty.inPlan": "没有带计划日期或截止日期的任务。",
		"taskTodo.empty.today": "今天没有任务。",
		"taskTodo.group.earlier": "早前",
		"taskTodo.group.overdue": "逾期",
		"taskTodo.group.today": "今天",
		"taskTodo.group.tomorrow": "明天",
		"taskTodo.group.next7Days": "未来 7 天",
		"taskTodo.group.later": "以后",
		"taskTodo.group.noDate": "无日期",
		"modal.name": "名称",
		"modal.taskNamePlaceholder": "任务名称",
		"modal.file": "文件",
		"modal.parentTask": "父任务",
		"modal.chooseFile": "选择文件",
		"modal.editFilePath": "编辑文件路径",
		"modal.filePlaceholder": "选择或搜索文件",
		"modal.status": "状态",
		"modal.priority": "优先级",
		"modal.startDate": "开始日期",
		"modal.scheduledDate": "计划日期",
		"modal.dueDate": "截止日期",
		"modal.doneDate": "完成日期",
		"modal.advanced": "高级",
		"modal.onCompletion": "完成后",
		"modal.recurrence": "循环",
		"modal.taskId": "任务 ID",
		"modal.dependsOn": "依赖",
		"modal.blockLink": "块链接",
		"notice.taskLiteMissing": "使用 TaskTodo 需要先启用 TaskLite Core。",
		"notice.inboxPathFolder": "目标路径指向了文件夹。",
	},
} as const;

export type I18nKey = keyof typeof messages.en;

export function t(key: I18nKey): string {
	return messages[currentLocale()][key] ?? messages.en[key];
}

function currentLocale(): keyof typeof messages {
	const locale = detectLocale().toLowerCase();
	return locale.startsWith("zh") ? "zh" : "en";
}

function detectLocale(): string {
	const maybeWindow = globalThis as typeof globalThis & {
		window?: {moment?: {locale?: () => string}};
		navigator?: {language?: string};
	};
	return maybeWindow.window?.moment?.locale?.() ?? maybeWindow.navigator?.language ?? "en";
}
