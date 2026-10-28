import {
	App,
	Editor,
	EventRef,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	SettingDefinitionItem,
	TFile,
	setIcon,
} from 'obsidian';
import {
	appendEntry,
	entries,
	FightState,
	fightLines,
	formatEntry,
	hasBlock,
	nextSessionNumber,
	parseTags,
	sessionNote,
	stamp,
	tagCounts,
} from './log';

interface Settings {
	tags: string; // quick tags shown under the input, comma separated
	clock24: boolean; // 20:14 rather than 8:14pm
	addTime: boolean; // put the time in front of each entry
	logFights: boolean; // write Quick Initiative fights into the log
	logRolls: boolean; // write Dice Tray rolls someone clicked into the log
	folder: string; // where "New session note" puts notes
}

const DEFAULT_SETTINGS: Settings = {
	tags: 'npc, loot, quest, clue, place',
	clock24: true,
	addTime: true,
	logFights: true,
	logRolls: true,
	folder: 'Sessions',
};

const BLOCK = '```session-log\n```\n';

// Dice Tray's event; only the fields read here.
interface RollEvent {
	sourcePath: string;
	text: string;
}

// Quick Initiative's event; only the fields read here.
interface FightEvent extends FightState {
	sourcePath: string;
}

export default class SessionLogPlugin extends Plugin {
	settings: Settings = DEFAULT_SETTINGS;
	now: () => Date = () => new Date();
	// the last note a log was drawn in or written to; fights in other notes go there
	lastPath: string | null = null;
	private fights = new Map<string, FightState>();

	async onload() {
		await this.loadSettings();
		this.registerMarkdownCodeBlockProcessor('session-log', (_source, el, ctx) => {
			this.lastPath = ctx.sourcePath;
			const note = ctx.getSectionInfo(el)?.text ?? '';
			new LogBar(this, el, ctx.sourcePath, note).draw();
		});
		this.addCommand({
			id: 'add-entry',
			name: 'Add log entry',
			callback: () => void this.openEntryModal(),
		});
		this.addCommand({
			id: 'insert-block',
			name: 'Insert log block',
			editorCallback: (editor: Editor) => editor.replaceSelection(BLOCK),
		});
		this.addCommand({
			id: 'new-session',
			name: 'New session note',
			callback: () => void this.newSession(),
		});
		// a custom event, so it is not in Obsidian's typed list
		const ws = this.app.workspace as unknown as { on(name: string, cb: (e: FightEvent) => void): EventRef };
		this.registerEvent(ws.on('quick-initiative:change', (e) => void this.onFight(e)));
		const dice = this.app.workspace as unknown as { on(name: string, cb: (e: RollEvent) => void): EventRef };
		this.registerEvent(dice.on('dice-tray:roll', (e) => void this.onRoll(e)));
		this.addSettingTab(new SettingTab(this.app, this));
	}

	tagList(): string[] {
		return parseTags(this.settings.tags);
	}

	// Appends one entry to the log in a note. Returns false when the note has no session log.
	async log(path: string, text: string, tags: string[] = []): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || !text.trim()) return false;
		const time = this.settings.addTime ? stamp(this.now(), this.settings.clock24) : undefined;
		const entry = formatEntry(text, tags, time);
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const out = appendEntry(data, entry);
			if (out === null) return data;
			ok = true;
			return out;
		});
		if (ok) this.lastPath = path;
		return ok;
	}

	private async notePath(path: string | null | undefined): Promise<string | null> {
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		return hasBlock(await this.app.vault.cachedRead(file)) ? path : null;
	}

	// The open note if it has a log, otherwise the last one used.
	async target(): Promise<string | null> {
		return (await this.notePath(this.app.workspace.getActiveFile()?.path)) ?? (await this.notePath(this.lastPath));
	}

	async openEntryModal() {
		const path = await this.target();
		if (!path) {
			new Notice('No session log open. Make a session note or insert a session log first.');
			return;
		}
		new EntryModal(this, path).open();
	}

	async onFight(e: FightEvent) {
		const prev = this.fights.get(e.sourcePath);
		this.fights.set(e.sourcePath, { round: e.round, combatants: e.combatants.map((c) => ({ ...c })) });
		if (!this.settings.logFights) return;
		const lines = fightLines(prev, e);
		if (!lines.length) return;
		const path = (await this.notePath(e.sourcePath)) ?? (await this.notePath(this.lastPath));
		if (!path) return;
		for (const l of lines) await this.log(path, l);
	}

	// Dice Tray: a roll someone clicked, in the note it was made in, else the last log used
	async onRoll(e: RollEvent) {
		if (!this.settings.logRolls || !e.text) return;
		const path = (await this.notePath(e.sourcePath)) ?? (await this.notePath(this.lastPath));
		if (path) await this.log(path, `Rolled ${e.text}`);
	}

	async newSession(): Promise<TFile | null> {
		const folder = this.settings.folder.replace(/^\/+|\/+$/g, '');
		const inFolder = this.app.vault
			.getMarkdownFiles()
			.filter((f) => (folder ? f.path.startsWith(folder + '/') : !f.path.includes('/')));
		const n = nextSessionNumber(inFolder.map((f) => f.basename));
		const prev = inFolder
			.filter((f) => new RegExp(`\\bsession\\s*${n - 1}\\b`, 'i').test(f.basename))
			.map((f) => f.basename)[0];
		const d = this.now();
		const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		const path = `${folder ? folder + '/' : ''}Session ${n}.md`;
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`${path} already exists.`);
			return null;
		}
		const file = await this.app.vault.create(path, sessionNote(n, date, prev));
		this.lastPath = file.path;
		await this.app.workspace.getLeaf(false).openFile(file);
		return file;
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<Settings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// The input with quick tags, used by the block and by the command's modal.
class EntryForm {
	private on = new Set<string>();
	input!: HTMLInputElement;

