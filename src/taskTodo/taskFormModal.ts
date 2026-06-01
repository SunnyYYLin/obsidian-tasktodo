import { App, Modal, Setting, SuggestModal, type TextComponent } from "obsidian";
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

class TargetFileSuggestModal extends SuggestModal<string> {
	constructor(
		app: App,
		private readonly values: string[],
		private readonly initialQuery: string,
		private readonly onChoose: (value: string) => void,
	) {
		super(app);
		this.setPlaceholder(t("modal.filePlaceholder"));
		this.inputEl.value = initialQuery;
	}

	getSuggestions(query: string): string[] {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return this.values;

		const filtered = this.values.filter((value) => value.toLowerCase().includes(normalized));
		const queryTrimmed = query.trim();
		const exists = this.values.some((v) => v.toLowerCase() === queryTrimmed.toLowerCase());
		if (!exists && queryTrimmed) {
			return [`CREATE_NEW_FILE:${queryTrimmed}`, ...filtered];
		}
		return filtered;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		if (value.startsWith("CREATE_NEW_FILE:")) {
			const path = value.slice("CREATE_NEW_FILE:".length);
			el.addClass("taskslite-suggest-item");
			el.createSpan({ text: "+ ", cls: "taskslite-suggest-new-icon" });
			el.createSpan({ text: t("modal.createFile").replace("{path}", path) });
		} else {
			el.setText(value);
		}
	}

	onChooseSuggestion(value: string): void {
		if (value.startsWith("CREATE_NEW_FILE:")) {
			const path = value.slice("CREATE_NEW_FILE:".length);
			this.onChoose(path);
		} else {
			this.onChoose(value);
		}
	}
}

export class TaskFormModal extends Modal {
	private readonly formData: TaskFormData;
	private targetFileValue: string;
	private resolved = false;

	constructor(
		app: App,
		private readonly host: TaskTodoHost,
		private readonly titleText: string,
		private readonly mode: "create" | "edit",
		private readonly onSubmit: (data: TaskFormData, targetPath?: string) => void,
		private readonly initialData?: {
			task?: TaskTodoTaskLine;
			path?: string;
			parentLineNumber?: number;
		}
	) {
		super(app);
		
		const task = initialData?.task;
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

		this.targetFileValue = initialData?.path?.replace(/\.md$/iu, "") || "Tasks";
	}

