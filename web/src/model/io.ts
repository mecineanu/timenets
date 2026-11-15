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
  const trimmed = text.replace(/^﻿/, '').trimStart();
  let g: Genealogy;
  if (trimmed.startsWith('{')) {
    g = fromJson(JSON.parse(trimmed) as JsonGenealogy);
  } else if (/^0\s+HEAD/i.test(trimmed) || /\.ged(com)?$/i.test(fileName)) {
    g = fromGedcom(trimmed, fileName.replace(/\.ged(com)?$/i, ''));
  } else {
    throw new Error('Unrecognized format: expected a JSON or GEDCOM (.ged) file.');
  }
  if (g.people.length === 0) throw new Error('No people (INDI records) found in this file.');
  return g;
}

// ---------------------------------------------------------------- character encodings

/** ANSEL (ANSI Z39.47), the historical GEDCOM character set: specials and combining diacritics */
const ANSEL_SPECIAL: Record<number, string> = {
  0xa1: 'Ł', 0xa2: 'Ø', 0xa3: 'Đ', 0xa4: 'Þ', 0xa5: 'Æ', 0xa6: 'Œ', 0xa7: 'ʹ', 0xa8: '·', 0xa9: '♭', 0xaa: '®',
  0xab: '±', 0xac: 'Ơ', 0xad: 'Ư', 0xae: 'ʼ', 0xb0: 'ʻ', 0xb1: 'ł', 0xb2: 'ø', 0xb3: 'đ', 0xb4: 'þ', 0xb5: 'æ',
  0xb6: 'œ', 0xb7: 'ʺ', 0xb8: 'ı', 0xb9: '£', 0xba: 'ð', 0xbc: 'ơ', 0xbd: 'ư', 0xc0: '°', 0xc1: 'ℓ', 0xc2: '℗',
  0xc3: '©', 0xc4: '♯', 0xc5: '¿', 0xc6: '¡', 0xcf: 'ß',
};
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: '̉', 0xe1: '̀', 0xe2: '́', 0xe3: '̂', 0xe4: '̃', 0xe5: '̄', 0xe6: '̆',
  0xe7: '̇', 0xe8: '̈', 0xe9: '̌', 0xea: '̊', 0xeb: '︠', 0xec: '︡', 0xed: '̕',
  0xee: '̋', 0xef: '̐', 0xf0: '̧', 0xf1: '̨', 0xf2: '̣', 0xf3: '̤', 0xf4: '̥',
  0xf5: '̳', 0xf6: '̲', 0xf7: '̦', 0xf8: '̜', 0xf9: '̮', 0xfa: '︢', 0xfb: '︣',
  0xfe: '̓',
};

function decodeAnsel(bytes: Uint8Array): string {
  let out = '';
  let pending = '';
  for (const b of bytes) {
    if (ANSEL_COMBINING[b]) {
      // ANSEL puts combining marks before the base letter; Unicode after it
      pending += ANSEL_COMBINING[b];
      continue;
    }
    out += (b < 0x80 ? String.fromCharCode(b) : ANSEL_SPECIAL[b] ?? '�') + pending;
    pending = '';
  }
  return (out + pending).normalize('NFC');
}

/**
 * Decode a genealogy file: UTF-8 (with or without BOM), UTF-16 (BOM), ANSEL (as declared in the
 * GEDCOM header) and, as a last resort, Windows-1252 — common in exports from older software.
 */
export function decodeGenealogyFile(buf: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16' };
  // UTF-16 without BOM: "0 HEAD" with zero bytes in between
  if (bytes[0] === 0x30 && bytes[1] === 0) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16' };
  if (bytes[0] === 0 && bytes[1] === 0x30) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16' };
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const declared = /\n\s*1\s+CHAR\s+(\S+)/i.exec(head)?.[1]?.toUpperCase();
  if (declared === 'ANSEL') return { text: decodeAnsel(bytes), encoding: 'ANSEL' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}