	constructor(
		private plugin: SessionLogPlugin,
		private el: HTMLElement,
		private path: string,
		private counts: Record<string, number>,
		private done: () => void,
	) {}

	draw() {
		const row = this.el.createDiv({ cls: 'sl-form' });
		this.input = row.createEl('input', {
			cls: 'sl-input',
			type: 'text',
			placeholder: 'What just happened? [[links]] and #tags work',
		});
		const add = row.createEl('button', { cls: 'sl-add', text: 'Log' });
		this.input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter' && !ev.isComposing) {
				ev.preventDefault();
				void this.submit();
			}
		});
		add.addEventListener('click', () => void this.submit());

		const tags = this.plugin.tagList();
		if (!tags.length) return;
		const bar = this.el.createDiv({ cls: 'sl-tags' });
		for (const t of tags) {
			const chip = bar.createEl('button', { cls: 'sl-tag' });
			chip.createSpan({ cls: 'sl-tag-name', text: '#' + t });
			const n = this.counts[t] ?? 0;
			if (n) chip.createSpan({ cls: 'sl-tag-count', text: String(n) });
			chip.setAttr('aria-pressed', 'false');
			chip.addEventListener('click', () => {
				if (this.on.has(t)) this.on.delete(t);
				else this.on.add(t);
				chip.toggleClass('is-on', this.on.has(t));
				chip.setAttr('aria-pressed', String(this.on.has(t)));
				this.input.focus();
			});
		}
	}

	async submit() {
		const text = this.input.value;
		if (!text.trim()) return;
		const ok = await this.plugin.log(this.path, text, [...this.on]);
		if (!ok) {
			new Notice('Could not find the session log in this note.');
			return;
		}
		this.input.value = '';
		this.on.clear();
		this.el.querySelectorAll('.sl-tag.is-on').forEach((c) => {
			c.removeClass('is-on');
			c.setAttr('aria-pressed', 'false');
		});
		this.done();
	}
}

// One rendered `session-log` block: a header with the session so far, and the form.
class LogBar {
	constructor(
		private plugin: SessionLogPlugin,
		private el: HTMLElement,
		private path: string,
		private note: string,
	) {}

	draw() {
		const list = entries(this.note);
		this.el.empty();
		const box = this.el.createDiv({ cls: 'sl' });
		const head = box.createDiv({ cls: 'sl-head' });
		const title = head.createDiv({ cls: 'sl-title' });
		setIcon(title.createSpan({ cls: 'sl-icon' }), 'scroll-text');
		title.createSpan({ text: 'Session log' });
		const meta = head.createDiv({ cls: 'sl-meta' });
		let count = list.length;
		const first = list.find((e) => e.time)?.time;
		const showMeta = () => {
			const n = count === 1 ? '1 entry' : `${count} entries`;
			meta.setText(first ? `started ${first} · ${n}` : n);
		};
		showMeta();
		new EntryForm(this.plugin, box, this.path, tagCounts(list, this.plugin.tagList()), () => {
			count++;
			showMeta();
		}).draw();
	}
}

class EntryModal extends Modal {
	constructor(private plugin: SessionLogPlugin, private path: string) {
		super(plugin.app);
	}
	onOpen() {
		this.setTitle('Add log entry');
		this.contentEl.addClass('sl', 'sl-modal');
		const form = new EntryForm(this.plugin, this.contentEl, this.path, {}, () => this.close());
		form.draw();
		form.input.focus();
	}
	onClose() {
		this.contentEl.empty();
	}
}

class SettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SessionLogPlugin) {
		super(app, plugin);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Quick tags',
				desc: 'Tags shown under the input, separated by commas.',
				control: { type: 'text', key: 'tags', defaultValue: DEFAULT_SETTINGS.tags },
			},
			{
				name: 'Add the time',
				desc: 'Start each entry with the time it was logged.',
				control: { type: 'toggle', key: 'addTime', defaultValue: true },
			},
			{
				name: '24-hour clock',
				desc: 'Write 20:14 rather than 8:14pm.',
				control: { type: 'toggle', key: 'clock24', defaultValue: true },
			},
			{
				name: 'Log fights',
				desc: 'When Quick Initiative is installed, note when a fight starts, who goes down, and when it ends.',
				control: { type: 'toggle', key: 'logFights', defaultValue: true },
			},
			{
				name: 'Log rolls',
				desc: 'When Dice Tray is installed, note each roll you click, with the dice it showed.',
				control: { type: 'toggle', key: 'logRolls', defaultValue: true },
			},
			{
				name: 'Session folder',
				desc: 'Where the "New session note" command puts notes.',
				control: { type: 'folder', key: 'folder', defaultValue: DEFAULT_SETTINGS.folder },
			},
		];
	}
	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof Settings];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}
}
