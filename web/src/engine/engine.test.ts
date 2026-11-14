import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGedcomDate, parseGenealogy } from '../model/io';
import { EvtType } from './scene';
import { DEFAULT_OPTIONS, computeView, defaultRoot } from './timenet';

const load = (name: string) => parseGenealogy(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'), name);
const size = { width: 1200, height: 700 };

function allNumbers(obj: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object' && !(v instanceof Date)) {
      for (const [k, x] of Object.entries(v)) if (k !== 'person' && k !== 'event' && k !== 'hidden' && k !== 'doi') walk(x);
    }
  };
  walk(obj);
  return out;
}

describe('io', () => {
  it('parses GEDCOM dates', () => {
    expect(parseGedcomDate('12 MAR 1920')?.date.getFullYear()).toBe(1920);
    expect(parseGedcomDate('12 MAR 1920')?.date.getMonth()).toBe(2);
    expect(parseGedcomDate('ABT 1924')?.uncertain).toBe(true);
    expect(parseGedcomDate('BET 1900 AND 1910')?.date.getFullYear()).toBe(1905);
    expect(parseGedcomDate('nonsense')).toBeNull();
  });

  it('loads the GEDCOM sample', () => {
    const g = load('haddad-family.ged');
    expect(g.people).toHaveLength(10);
    const karim = g.people.find((p) => p.firstName === 'Karim')!;
    expect(karim.lastName).toBe('Haddad');
    expect(karim.spouses.map((s) => s.firstName)).toEqual(['Salma', 'Leila', 'Noor']);
    expect(karim.marriages.find((m) => m.spouseOf(karim)?.firstName === 'Leila')?.divorced).toBe(true);
  });
});

describe.each([
  ['martin-family.json', 'claude'],
  ['haddad-family.ged', 'I1'],
])('layout of %s', (file, rootId) => {
  const g = load(file);

  for (const doiEnabled of [false, true]) {
    for (const labelStyle of ['inside', 'outside'] as const) {
      it(`is finite and overlap-free (doi=${doiEnabled}, labels ${labelStyle})`, () => {
        const v = computeView(g, { rootId, focusId: rootId, pinnedIds: [] }, { ...DEFAULT_OPTIONS, doiEnabled, labelStyle }, size)!;
        expect(v).not.toBeNull();
        expect(v.model.lifelines.length).toBeGreaterThan(3);
        for (const n of allNumbers(v.model)) expect(Number.isFinite(n)).toBe(true);
        for (const l of v.model.lifelines) for (const s of l.strokes) expect(s.d).not.toMatch(/NaN|undefined/);

        // event points never go back in time along a lifeline
        for (const n of v.scene.nodes) {
          for (let i = 1; i < n.points.length; i++) {
            if (n.points[i].type === EvtType.RESTING || n.points[i - 1].type === EvtType.RESTING) continue;
            expect(n.points[i].x).toBeGreaterThanOrEqual(n.points[i - 1].x - 1e-6);
          }
        }

        // visible blocks must not overlap
        const blocks = v.scene.blocks.filter((b) => b.visible && !b.aggregated);
        for (let i = 0; i < blocks.length; i++) {
          for (let j = i + 1; j < blocks.length; j++) {
            expect(blocks[i].intersect(blocks[j]), `${blocks[i].focus.person.name} / ${blocks[j].focus.person.name}`).toBe(false);
          }
        }
      });
    }
  }
});

describe('every person as root', () => {
  for (const file of ['martin-family.json', 'haddad-family.ged']) {
    it(`never overlaps blocks in ${file}`, () => {
      const g = load(file);
      for (const p of g.people) {
        for (const doiEnabled of [false, true]) {
          const v = computeView(g, { rootId: p.id, focusId: p.id, pinnedIds: [] }, { ...DEFAULT_OPTIONS, doiEnabled }, size)!;
          const blocks = v.scene.blocks.filter((b) => b.visible && !b.aggregated);
          for (let i = 0; i < blocks.length; i++) {
            for (let j = i + 1; j < blocks.length; j++) {
              expect(blocks[i].intersect(blocks[j]), `root ${p.name}: ${blocks[i].focus.person.name} / ${blocks[j].focus.person.name}`).toBe(false);
            }
          }
          for (const n of allNumbers(v.model)) expect(Number.isFinite(n)).toBe(true);
        }
      }
    });
  }
});

describe('estimation', () => {
  it('fills in missing dates and flags them as uncertain', () => {
    const g = load('martin-family.json');
    computeView(g, { rootId: 'claude', focusId: 'claude', pinnedIds: [] }, DEFAULT_OPTIONS, size);
    const auguste = g.people.find((p) => p.id === 'auguste')!;
    expect(auguste.dateOfBirth).not.toBeNull();
    expect(auguste.isDobUncertain).toBe(true);
  });

  it('estimates a missing marriage date from the oldest child', () => {
    const g = load('haddad-family.ged');
    computeView(g, { rootId: 'I1', focusId: 'I1', pinnedIds: [] }, DEFAULT_OPTIONS, size);
    const omar = g.people.find((p) => p.firstName === 'Omar')!;
    const m = omar.marriages[0];
    expect(m.startDate?.getFullYear()).toBe(1975);
    expect(m.isStartUncertain).toBe(true);
  });

  it('picks the person with the largest hourglass as default root', () => {
    const g = load('haddad-family.ged');
    expect(defaultRoot(g)?.firstName).toBe('Karim');
  });
});
