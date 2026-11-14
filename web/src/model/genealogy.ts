/**
 * Genealogical data model.
 * Port of genvis.data.Person / Marriage / Event (Flex, 2010).
 */

export type Sex = 'Male' | 'Female' | 'None';

export const NOW = new Date();

export function addYears(d: Date, years: number): Date {
  const r = new Date(d.getTime());
  r.setFullYear(r.getFullYear() + years);
  return r;
}

export function dateWithYear(d: Date, year: number): Date {
  return new Date(year, d.getMonth(), d.getDate());
}

let autoId = 0;
export function nextId(prefix: string): string {
  autoId += 1;
  return `${prefix}${autoId}`;
}

export class Person {
  id: string;
  firstName = '';
  lastName = '';
  sex: Sex | null = null;
  dateOfBirth: Date | null = null;
  dateOfDeath: Date | null = null;
  /** explicitly known as deceased even without a date of death */
  deceasedFlag = false;
  isDobUncertain = false;
  isDodUncertain = false;
  /** gender was inferred */
  isSexEstimated = false;
  parents: Person[] = [];
  children: Person[] = [];
  marriages: Marriage[] = [];
  private _spouses: Person[] = [];
  private sorted = false;

  constructor(id?: string) {
    this.id = id ?? nextId('P');
  }

  get name(): string {
    return [this.firstName, this.lastName].filter(Boolean).join(' ');
  }

  get deceased(): boolean {
    return this.dateOfDeath != null || this.deceasedFlag;
  }

  /** death date, or "now" for living people (used for the right end of lifelines) */
  get endOfLife(): Date {
    return this.deceased && this.dateOfDeath ? this.dateOfDeath : NOW;
  }

  invalidate(): void {
    this.sorted = false;
  }

  get spouses(): Person[] {
    if (!this.sorted) this.sort();
    return this._spouses;
  }

  addParent(p: Person): void {
    if (this.parents.includes(p)) return;
    this.sorted = false;
    this.parents.push(p);
  }

  addChild(c: Person): void {
    if (this.children.includes(c)) return;
    this.sorted = false;
    this.children.push(c);
  }

  addMarriage(m: Marriage): void {
    this.sorted = false;
    this.marriages.push(m);
  }

  isSpouseOf(p: Person): boolean {
    return this.spouses.includes(p);
  }

  isParentOf(p: Person): boolean {
    return this.children.includes(p);
  }

  isChildOf(p: Person): boolean {
    return this.parents.includes(p);
  }

  get father(): Person | null {
    return this.parents.find((p) => p.sex === 'Male') ?? (this.parents.length === 2 ? this.parents[0] : null);
  }

  get mother(): Person | null {
    const f = this.father;
    return this.parents.find((p) => p.sex === 'Female' && p !== f) ?? this.parents.find((p) => p !== f) ?? null;
  }

  /**
   * parents: Male first; spouses: by marriage start date; children: youngest first.
   */
  sort(): void {
    this.parents.sort((a, b) => (a.sex === b.sex ? 0 : a.sex === 'Male' ? -1 : b.sex === 'Male' ? 1 : 0));
    this.marriages.sort((a, b) => time(a.startDate) - time(b.startDate));
    const sp: Person[] = [];
    for (const m of this.marriages) {
      const s = m.spouseOf(this);
      if (s && !sp.includes(s)) sp.push(s);
    }
    this._spouses = sp;
    this.children.sort((a, b) => time(b.dateOfBirth) - time(a.dateOfBirth));
    this.sorted = true;
  }

  get lastMarriage(): Marriage | null {
    if (!this.sorted) this.sort();
    return this.marriages.length ? this.marriages[this.marriages.length - 1] : null;
  }

  get siblings(): Person[] {
    if (this.parents.length !== 2) return [];
    const [a, b] = this.parents;
    return a.children.filter((s) => b.isParentOf(s) && s !== this);
  }

  childrenWith(spouse: Person): Person[] {
    if (!this.sorted) this.sort();
    return this.children.filter((c) => c.isChildOf(spouse));
  }

  marriageWith(spouse: Person): Marriage[] {
    if (!this.sorted) this.sort();
    return this.marriages.filter((m) => m.spouseOf(this) === spouse);
  }

  visitAncestors(fn: (p: Person) => void, seen = new Set<Person>()): void {
    for (const parent of this.parents) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      fn(parent);
      parent.visitAncestors(fn, seen);
    }
  }

  visitDescendants(fn: (p: Person) => void, seen = new Set<Person>()): void {
    for (const child of this.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      fn(child);
      child.visitDescendants(fn, seen);
    }
  }
}

export class Marriage {
  id: string;
  person1: Person;
  person2: Person;
  startDate: Date | null;
  endDate: Date | null;
  divorcedFlag = false;
  isStartUncertain = false;
  isEndUncertain = false;

  constructor(p1: Person, p2: Person, start: Date | null = null, end: Date | null = null, id?: string) {
    this.id = id ?? nextId('M');
    this.person1 = p1;
    this.person2 = p2;
    this.startDate = start;
    this.endDate = end;
  }

  spouseOf(p: Person): Person | null {
    if (p === this.person1) return this.person2;
    if (p === this.person2) return this.person1;
    return null;
  }

  /**
   * A marriage that "ends" in the year one spouse dies is not a divorce
   * when it is the last marriage of both (same rule as the original).
   */
  get divorced(): boolean {
    if (this.endDate == null) return false;
    const y = this.endDate.getFullYear();
    const end1 = this.person1.endOfLife.getFullYear();
    const end2 = this.person2.endOfLife.getFullYear();
    if ((y === end1 || y === end2) && this.person1.lastMarriage === this && this.person2.lastMarriage === this) {
      return false;
    }
    return this.divorcedFlag;
  }

  /** start date and end date (divorce or first death), null when unknown */
  marriageLine(): { start: Date; end: Date | null } | null {
    if (!this.startDate) return null;
    let end: Date | null = this.endDate;
    if (!end) {
      const d1 = this.person1.dateOfDeath;
      const d2 = this.person2.dateOfDeath;
      if (d1 && d2) end = d1 < d2 ? d1 : d2;
      else end = d1 ?? d2 ?? null;
    }
    return { start: this.startDate, end };
  }
}

export interface LifeEvent {
  id: string;
  name: string;
  location?: string;
  start: Date;
  end?: Date | null;
  description?: string;
  /** historical events are drawn as vertical bands, personal ones as dots on lifelines */
  historical: boolean;
  people: Person[];
}

export interface Genealogy {
  people: Person[];
  marriages: Marriage[];
  events: LifeEvent[];
  /** id of the person to use as root by default */
  rootId?: string;
  title?: string;
}

export function time(d: Date | null | undefined): number {
  return d ? d.getTime() : Number.NaN;
}

/** Wire marriages and parent links into the Person objects. */
export function link(people: Person[], marriages: Marriage[]): void {
  for (const m of marriages) {
    if (!m.person1.marriages.includes(m)) m.person1.addMarriage(m);
    if (!m.person2.marriages.includes(m)) m.person2.addMarriage(m);
  }
  for (const p of people) {
    for (const parent of p.parents) parent.addChild(p);
    p.invalidate();
  }
}
