import { describe, expect, it } from 'vitest';
import {
	appendEntry,
	entries,
	fightLines,
	formatEntry,
	groupNames,
	nextSessionNumber,
	parseTags,
	sessionNote,
	stamp,
	tagCounts,
} from '../src/log';

const NOTE = '# Session 12\n\n```session-log\n```\n\n## Notes\nThe mill.';

describe('appendEntry', () => {
	it('starts the log under the block', () => {
		expect(appendEntry(NOTE, '19:02 Arrived at the mill')).toBe(
			'# Session 12\n\n```session-log\n```\n\n- 19:02 Arrived at the mill\n\n## Notes\nThe mill.',
		);
	});
	it('adds to the end of the list', () => {
		const one = appendEntry(NOTE, '19:02 a')!;
		const two = appendEntry(one, '19:05 b')!;
		expect(two).toContain('```\n\n- 19:02 a\n- 19:05 b\n\n## Notes');
	});
	it('stops at the first line that is not an entry', () => {
		const note = '```session-log\n```\n- 19:02 a\nSome text\n- an unrelated list';
		expect(appendEntry(note, 'b')).toBe('```session-log\n```\n- 19:02 a\n- b\nSome text\n- an unrelated list');
	});
	it('keeps callout markers', () => {
		const note = '> [!note] Log\n> ```session-log\n> ```\n\nAfter';
		expect(appendEntry(note, 'x')).toBe('> [!note] Log\n> ```session-log\n> ```\n>\n> - x\n\nAfter');
		expect(appendEntry(appendEntry(note, 'x')!, 'y')).toContain('> - x\n> - y\n');
	});
	it('returns null when there is no log', () => {
		expect(appendEntry('# Nothing here', 'x')).toBeNull();
		expect(appendEntry('```session-log\nnever closed', 'x')).toBeNull();
	});
});

describe('entries', () => {
	it('reads times and text', () => {
		const note = '```session-log\n```\n\n- 19:02 Met [[Wenna]] #npc\n* 8:14pm Found a key #loot\n- no time';
		expect(entries(note)).toEqual([
			{ time: '19:02', text: 'Met [[Wenna]] #npc' },
			{ time: '8:14pm', text: 'Found a key #loot' },
			{ text: 'no time' },
		]);
		expect(entries('nothing')).toEqual([]);
	});
	it('counts tags', () => {
		const list = entries('```session-log\n```\n- 19:02 Met [[Wenna]] #npc\n- 19:30 #NPC again\n- #npcs not this');
		expect(tagCounts(list, ['npc', 'loot'])).toEqual({ npc: 2, loot: 0 });
	});
});

describe('formatting', () => {
	it('writes the time and adds tags once', () => {
		expect(formatEntry('  found   the key ', ['loot', '#clue'], '20:14')).toBe('20:14 found the key #loot #clue');
		expect(formatEntry('found the key #loot', ['loot'])).toBe('found the key #loot');
	});
	it('stamps the clock', () => {
		const d = new Date(2026, 9, 28, 20, 4);
		expect(stamp(d)).toBe('20:04');
		expect(stamp(d, false)).toBe('8:04pm');
		expect(stamp(new Date(2026, 9, 28, 0, 30), false)).toBe('12:30am');
	});
	it('parses the tag setting', () => {
		expect(parseTags('npc, #loot,,quest  clue')).toEqual(['npc', 'loot', 'quest', 'clue']);
	});
});

describe('fights', () => {
	const fighters = (hp: number[]) => [
		{ name: 'Aria', hp: hp[0], player: true },
		{ name: 'Goblin 1', hp: hp[1], player: false },
		{ name: 'Goblin 2', hp: hp[2], player: false },
		{ name: 'Bugbear', hp: hp[3], player: false },
	];
	it('groups numbered names', () => {
		expect(groupNames(['Aria', 'Goblin 1', 'Goblin 2', 'Bugbear', 'Goblin 3'])).toBe('Aria, Goblin ×3, Bugbear');
	});
	it('logs the start, someone going down, and the end', () => {
		const before = { round: 0, combatants: fighters([31, 7, 7, 27]) };
		const r1 = { round: 1, combatants: fighters([31, 7, 7, 27]) };
		expect(fightLines(undefined, r1)).toEqual(['Fight started: Aria, Goblin ×2, Bugbear']);
		expect(fightLines(before, r1)).toEqual(['Fight started: Aria, Goblin ×2, Bugbear']);
		const hit = { round: 2, combatants: fighters([31, 0, 7, 27]) };
		expect(fightLines(r1, hit)).toEqual(['Round 2', 'Goblin 1 is down (round 2)']);
		expect(fightLines(r1, hit, false)).toEqual(['Goblin 1 is down (round 2)']);
		expect(fightLines(hit, hit)).toEqual([]);
		const end = { round: 0, combatants: fighters([31, 0, 0, 27]) };
		expect(fightLines({ ...hit, combatants: end.combatants }, end)).toEqual(['Fight over after 2 rounds. Down: Goblin ×2']);
	});
	it('logs the middle of the fight: hits, heals, getting back up, conditions', () => {
		const at = (hp: number[], cond: string[][] = []) => ({
			round: 2,
			combatants: fighters(hp).map((c, i) => ({ ...c, maxHp: i === 3 ? 27 : undefined, conditions: cond[i] ?? [] })),
		});
		expect(fightLines(at([31, 7, 7, 27]), at([31, 7, 7, 18]))).toEqual(['Bugbear takes 9 (18/27)']);
		expect(fightLines(at([31, 7, 7, 18]), at([31, 7, 7, 20]))).toEqual(['Bugbear heals 2 (20/27)']);
		expect(fightLines(at([31, 7, 3, 27]), at([24, 7, 3, 27]))).toEqual(['Aria takes 7 (24 left)']);
		expect(fightLines(at([0, 7, 7, 27]), at([5, 7, 7, 27]))).toEqual(['Aria is back up (5 left)']);
		expect(fightLines(at([31, 7, 7, 27]), at([31, 7, 7, 27], [['Poisoned', 'Prone']]))).toEqual(['Aria is Poisoned and Prone']);
		expect(fightLines(at([31, 7, 7, 27], [['poisoned', 'prone']]), at([31, 7, 7, 27], [['prone']]))).toEqual(['Aria is no longer poisoned']);
		expect(fightLines(at([31, 7, 7, 27]), at([31, 7, 7, 18], [[], [], [], ['frightened']]), false)).toEqual([]);
		// an older Quick Initiative sends no conditions: nothing to compare, nothing logged
		expect(fightLines({ round: 2, combatants: fighters([31, 7, 7, 27]) }, at([31, 7, 7, 27], [['prone']]))).toEqual([]);
	});
	it('does not call a fight started on a later round or with no history', () => {
		expect(fightLines(undefined, { round: 3, combatants: fighters([31, 0, 7, 27]) })).toEqual([]);
		expect(fightLines(undefined, { round: 0, combatants: [] })).toEqual([]);
	});
});

describe('session notes', () => {
	it('numbers the next session', () => {
		expect(nextSessionNumber(['Session 3', 'session 11 - the mill', 'Map'])).toBe(12);
		expect(nextSessionNumber([])).toBe(1);
	});
	it('links the previous session', () => {
		const n = sessionNote(12, '2026-10-28', 'Session 11');
		expect(n).toContain('session: 12\ndate: 2026-10-28');
		expect(n).toContain('Previously: [[Session 11]]');
		expect(appendEntry(n, 'x')).not.toBeNull();
	});
});
