/**
 * Input formats: a small JSON format (mirrors the Akinu database tables) and GEDCOM 5.5.
 */
import { type Genealogy, type LifeEvent, Marriage, Person, type Sex, link, nextId } from './genealogy';

// ---------------------------------------------------------------- dates

export interface ParsedDate {
  date: Date;
  uncertain: boolean;
}

/** "1950", "1950-03", "1950-03-01" (JSON) */
export function parseIsoDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1);
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** GEDCOM dates: "12 MAR 1850", "MAR 1850", "1850", "ABT 1850", "BET 1850 AND 1860", "BEF 1850"... */
export function parseGedcomDate(raw: string | undefined): ParsedDate | null {
  if (!raw) return null;
  let s = raw.toUpperCase().replace(/@#D[A-Z ]+@/g, '').trim();
  let uncertain = false;
  const between = /^(?:BET|FROM)\s+(.+?)\s+(?:AND|TO)\s+(.+)$/.exec(s);
  if (between) {
    const a = parseGedcomDate(between[1]);
    const b = parseGedcomDate(between[2]);
    if (a && b) return { date: new Date((a.date.getTime() + b.date.getTime()) / 2), uncertain: true };
    return a ?? b;
  }
  const qual = /^(ABT|ABOUT|EST|CAL|BEF|AFT|FROM|TO|INT)\.?\s+/.exec(s);
  if (qual) {
    uncertain = true;
    s = s.slice(qual[0].length);
  }
  s = s.replace(/\(.*\)/, '').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  let day = 1;
  let month = 0;
  let year: number | null = null;
  for (const part of parts) {
    if (/^\d{3,4}(\/\d+)?$/.test(part)) year = Number(part.split('/')[0]);
    else if (MONTHS[part] !== undefined) month = MONTHS[part];
    else if (/^\d{1,2}$/.test(part)) day = Number(part);
  }
  if (year == null) return null;
  return { date: new Date(year, month, day), uncertain };
}

// ---------------------------------------------------------------- JSON

export interface JsonPerson {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  sex?: 'Male' | 'Female' | 'M' | 'F';
  birth?: string;
  death?: string;
  deceased?: boolean;
  birthUncertain?: boolean;
  deathUncertain?: boolean;
  father?: string;
  mother?: string;
}

export interface JsonMarriage {
  id?: string;
  spouses: [string, string];
  start?: string;
  end?: string;
  divorced?: boolean;
  startUncertain?: boolean;
  endUncertain?: boolean;
}

export interface JsonEvent {
  id?: string;
  name: string;
  start: string;
  end?: string;
  location?: string;
  description?: string;
  historical?: boolean;
  people?: string[];
}

export interface JsonGenealogy {
  title?: string;
  root?: string;
  people: JsonPerson[];
  marriages?: JsonMarriage[];
  events?: JsonEvent[];
}

function toSex(s: string | undefined): Sex | null {
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === 'M' || u === 'MALE') return 'Male';
  if (u === 'F' || u === 'FEMALE') return 'Female';
  return null;
}

export function fromJson(json: JsonGenealogy): Genealogy {
  const byId = new Map<string, Person>();
  for (const jp of json.people) {
    const p = new Person(String(jp.id));
    if (jp.name && !jp.firstName && !jp.lastName) {
      const [first, ...rest] = jp.name.split(' ');
      p.firstName = first;
      p.lastName = rest.join(' ');
    } else {
      p.firstName = jp.firstName ?? '';
      p.lastName = jp.lastName ?? '';
    }
    p.sex = toSex(jp.sex);
    p.dateOfBirth = parseIsoDate(jp.birth);
    p.dateOfDeath = parseIsoDate(jp.death);
    p.deceasedFlag = Boolean(jp.deceased);
    p.isDobUncertain = Boolean(jp.birthUncertain);
    p.isDodUncertain = Boolean(jp.deathUncertain);
    byId.set(p.id, p);
  }
  for (const jp of json.people) {
    const p = byId.get(String(jp.id))!;
    for (const pid of [jp.father, jp.mother]) {
      const parent = pid != null ? byId.get(String(pid)) : undefined;
      if (parent) p.addParent(parent);
    }
  }
  const marriages: Marriage[] = [];
  for (const jm of json.marriages ?? []) {
    const a = byId.get(String(jm.spouses[0]));
    const b = byId.get(String(jm.spouses[1]));
    if (!a || !b) continue;
    const m = new Marriage(a, b, parseIsoDate(jm.start), parseIsoDate(jm.end), jm.id);
    m.divorcedFlag = Boolean(jm.divorced);
    m.isStartUncertain = Boolean(jm.startUncertain);
    m.isEndUncertain = Boolean(jm.endUncertain);
    marriages.push(m);
  }
  const people = [...byId.values()];
  link(people, marriages);
  const events: LifeEvent[] = (json.events ?? []).flatMap((je) => {
    const start = parseIsoDate(je.start);
    if (!start) return [];
    return [{
      id: je.id ?? nextId('E'),
      name: je.name,
      start,
      end: parseIsoDate(je.end),
      location: je.location,
      description: je.description,
      historical: Boolean(je.historical),
      people: (je.people ?? []).map((id) => byId.get(String(id))).filter((p): p is Person => Boolean(p)),
    }];
  });
  return { people, marriages, events, rootId: json.root, title: json.title };
}

