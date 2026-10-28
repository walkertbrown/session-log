// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { App, ctx, installDomHelpers, Modal, Notice } from './obsidian-shim';
import SessionLogPlugin from '../src/main';

beforeAll(() => installDomHelpers());

type Proc = (src: string, el: HTMLElement, c: ReturnType<typeof ctx>) => void;

const NOTE = '# Session 12\n\n```session-log\n```\n\n- 19:02 Arrived #place\n\n## Fight\n';
const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(note = NOTE) {
	const app = new App();
	app.notes.set('Game.md', { path: 'Game.md', content: note });
	const plugin = new SessionLogPlugin(app as never, { id: 'session-log' } as never);
	plugin.now = () => new Date(2026, 9, 28, 20, 14);
	await plugin.onload();
	const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks['session-log']!;
	const el = document.createElement('div');
	proc('', el, ctx('Game.md', { text: note, lineStart: 2, lineEnd: 3 }));
	const content = () => app.notes.get('Game.md')!.content;
	const type = async (text: string) => {
		const input = el.querySelector<HTMLInputElement>('.sl-input')!;
		input.value = text;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await flush();
	};
	const command = (id: string) => (plugin as never as { commands: { id: string; callback: () => void }[] }).commands.find((c) => c.id === id)!.callback();
	return { app, plugin, el, content, type, command };
}

describe('session-log block', () => {
	it('shows the session so far and tag counts, without editing the note', async () => {
		const { el, content } = await setup();
		expect(el.querySelector('.sl-meta')!.textContent).toBe('started 19:02 · 1 entry');
		const tags = Array.from(el.querySelectorAll('.sl-tag')).map((t) => t.textContent);
		expect(tags).toEqual(['#npc', '#loot', '#quest', '#clue', '#place1']);
		expect(content()).toBe(NOTE);
	});

	it('logs a line with the time on Enter', async () => {
		const { el, content, type } = await setup();
		await type('Met [[Old Wenna]], the miller\'s wife');
		expect(content()).toContain('- 19:02 Arrived #place\n- 20:14 Met [[Old Wenna]], the miller\'s wife\n');
		expect(el.querySelector<HTMLInputElement>('.sl-input')!.value).toBe('');
		expect(el.querySelector('.sl-meta')!.textContent).toBe('started 19:02 · 2 entries');
	});

	it('adds the chosen tags, then clears them', async () => {
		const { el, content, type } = await setup();
		el.querySelectorAll<HTMLElement>('.sl-tag')[1]!.click();
		expect(el.querySelector('.sl-tag.is-on')).not.toBeNull();
		await type('a silver key');
		expect(content()).toContain('- 20:14 a silver key #loot\n');
		expect(el.querySelector('.sl-tag.is-on')).toBeNull();
	});

	it('follows the clock settings', async () => {
		const { plugin, content, type } = await setup();
		plugin.settings.clock24 = false;
		await type('late');
		plugin.settings.addTime = false;
		await type('no time');
		expect(content()).toContain('- 8:14pm late\n- no time\n');
	});
});

describe('fights from Quick Initiative', () => {
	const fighters = (hp: number[]) => [
		{ name: 'Aria', hp: hp[0], player: true },
		{ name: 'Goblin 1', hp: hp[1], player: false },
		{ name: 'Goblin 2', hp: hp[2], player: false },
	];
	it('logs the fight into the note it happens in', async () => {
		const { app, content } = await setup();
		const fire = async (round: number, hp: number[]) => {
			app.workspace.trigger('quick-initiative:change', { sourcePath: 'Game.md', round, current: null, combatants: fighters(hp) });
			await flush();
		};
		await fire(1, [31, 7, 7]);
		await fire(1, [31, 0, 7]);
		await fire(0, [31, 0, 0]);
		expect(content()).toContain(
			'- 20:14 Fight started: Aria, Goblin ×2\n- 20:14 Goblin 1 is down (round 1)\n- 20:14 Fight over after 1 round. Down: Goblin ×2\n',
		);
	});
	it('logs a clicked Dice Tray roll, and not when rolls are off', async () => {
		const { app, plugin, content } = await setup();
		app.workspace.trigger('dice-tray:roll', { sourcePath: 'Game.md', expression: '1d20 + 5', text: '1d20 + 5 -> [17] + 5 -> 22' });
		await flush();
		expect(content()).toContain('- 19:02 Arrived #place\n- 20:14 Rolled 1d20 + 5 -> [17] + 5 -> 22\n');
		plugin.settings.logRolls = false;
		app.workspace.trigger('dice-tray:roll', { sourcePath: 'Game.md', expression: 'd6', text: 'd6 -> [4] -> 4' });
		await flush();
		expect(content()).not.toContain('d6 -> [4]');
	});
	it('sends fights in other notes to the last session log', async () => {
		const { app, content } = await setup();
		app.notes.set('Mill.md', { path: 'Mill.md', content: '```initiative\n```' });
		app.workspace.trigger('quick-initiative:change', { sourcePath: 'Mill.md', round: 1, current: null, combatants: fighters([1, 1, 1]) });
		await flush();
		expect(content()).toContain('- 20:14 Fight started');
		expect(app.notes.get('Mill.md')!.content).toBe('```initiative\n```');
	});
	it('stays quiet when fight logging is off', async () => {
		const { app, plugin, content } = await setup();
		plugin.settings.logFights = false;
		app.workspace.trigger('quick-initiative:change', { sourcePath: 'Game.md', round: 1, current: null, combatants: fighters([1, 1, 1]) });
		await flush();
		expect(content()).toBe(NOTE);
	});
});

describe('commands', () => {
	it('makes the next session note, linked to the last one', async () => {
		const { app, command } = await setup();
		app.notes.set('Sessions/Session 11.md', { path: 'Sessions/Session 11.md', content: '' });
		command('new-session');
		await flush();
		const made = app.notes.get('Sessions/Session 12.md')!.content;
		expect(made).toContain('# Session 12\n\nPreviously: [[Session 11]]');
		expect(made).toContain('```session-log\n```');
		expect(app.active).toBe('Sessions/Session 12.md');
	});
	it('adds an entry from the command to the open note', async () => {
		const { app, command, content } = await setup();
		app.active = 'Game.md';
		command('add-entry');
		await flush();
		const modal = Modal.last!;
		const input = modal.contentEl.querySelector<HTMLInputElement>('.sl-input')!;
		input.value = 'rolled a 1 on the rope';
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await flush();
		expect(content()).toContain('- 20:14 rolled a 1 on the rope\n');
		expect(modal.contentEl.children.length).toBe(0); // closed
	});
	it('says so when there is no log to write to', async () => {
		const app = new App();
		const plugin = new SessionLogPlugin(app as never, { id: 'session-log' } as never);
		await plugin.onload();
		(plugin as never as { commands: { id: string; callback: () => void }[] }).commands.find((c) => c.id === 'add-entry')!.callback();
		await flush();
		expect(Notice.last).toContain('No session log open');
	});
});
