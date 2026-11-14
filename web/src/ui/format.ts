import type { Person } from '../model/genealogy';

const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function formatDate(d: Date, uncertain = false): string {
  const isJan1 = d.getMonth() === 0 && d.getDate() === 1;
  const s = isJan1 ? String(d.getFullYear()) : fmt.format(d);
  return uncertain ? `c. ${d.getFullYear()}` : s;
}

export function lifespan(p: Person): string {
  const b = p.dateOfBirth ? formatDate(p.dateOfBirth, p.isDobUncertain) : '?';
  if (p.dateOfDeath) return `${b} – ${formatDate(p.dateOfDeath, p.isDodUncertain)}`;
  return p.deceased ? `${b} – ?` : `b. ${b}`;
}
