// Browser demo: runs the real Session Log and Quick Initiative plugins against the test shim,
// over a sample session note, and shows the note's text changing as they are used.
import { App, installDomHelpers } from '../test/obsidian-shim';
import SessionLogPlugin from '../src/main';
import { entries } from '../src/log';
import QuickInitiativePlugin from '../../quick-initiative/src/main';
import DiceTrayPlugin from '../../dice-tray/src/main';

installDomHelpers();

// Lucide icons (ISC license), the set Obsidian itself uses.
const ICONS: Record<string, string> = {
	'scroll-text': '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	'chevron-left': '<path d="m15 18-6-6 6-6"/>',
	'chevron-right': '<path d="m9 18 6-6-6-6"/>',
	square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
	shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
	heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
	sword: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/>',
	dices: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
};
(globalThis as unknown as { __iconHook: (el: HTMLElement, name: string) => void }).__iconHook = (el, name) => {
	const body = ICONS[name];
	if (!body) return;
	el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
};

const START = `# Session 12: the mill

Previously: [[Session 11]]

## Log

\`\`\`session-log
\`\`\`

- 19:02 Reached Millbrook at dusk #place
- 19:10 Met [[Old Wenna]], the miller's wife #npc
- 19:24 Her son went up to the mill and never came back #quest

## Fight

The bugbear swings \`dice: 1d20 + 4\` for \`dice: 2d8 + 2\`.

\`\`\`initiative
Aria player init 17 hp 31 ac 16
Borin player init 9 hp 44 ac 18
3x [[Goblin]]
[[Bugbear]]
\`\`\``;

type Ctx = { sourcePath: string; addChild: () => void; getSectionInfo: () => { text: string; lineStart: number; lineEnd: number } };
type Proc = (src: string, el: HTMLElement, c: Ctx) => void;

async function main() {
	const app = new App();
	app.notes.set('Game.md', { path: 'Game.md', content: START });
	app.notes.set('Goblin', { path: 'Goblin.md', content: '', frontmatter: { statblock: true, hp: 7, ac: 15, hit_dice: '2d6', stats: [8, 14, 10, 10, 8, 8] } });
	app.notes.set('Bugbear', { path: 'Bugbear.md', content: '', frontmatter: { statblock: true, hp: 27, ac: 16, hit_dice: '5d8 + 5', stats: [15, 14, 13, 8, 11, 9] } });
	app.active = 'Game.md';

	const log = new SessionLogPlugin(app as never, { id: 'session-log' } as never);
	await log.onload();
	// a game-night clock: each entry is a few minutes after the last
	let minutes = 19 * 60 + 31;
	log.now = () => {
		const d = new Date(2026, 9, 28, Math.floor(minutes / 60), minutes % 60);
		minutes += 2;
		return d;
	};
	const qi = new QuickInitiativePlugin(app as never, { id: 'quick-initiative' } as never);
	await qi.onload();
	const dice = new DiceTrayPlugin(app as never, { id: 'dice-tray' } as never);
	await dice.onload();
	dice.settings.animate = false;
	const diceProcs = (dice as never as { postProcessors: ((e: HTMLElement, c: Ctx) => void)[] }).postProcessors;
	const logProc = (log as never as { codeBlocks: Record<string, Proc> }).codeBlocks['session-log']!;
	const qiProc = (qi as never as { codeBlocks: Record<string, Proc> }).codeBlocks.initiative!;

	const note = () => app.notes.get('Game.md')!.content;
	// where a block sits in the note right now, the way Obsidian reports it
	const ctx = (lang: string): Ctx => ({
		sourcePath: 'Game.md',
		addChild: () => {},
		getSectionInfo: () => {
			const lines = note().split('\n');
			const lineStart = lines.findIndex((l) => l.startsWith('```' + lang));
			const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
			return { text: note(), lineStart, lineEnd };
		},
	});

	const source = document.querySelector<HTMLElement>('#source');
	const bar = document.querySelector<HTMLElement>('#log');
	const list = document.querySelector<HTMLElement>('#entries');
	const tracker = document.querySelector<HTMLElement>('#tracker');
	const rolls = document.querySelector<HTMLElement>('#rolls');
	const rollsHtml = rolls?.innerHTML ?? '';

	// the entries as reading view shows them: links and tags styled
	const drawList = () => {
		if (!list) return;
		list.replaceChildren();
		for (const e of entries(note())) {
			const li = document.createElement('li');
			if (e.time) li.createSpan({ cls: 'time', text: e.time + ' ' });
			for (const part of e.text.split(/(\[\[[^\]]+\]\]|#[\w-]+)/)) {
				if (!part) continue;
				if (part.startsWith('[[')) li.createSpan({ cls: 'link', text: part.slice(2, -2).split('|').pop()! });
				else if (part.startsWith('#')) li.createSpan({ cls: 'tag', text: part });
				else li.appendChild(document.createTextNode(part));
			}
			list.appendChild(li);
		}
	};
	const drawBar = () => {
		if (!bar) return;
		const typing = bar.contains(document.activeElement);
		logProc('', bar, ctx('session-log'));
		if (typing) bar.querySelector<HTMLInputElement>('.sl-input')?.focus();
	};
	const showSource = () => {
		if (source) source.textContent = note();
	};
	const flash = () => {
		if (!source) return;
		source.classList.remove('flash');
		void source.offsetWidth;
		source.classList.add('flash');
	};

	const process = app.vault.process;
	app.vault.process = async (f, fn) => {
		const before = note();
		const out = await process(f, fn);
		showSource();
		flash();
		// the log changed: reading view redraws the list and the bar's counts
		if (entries(before).length !== entries(out).length) {
			drawList();
			drawBar();
		}
		return out;
	};

	const render = () => {
		drawBar();
		drawList();
		if (rolls) {
			rolls.innerHTML = rollsHtml;
			for (const pp of diceProcs) pp(rolls, { sourcePath: 'Game.md', addChild: () => {}, getSectionInfo: () => null } as never);
		}
		if (tracker) {
			const info = ctx('initiative').getSectionInfo();
			qiProc(note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n'), tracker, ctx('initiative'));
		}
		showSource();
	};
	render();

	document.querySelector('#reset')?.addEventListener('click', () => {
		app.notes.get('Game.md')!.content = START;
		minutes = 19 * 60 + 31;
		render();
	});
	const opened = document.querySelector<HTMLElement>('#opened');
	app.workspace.openLinkText = async (link: string) => {
		if (opened) opened.textContent = `In Obsidian this opens the "${link}" note.`;
	};
}

void main();