	onOpen(): void {
		this.setTitle(this.titleText);
		this.contentEl.empty();
		this.contentEl.addClass("taskslite-modal");

		// 1. Description
		new Setting(this.contentEl).setName(t("modal.name")).addText((text) => {
			text.setValue(this.formData.description).setPlaceholder(t("modal.taskNamePlaceholder")).onChange((value) => {
				this.formData.description = value;
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		// 2. Target File (Create Mode Only)
		if (this.mode === "create" && !this.initialData?.parentLineNumber) {
			this.addTargetFileSetting(this.contentEl);
		}

		// 3. Status (Edit Mode Only)
		if (this.mode === "edit") {
			this.addStatusSetting(this.contentEl);
		}

		// 4. Priority
		this.addPrioritySetting(this.contentEl);

		// 5. Date inputs using compact date styles and icon titles
		this.addDateSetting(`${TASK_SYMBOLS.start} ${t("modal.startDate")}`, "startDate");
		this.addDateSetting(`${TASK_SYMBOLS.scheduled} ${t("modal.scheduledDate")}`, "scheduledDate");
		this.addDateSetting(`${TASK_SYMBOLS.due} ${t("modal.dueDate")}`, "dueDate");

		// 6. Recurrence & OnCompletion dropdowns
		this.addRecurrenceSetting(this.contentEl);
		this.addOnCompletionSetting(this.contentEl);

		// 7. Advanced text inputs
		this.addTextSetting(this.contentEl, `${TASK_SYMBOLS.id} ${t("modal.taskId")}`, "id", "id");
		this.addTextSetting(this.contentEl, `${TASK_SYMBOLS.dependsOn} ${t("modal.dependsOn")}`, "id1, id2", "dependsOn");

		// 8. Assignee
		this.addTextSetting(this.contentEl, `${TASK_SYMBOLS.person} ${t("modal.assignee")}`, "John & Mary", "person", true);

		// 9. Save and Cancel Buttons
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(t("common.cancel")).onClick(() => {
					this.finish(null);
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(t("common.save"))
					.setCta()
					.onClick(() => {
						this.finish(this.formData);
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}

	private addTargetFileSetting(container: HTMLElement): void {
		const values = targetFileOptions(this.app, "");
		let input: TextComponent | null = null;
		new Setting(container).setName(t("modal.file")).addText((text) => {
			input = text;
			text.inputEl.readOnly = true;
			text.inputEl.addClass("taskslite-file-input");
			text.inputEl.setAttr("autocomplete", "off");
			text.inputEl.setAttr("autocorrect", "off");
			text.inputEl.setAttr("autocapitalize", "none");
			text.inputEl.setAttr("spellcheck", "false");
			text.setValue(this.targetFileValue);
			text.inputEl.addEventListener("click", () => {
				new TargetFileSuggestModal(this.app, values, input?.getValue() ?? "", (value) => {
					this.targetFileValue = value;
					input?.setValue(value);
				}).open();
			});
		}).addExtraButton((button) => {
			button
				.setIcon("folder-open")
				.setTooltip(t("modal.chooseFile"))
				.onClick(() => {
					new TargetFileSuggestModal(this.app, values, input?.getValue() ?? "", (value) => {
						this.targetFileValue = value;
						input?.setValue(value);
					}).open();
				});
		});
	}

	private addStatusSetting(container: HTMLElement): void {
		const statusSettings = this.host.settings.statusSettings as {
			coreStatuses?: Array<{ symbol: string; name: string }>;
			customStatuses?: Array<{ symbol: string; name: string }>;
		} | undefined;
		const statuses: Array<{ symbol: string; name: string }> = [
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

		new Setting(container)
			.setName(t("modal.status"))
			.setClass("taskslite-modal-setting-compact")
			.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("taskslite-modal-compact-control");
				for (const status of statuses) {
					dropdown.addOption(status.symbol, `[${status.symbol}] ${status.name}`);
				}
				dropdown.setValue(this.formData.statusSymbol).onChange((value) => {
					this.formData.statusSymbol = value;
				});
			});
	}

	private addPrioritySetting(container: HTMLElement): void {
		new Setting(container).setName(t("modal.priority")).setClass("taskslite-modal-setting-compact").addDropdown((dropdown) => {
			dropdown.selectEl.addClass("taskslite-modal-compact-control");
			dropdown.addOption("", t("common.none"));
			dropdown.addOption(TASK_SYMBOLS.priority.highest, `${TASK_SYMBOLS.priority.highest} ${t("priority.highest")}`);
			dropdown.addOption(TASK_SYMBOLS.priority.high, `${TASK_SYMBOLS.priority.high} ${t("priority.high")}`);
			dropdown.addOption(TASK_SYMBOLS.priority.medium, `${TASK_SYMBOLS.priority.medium} ${t("priority.medium")}`);
			dropdown.addOption(TASK_SYMBOLS.priority.low, `${TASK_SYMBOLS.priority.low} ${t("priority.low")}`);
			dropdown.addOption(TASK_SYMBOLS.priority.lowest, `${TASK_SYMBOLS.priority.lowest} ${t("priority.lowest")}`);
			dropdown.setValue(this.formData.priority || "").onChange((value) => {
				this.formData.priority = value || null;
			});
		});
	}

	private addDateSetting(name: string, key: "startDate" | "scheduledDate" | "dueDate"): void {
		new Setting(this.contentEl).setName(name).setClass("taskslite-modal-setting-compact").addText((text) => {
			text.inputEl.type = "date";
			text.inputEl.addClass("taskslite-modal-date-input", "taskslite-modal-compact-control");
			text.setValue(this.formData[key] || "").onChange((value) => {
				this.formData[key] = value || null;
			});
		});
	}

	private addRecurrenceSetting(container: HTMLElement): void {
		new Setting(container).setName(`${TASK_SYMBOLS.recurrence} ${t("modal.recurrence")}`).setClass("taskslite-modal-setting-compact").addDropdown((dropdown) => {
			dropdown.selectEl.addClass("taskslite-modal-compact-control");
			const values = [
				"",
				"every day",
				"every week",
				"every month",
				"every year",
				"every day when done",
				"every week when done",
				"every month when done",
				"every year when done",
			];
			for (const value of values) {
				dropdown.addOption(value, value || t("common.none"));
			}
			dropdown.setValue(this.formData.recurrence || "").onChange((value) => {
				this.formData.recurrence = value || null;
			});
		});
	}

	private addOnCompletionSetting(container: HTMLElement): void {
		new Setting(container).setName(`${TASK_SYMBOLS.onCompletion} ${t("modal.onCompletion")}`).setClass("taskslite-modal-setting-compact").addDropdown((dropdown) => {
			dropdown.selectEl.addClass("taskslite-modal-compact-control");
			const values = ["", "delete", "keep", "complete"];
			for (const value of values) {
				dropdown.addOption(value, value || t("common.none"));
			}
			dropdown.setValue(this.formData.onCompletion || "").onChange((value) => {
				this.formData.onCompletion = value || null;
			});
		});
	}

	private addTextSetting(
		container: HTMLElement,
		name: string,
		placeholder: string,
		key: "id" | "dependsOn" | "person",
		isPerson = false
	): void {
		new Setting(container).setName(name).addText((text) => {
			if (isPerson) {
				text.setValue(this.formData.person.join(" & "));
			} else {
				text.setValue((this.formData[key] as string) || "");
			}
			text.setPlaceholder(placeholder).onChange((value) => {
				if (isPerson) {
					this.formData.person = value.split("&").map(p => p.trim()).filter(Boolean);
				} else {
					(this.formData[key] as string | null) = value || null;
				}
			});
		});
	}

	private finish(data: TaskFormData | null): void {
		if (this.resolved) return;
		this.resolved = true;
		if (data) {
			const targetPath = targetFilePath("", this.targetFileValue);
			this.onSubmit(data, targetPath);
		}
		this.close();
	}
}

function targetFileOptions(app: App, basePath: string): string[] {
	const prefix = normalizeFolderPath(basePath);
	const files = app.vault.getMarkdownFiles().map((file) => file.path);
	if (!prefix) {
		return files.map((path) => path.replace(/\.md$/iu, "")).sort((left, right) => left.localeCompare(right));
	}
	return files
		.filter((path) => path.startsWith(`${prefix}/`))
		.map((path) => path.slice(prefix.length + 1).replace(/\.md$/iu, ""))
		.sort((left, right) => left.localeCompare(right));
}

function targetFilePath(basePath: string, value: string): string {
	const prefix = normalizeFolderPath(basePath);
	const trimmed = value.trim() || "Tasks";
	const withoutLeadingSlash = trimmed.replace(/^\/+/u, "");
	const withExtension = withoutLeadingSlash.toLowerCase().endsWith(".md") ? withoutLeadingSlash : `${withoutLeadingSlash}.md`;
	if (!prefix) {
		return withExtension;
	}
	return `${prefix}/${withExtension}`.replace(/\/+/gu, "/");
}

function normalizeFolderPath(value: string): string {
	return value.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
}
