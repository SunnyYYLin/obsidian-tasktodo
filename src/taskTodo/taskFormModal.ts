import { App, Modal, Setting, TFile, SuggestModal } from "obsidian";
import { t } from "../i18n";
import { TASK_SYMBOLS, type TaskTodoHost, type TaskTodoTaskLine } from "../taskLiteInterop";

export interface TaskFormData {
	description: string;
	statusSymbol: string;
	priority: string | null;
	startDate: string | null;
	scheduledDate: string | null;
	dueDate: string | null;
	recurrence: string | null;
	onCompletion: string | null;
	id: string | null;
	dependsOn: string | null;
	person: string[];
}

class FileSuggestModal extends SuggestModal<TFile> {
	constructor(app: App, private onChoose: (file: TFile) => void) {
		super(app);
		this.setPlaceholder(t("modal.filePlaceholder") || "Choose a file");
	}

	getSuggestions(query: string): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const lowercase = query.toLowerCase();
		return files.filter(file => file.path.toLowerCase().includes(lowercase));
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		el.setText(file.path);
	}

	onChooseSuggestion(file: TFile) {
		this.onChoose(file);
	}
}

export class TaskFormModal extends Modal {
	private formData: TaskFormData;
	private targetPath: string = "";

	constructor(
		app: App,
		private host: TaskTodoHost,
		private title: string,
		private mode: "create" | "edit",
		private onSubmit: (data: TaskFormData, targetPath?: string) => void,
		private initialData?: {
			task?: TaskTodoTaskLine;
			path?: string;
			parentLineNumber?: number;
		}
	) {
		super(app);
		
		const task = this.initialData?.task;
		const currentStatusSymbol = task ? (host.statusRegistry.getByType(task.status)?.symbol || " ") : " ";
		
		this.formData = {
			description: task?.description || "",
			statusSymbol: currentStatusSymbol,
			priority: task?.priority || null,
			startDate: task?.dates.start || null,
			scheduledDate: task?.dates.scheduled || null,
			dueDate: task?.dates.due || null,
			recurrence: task?.recurrence || null,
			onCompletion: task?.onCompletion || null,
			id: task?.id || null,
			dependsOn: task?.dependsOn || null,
			person: task?.person || [],
		};

		if (mode === "create") {
			this.targetPath = initialData?.path || "Tasks.md";
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.title });

		// Description
		new Setting(contentEl)
			.setName(t("modal.name") || "Description")
			.addText(text => {
				text.setValue(this.formData.description)
					.setPlaceholder(t("modal.taskNamePlaceholder") || "Task description")
					.onChange(val => this.formData.description = val);
				text.inputEl.focus();
			});

		// Status
		const statusSettings = this.host.settings.statusSettings as any;
		const statuses = [
			...(statusSettings?.coreStatuses || []),
			...(statusSettings?.customStatuses || [])
		];
		if (statuses.length === 0) {
			statuses.push(
				{ symbol: " ", name: "Todo" },
				{ symbol: "x", name: "Done" },
				{ symbol: "/", name: "In progress" },
				{ symbol: "-", name: "Cancelled" }
			);
		}

		new Setting(contentEl)
			.setName(t("modal.status") || "Status")
			.addDropdown(dropdown => {
				for (const status of statuses) {
					dropdown.addOption(status.symbol, `[${status.symbol}] ${status.name}`);
				}
				dropdown.setValue(this.formData.statusSymbol)
					.onChange(val => this.formData.statusSymbol = val);
			});

