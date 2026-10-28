// The session log as text: a `session-log` code block followed by a list of entries.
// Pure functions, so the note format can be tested without Obsidian.

export interface Entry {
	time?: string;
	text: string;
}

interface Block {
	open: number; // line of the opening fence
	close: number; // line of the closing fence
	prefix: string; // callout or quote markers in front of the fence, kept on new lines
}

const OPEN = /^((?:\s*>)*\s*)(`{3,}|~{3,})\s*session-log\b/;
const ITEM = /^[-*]\s+(.*)$/;
const TIME = /^(\d{1,2}:\d{2}(?:\s?[ap]m)?)\s+(.*)$/i;

// what is left of a line once callout markers are taken off
const strip = (line: string) => line.replace(/^(?:\s*>)*\s*/, '');

export function findBlock(lines: string[]): Block | null {
	for (let i = 0; i < lines.length; i++) {
		const m = OPEN.exec(lines[i]!);
		if (!m) continue;
		const fence = m[2]!;
		for (let j = i + 1; j < lines.length; j++) {
			const t = strip(lines[j]!).trim();
			if (t.startsWith(fence) && /^[`~]+$/.test(t)) return { open: i, close: j, prefix: m[1]! };
		}
		return null;
	}
	return null;
}

// Line numbers of the entries: the list that starts right after the block (blank lines allowed before it).
function entryLines(lines: string[], b: Block): number[] {
	let j = b.close + 1;
	while (j < lines.length && strip(lines[j]!).trim() === '') j++;
	const out: number[] = [];
	while (j < lines.length && ITEM.test(strip(lines[j]!))) out.push(j++);
	return out;
}

export function hasBlock(note: string): boolean {
	return findBlock(note.split('\n')) !== null;
}

export function entries(note: string): Entry[] {
	const lines = note.split('\n');
	const b = findBlock(lines);
	if (!b) return [];
	return entryLines(lines, b).map((i) => {
		const body = ITEM.exec(strip(lines[i]!))![1]!;
		const t = TIME.exec(body);
		return t ? { time: t[1]!, text: t[2]! } : { text: body };
	});
}

// The note with one more entry at the end of the log, or null when the note has no session-log block.
export function appendEntry(note: string, entry: string): string | null {
	const lines = note.split('\n');
	const b = findBlock(lines);
	if (!b) return null;
	const at = entryLines(lines, b);
	const line = `${b.prefix}- ${entry}`;
	if (at.length) lines.splice(at[at.length - 1]! + 1, 0, line);
	else lines.splice(b.close + 1, 0, b.prefix.trimEnd(), line);
	return lines.join('\n');
}

export function stamp(d: Date, clock24 = true): string {
	const m = String(d.getMinutes()).padStart(2, '0');
	if (clock24) return `${String(d.getHours()).padStart(2, '0')}:${m}`;
	const h = d.getHours() % 12 || 12;
	return `${h}:${m}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

export function formatEntry(text: string, tags: string[], time?: string): string {
	let body = text.trim().replace(/\s+/g, ' ');
	for (const t of tags) {
		const tag = '#' + t.replace(/^#/, '');
		if (!body.split(' ').includes(tag)) body += ' ' + tag;
	}
	return time ? `${time} ${body}` : body;
}

export function parseTags(s: string): string[] {
	return s.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
}

// How many entries carry each tag.
export function tagCounts(list: Entry[], tags: string[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const t of tags) {
		const re = new RegExp(`(^|\\s)#${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
		out[t] = list.filter((e) => re.test(e.text)).length;
	}
	return out;
}

// "Goblin 1, Goblin 2, Goblin 3, Bugbear" reads as "Goblin ×3, Bugbear".
export function groupNames(names: string[]): string {
	const counts = new Map<string, number>();
	for (const n of names) {
		const base = n.replace(/\s+\d+$/, '');
		counts.set(base, (counts.get(base) ?? 0) + 1);
	}
	const out: string[] = [];
	const seen = new Set<string>();
	for (const n of names) {
		const base = n.replace(/\s+\d+$/, '');
		if (counts.get(base)! > 1) {
			if (!seen.has(base)) out.push(`${base} ×${counts.get(base)}`);
			seen.add(base);
		} else out.push(n);
	}
	return out.join(', ');
}

// What Quick Initiative reports on each change (its `quick-initiative:change` event).
export interface FightState {
	round: number;
	combatants: { name: string; hp?: number; maxHp?: number; player: boolean; conditions?: string[] }[];
}

// The log lines one change to a fight is worth: start, someone going down, the end,
// and with `whole` the middle too: each new round, hits, heals and conditions.
export function fightLines(prev: FightState | undefined, next: FightState, whole = true): string[] {
	const out: string[] = [];
	const before = prev?.round ?? 0;
	if (before === 0 && next.round === 1) {
		out.push(`Fight started: ${groupNames(next.combatants.map((c) => c.name))}`);
	}
	if (prev && next.round > 0) {
		if (whole && before > 0 && next.round > before) out.push(`Round ${next.round}`);
		const was = new Map(prev.combatants.map((c) => [c.name, c]));
		for (const c of next.combatants) {
			const w = was.get(c.name);
			if (!w) continue;
			const hp = w.hp;
			const left = c.maxHp !== undefined ? ` (${c.hp}/${c.maxHp})` : ` (${c.hp} left)`;
			if (c.hp === 0 && hp !== undefined && hp > 0) out.push(`${c.name} is down (round ${next.round})`);
			else if (whole && c.hp !== undefined && hp !== undefined && c.hp !== hp) {
				if (hp === 0) out.push(`${c.name} is back up${left}`);
				else if (c.hp < hp) out.push(`${c.name} takes ${hp - c.hp}${left}`);
				else out.push(`${c.name} heals ${c.hp - hp}${left}`);
			}
			if (!whole || !c.conditions || !w.conditions) continue;
			const had = new Set(w.conditions.map((x) => x.toLowerCase()));
			const has = new Set(c.conditions.map((x) => x.toLowerCase()));
			const on = c.conditions.filter((x) => !had.has(x.toLowerCase()));
			const off = w.conditions.filter((x) => !has.has(x.toLowerCase()));
			if (on.length) out.push(`${c.name} is ${list(on)}`);
			if (off.length) out.push(`${c.name} is no longer ${list(off)}`);
		}
	}
	if (prev && before > 0 && next.round === 0) {
		const down = next.combatants.filter((c) => c.hp === 0).map((c) => c.name);
		const rounds = before === 1 ? '1 round' : `${before} rounds`;
		out.push(`Fight over after ${rounds}${down.length ? `. Down: ${groupNames(down)}` : ''}`);
	}
	return out;
}

// "poisoned", "poisoned and prone", "poisoned, prone and blinded"
function list(xs: string[]): string {
	return xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// The number for the next "Session N" note, from the names already there.
export function nextSessionNumber(names: string[]): number {
	let max = 0;
	for (const n of names) {
		const m = /\bsession\s*(\d+)\b/i.exec(n);
		if (m) max = Math.max(max, Number(m[1]));
	}
	return max + 1;
}

export function sessionNote(n: number, date: string, previous?: string): string {
	return [
		'---',
		`session: ${n}`,
		`date: ${date}`,
		'---',
		`# Session ${n}`,
		'',
		previous ? `Previously: [[${previous}]]` : 'First session.',
		'',
		'## Log',
		'',
		'```session-log',
		'```',
		'',
		'## Notes',
		'',
	].join('\n');
}