// ---------------------------------------------------------------- GEDCOM

interface GedLine {
  level: number;
  xref?: string;
  tag: string;
  value: string;
}

interface GedNode extends GedLine {
  children: GedNode[];
}

function parseLines(text: string): GedNode[] {
  const roots: GedNode[] = [];
  const stack: GedNode[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/^﻿/, '').trim();
    if (!line) continue;
    const m = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s(.*))?$/.exec(line);
    if (!m) continue;
    const node: GedNode = { level: Number(m[1]), xref: m[2], tag: m[3].toUpperCase(), value: m[4] ?? '', children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length) {
      const parent = stack[stack.length - 1];
      if (node.tag === 'CONC') parent.value += node.value;
      else if (node.tag === 'CONT') parent.value += '\n' + node.value;
      else parent.children.push(node);
    } else {
      roots.push(node);
    }
    if (node.tag !== 'CONC' && node.tag !== 'CONT') stack.push(node);
  }
  return roots;
}

const child = (n: GedNode, tag: string) => n.children.find((c) => c.tag === tag);
const childrenOf = (n: GedNode, tag: string) => n.children.filter((c) => c.tag === tag);

export function fromGedcom(text: string, title?: string): Genealogy {
  const records = parseLines(text);
  const byXref = new Map<string, Person>();
  const events: LifeEvent[] = [];

  for (const r of records.filter((x) => x.tag === 'INDI' && x.xref)) {
    const p = new Person(r.xref!.replace(/@/g, ''));
    const nameNode = child(r, 'NAME');
    const raw = nameNode?.value ?? '';
    const given = child(nameNode ?? r, 'GIVN')?.value;
    const surname = child(nameNode ?? r, 'SURN')?.value;
    const slash = /^(.*?)\s*\/(.*?)\/\s*(.*)$/.exec(raw);
    p.firstName = (given ?? (slash ? `${slash[1]} ${slash[3]}`.trim() : raw)).trim();
    p.lastName = (surname ?? (slash ? slash[2] : '')).trim();
    p.sex = toSex(child(r, 'SEX')?.value);
    const birt = child(r, 'BIRT') ?? child(r, 'CHR') ?? child(r, 'BAPM');
    const b = parseGedcomDate(birt && child(birt, 'DATE')?.value);
    if (b) {
      p.dateOfBirth = b.date;
      p.isDobUncertain = b.uncertain || birt?.tag !== 'BIRT';
    }
    const deat = child(r, 'DEAT') ?? child(r, 'BURI');
    const d = parseGedcomDate(deat && child(deat, 'DATE')?.value);
    if (d) {
      p.dateOfDeath = d.date;
      p.isDodUncertain = d.uncertain || deat?.tag !== 'DEAT';
    } else if (deat) {
      p.deceasedFlag = true;
    }
    byXref.set(r.xref!, p);
  }

  const marriages: Marriage[] = [];
  for (const f of records.filter((x) => x.tag === 'FAM')) {
    const husb = byXref.get(child(f, 'HUSB')?.value ?? '');
    const wife = byXref.get(child(f, 'WIFE')?.value ?? '');
    const kids = childrenOf(f, 'CHIL').map((c) => byXref.get(c.value)).filter((p): p is Person => Boolean(p));
    for (const k of kids) {
      if (husb) k.addParent(husb);
      if (wife) k.addParent(wife);
    }
    if (husb && wife) {
      const marr = child(f, 'MARR');
      const div = child(f, 'DIV') ?? child(f, 'ANUL');
      const md = parseGedcomDate(marr && child(marr, 'DATE')?.value);
      const dd = parseGedcomDate(div && child(div, 'DATE')?.value);
      const m = new Marriage(husb, wife, md?.date ?? null, dd?.date ?? null, f.xref?.replace(/@/g, ''));
      m.isStartUncertain = md ? md.uncertain : false;
      m.isEndUncertain = dd ? dd.uncertain : false;
      m.divorcedFlag = Boolean(div) && div!.value.trim().toUpperCase() !== 'N';
      if (m.divorcedFlag && !m.endDate) m.isEndUncertain = true;
      marriages.push(m);
    }
  }

  const people = [...byXref.values()];
  link(people, marriages);
  return { people, marriages, events, title };
}

export function parseGenealogy(text: string, fileName = ''): Genealogy {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return fromJson(JSON.parse(text) as JsonGenealogy);
  if (/^﻿?0\s+HEAD/i.test(trimmed) || fileName.toLowerCase().endsWith('.ged')) {
    return fromGedcom(text, fileName.replace(/\.ged$/i, ''));
  }
  throw new Error('Unrecognized format: expected a JSON or GEDCOM (.ged) file.');
}