		// Priority
		new Setting(contentEl)
			.setName(t("modal.priority") || "Priority")
			.addDropdown(dropdown => {
				dropdown.addOption("", t("common.none") || "None");
				dropdown.addOption(TASK_SYMBOLS.priority.highest, `${TASK_SYMBOLS.priority.highest} Highest`);
				dropdown.addOption(TASK_SYMBOLS.priority.high, `${TASK_SYMBOLS.priority.high} High`);
				dropdown.addOption(TASK_SYMBOLS.priority.medium, `${TASK_SYMBOLS.priority.medium} Medium`);
				dropdown.addOption(TASK_SYMBOLS.priority.low, `${TASK_SYMBOLS.priority.low} Low`);
				dropdown.addOption(TASK_SYMBOLS.priority.lowest, `${TASK_SYMBOLS.priority.lowest} Lowest`);
				
				dropdown.setValue(this.formData.priority || "")
					.onChange(val => this.formData.priority = val || null);
			});

		// Dates Group
		contentEl.createEl("h3", { text: t("modal.startDate") ? t("modal.startDate").replace("开始", "") : "Dates" });
		
		new Setting(contentEl)
			.setName(t("modal.startDate") || "Start date")
			.addText(text => {
				text.setValue(this.formData.startDate || "")
					.setPlaceholder("YYYY-MM-DD")
					.onChange(val => this.formData.startDate = val || null);
			});

		new Setting(contentEl)
			.setName(t("modal.scheduledDate") || "Scheduled date")
			.addText(text => {
				text.setValue(this.formData.scheduledDate || "")
					.setPlaceholder("YYYY-MM-DD")
					.onChange(val => this.formData.scheduledDate = val || null);
			});

		new Setting(contentEl)
			.setName(t("modal.dueDate") || "Due date")
			.addText(text => {
				text.setValue(this.formData.dueDate || "")
					.setPlaceholder("YYYY-MM-DD")
					.onChange(val => this.formData.dueDate = val || null);
			});

		// Advanced Group
		contentEl.createEl("h3", { text: t("modal.advanced") || "Advanced" });

		new Setting(contentEl)
			.setName(t("modal.recurrence") || "Recurrence")
			.addText(text => {
				text.setValue(this.formData.recurrence || "")
					.setPlaceholder("every day / every week")
					.onChange(val => this.formData.recurrence = val || null);
			});

		new Setting(contentEl)
			.setName(t("modal.onCompletion") || "On completion")
			.addText(text => {
				text.setValue(this.formData.onCompletion || "")
					.setPlaceholder("delete / keep")
					.onChange(val => this.formData.onCompletion = val || null);
			});

		new Setting(contentEl)
			.setName(t("modal.taskId") || "Task ID")
			.addText(text => {
				text.setValue(this.formData.id || "")
					.onChange(val => this.formData.id = val || null);
			});

		new Setting(contentEl)
			.setName(t("modal.dependsOn") || "Depends on")
			.addText(text => {
				text.setValue(this.formData.dependsOn || "")
				.onChange(val => this.formData.dependsOn = val || null);
			});

		new Setting(contentEl)
			.setName(t("modal.assignee") || "Assignee")
			.addText(text => {
				text.setValue(this.formData.person.join(" & "))
					.setPlaceholder("John & Mary")
					.onChange(val => {
						this.formData.person = val.split("&").map(p => p.trim()).filter(Boolean);
					});
			});

		// Target File (Create Mode Only)
		if (this.mode === "create" && !this.initialData?.parentLineNumber) {
			const fileSetting = new Setting(contentEl)
				.setName(t("modal.file") || "File")
				.setDesc(this.targetPath);

			fileSetting.addButton(btn => {
				btn.setButtonText(t("modal.chooseFile") || "Choose file")
					.onClick(() => {
						new FileSuggestModal(this.app, file => {
							this.targetPath = file.path;
							fileSetting.setDesc(file.path);
						}).open();
					});
			});
		}

		// Submit / Cancel Buttons
		new Setting(contentEl)
			.addButton(btn => {
				btn.setButtonText(t("common.save") || "Save")
					.setCta()
					.onClick(() => {
						this.onSubmit(this.formData, this.targetPath);
						this.close();
					});
			})
			.addButton(btn => {
				btn.setButtonText(t("common.cancel") || "Cancel")
					.onClick(() => this.close());
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
