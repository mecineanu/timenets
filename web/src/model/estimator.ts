/**
 * Rule-based estimation of missing data.
 * Port of genvis.data.DataEstimator (2010), with two bugs of the original fixed:
 *  - birth from parents' marriage: the original's operator precedence made the year 0 or 28;
 *  - marriage start: the "oldest child's birth" rule was always overwritten by the age-offset rule.
 */
import { Marriage, NOW, Person, dateWithYear, type Sex } from './genealogy';

/** years between generations */
export const OFFSET = 28;
/** people born more than THRESHOLD years ago are assumed dead */
export const THRESHOLD = 100;

export interface EstimationReport {
  warnings: string[];
}

export function estimate(root: Person): EstimationReport {
  const warnings: string[] = [];
  const all = collect(root);

  // pre pass: a child with two parents implies a marriage between them
  for (const p of all) missingSpouseRelationship(p);
  // first pass: gender, birth, death
  for (const p of all) {
    estimateSex(p);
    if (!estimateDate(p, 'dateOfBirth')) warnings.push(`Cannot estimate ${p.name}'s date of birth`);
    const dob = p.dateOfBirth;
    if (dob && dob.getFullYear() + THRESHOLD < NOW.getFullYear() && !p.dateOfDeath) {
      if (!estimateDate(p, 'dateOfDeath')) warnings.push(`Cannot estimate ${p.name}'s date of death`);
    }
  }
  // second pass: marriages, and which spouse is the other parent
  for (const p of all) {
    for (const m of p.marriages) {
      const sp = m.spouseOf(p);
      if (m.startDate == null && sp && !estimateMarriageStart(p, sp, m)) {
        warnings.push(`Cannot estimate marriage start of ${p.name}`);
      }
    }
    p.invalidate();
    if (p.parents.length === 1 && p.dateOfBirth) {
      const parent = p.parents[0];
      for (const m of parent.marriages) {
        const other = m.spouseOf(parent);
        if (!other || !m.startDate) continue;
        const end = m.endDate ?? other.endOfLife;
        if (m.startDate <= p.dateOfBirth && end >= p.dateOfBirth) {
          other.addChild(p);
          p.addParent(other);
          break;
        }
      }
    }
    p.invalidate();
  }
  // validation
  for (const p of all) {
    for (const m of p.marriages) {
      if (m.endDate && m.startDate && m.startDate > m.endDate) {
        const t = m.endDate;
        m.endDate = m.startDate;
        m.startDate = t;
      }
      if (m.endDate && p.dateOfDeath && m.endDate > p.dateOfDeath) {
        const t = m.endDate;
        m.endDate = p.dateOfDeath;
        p.dateOfDeath = t;
      }
    }
    p.invalidate();
  }
  return { warnings };
}

/** root, ancestors and descendants, with their spouses */
export function collect(root: Person): Person[] {
  const out = new Set<Person>();
  const add = (p: Person) => {
    out.add(p);
    for (const m of p.marriages) {
      const s = m.spouseOf(p);
      if (s) out.add(s);
    }
  };
  add(root);
  root.visitAncestors(add);
  root.visitDescendants(add);
  return [...out];
}

function setDate(p: Person, type: 'dateOfBirth' | 'dateOfDeath', d: Date): void {
  p[type] = d;
  if (type === 'dateOfBirth') p.isDobUncertain = true;
  else p.isDodUncertain = true;
}

export function estimateDate(p: Person, type: 'dateOfBirth' | 'dateOfDeath'): boolean {
  if (p[type] != null) return true;
  // parents' marriage date (birth) or end of marriage + offset (death)
  if (p.parents.length === 2) {
    for (const m of p.parents[0].marriageWith(p.parents[1])) {
      const md = type === 'dateOfBirth' ? m.startDate : m.endDate;
      if (md) {
        setDate(p, type, dateWithYear(md, md.getFullYear() + (type === 'dateOfBirth' ? 1 : OFFSET)));
        return true;
      }
    }
  }
  // a child's date - offset
  for (const c of p.children) {
    const cd = c[type];
    if (cd) {
      setDate(p, type, dateWithYear(cd, cd.getFullYear() - OFFSET));
      return true;
    }
  }
  // a spouse's date
  for (const s of p.spouses) {
    const sd = s[type];
    if (sd) {
      setDate(p, type, new Date(sd.getTime()));
      return true;
    }
  }
  // a sibling's date
  for (const s of p.siblings) {
    const sd = s[type];
    if (sd) {
      setDate(p, type, new Date(sd.getTime()));
      return true;
    }
  }
  // a parent's date + offset
  for (const parent of p.parents) {
    const pd = parent[type];
    if (pd) {
      setDate(p, type, dateWithYear(pd, pd.getFullYear() + OFFSET));
      return true;
    }
  }
  if (type === 'dateOfDeath' && p.dateOfBirth) {
    const dob = p.dateOfBirth;
    if (dob.getFullYear() + THRESHOLD > NOW.getFullYear()) {
      // considered alive
      return true;
    }
    setDate(p, type, new Date(dob.getFullYear() + THRESHOLD, 0, 1));
    return true;
  }
  return false;
}

export function estimateMarriageStart(p: Person, spouse: Person, m: Marriage): boolean {
  const kids = p.childrenWith(spouse);
  if (kids.length && kids[kids.length - 1].dateOfBirth) {
    // oldest child's birth
    m.startDate = new Date(kids[kids.length - 1].dateOfBirth!.getTime());
  } else if (p.dateOfBirth && spouse.dateOfBirth) {
    const younger = p.dateOfBirth < spouse.dateOfBirth ? spouse.dateOfBirth : p.dateOfBirth;
    m.startDate = dateWithYear(younger, younger.getFullYear() + OFFSET);
  } else {
    const any = p.dateOfBirth ?? spouse.dateOfBirth;
    if (!any) return false;
    m.startDate = dateWithYear(any, any.getFullYear() + OFFSET);
  }
  m.isStartUncertain = true;
  p.invalidate();
  spouse.invalidate();
  return true;
}

function estimateSex(p: Person): void {
  if (p.sex != null) return;
  for (const s of p.spouses) {
    if (s.sex && s.sex !== 'None') {
      p.sex = (s.sex === 'Male' ? 'Female' : 'Male') as Sex;
      p.isSexEstimated = true;
      return;
    }
  }
  p.sex = 'None';
  p.isSexEstimated = true;
}

function missingSpouseRelationship(p: Person): void {
  if (p.parents.length !== 2) return;
  const [a, b] = p.parents;
  if (!a.isSpouseOf(b)) {
    const m = new Marriage(a, b);
    m.isStartUncertain = true;
    a.addMarriage(m);
    b.addMarriage(m);
  }
}
