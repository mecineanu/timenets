import type { Genealogy, Person } from '../model/genealogy';
import { formatDate, lifespan } from './format';
import { sexColor } from './colors';

interface Props {
  genealogy: Genealogy;
  person: Person | null;
  root: Person | null;
  warnings: string[];
  onSelect: (id: string) => void;
  onMakeRoot: (id: string) => void;
}

function PersonLink({ p, onSelect }: { p: Person; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="linkish" onClick={() => onSelect(p.id)}>
      <span className="sw" style={{ background: sexColor(p.sex ?? 'None') }} />
      {p.name || '(no name)'}
    </button>
  );
}

export function InfoPanel({ genealogy, person, root, warnings, onSelect, onMakeRoot }: Props) {
  const events = person ? genealogy.events.filter((e) => e.people.includes(person)) : [];
  return (
    <aside className="panel" aria-label="Details">
      {person ? (
        <>
          <h2>
            <span className="sw" style={{ background: sexColor(person.sex ?? 'None') }} />
            {person.name}
          </h2>
          <div className="muted">
            {lifespan(person)}
            {(person.isDobUncertain || person.isDodUncertain) && <span className="tag">estimated dates</span>}
            {person === root && <span className="tag">root</span>}
          </div>
          {person !== root && (
            <p>
              <button type="button" className="btn" onClick={() => onMakeRoot(person.id)}>
                Make this person the root
              </button>
            </p>
          )}

          {person.parents.length > 0 && (
            <>
              <h3>Parents</h3>
              <ul>
                {person.parents.map((p) => (
                  <li key={p.id}>
                    <PersonLink p={p} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {person.marriages.length > 0 && (
            <>
              <h3>Marriages</h3>
              <ul>
                {person.marriages.map((m) => {
                  const s = m.spouseOf(person)!;
                  return (
                    <li key={m.id}>
                      <PersonLink p={s} onSelect={onSelect} />{' '}
                      <span className="muted">
                        {m.startDate ? formatDate(m.startDate, m.isStartUncertain) : '?'}
                        {m.divorced && m.endDate ? ` – divorced ${formatDate(m.endDate, m.isEndUncertain)}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {person.children.length > 0 && (
            <>
              <h3>Children</h3>
              <ul>
                {[...person.children].sort((a, b) => (a.dateOfBirth?.getTime() ?? 0) - (b.dateOfBirth?.getTime() ?? 0)).map((c) => (
                  <li key={c.id}>
                    <PersonLink p={c} onSelect={onSelect} />{' '}
                    <span className="muted">{c.dateOfBirth ? formatDate(c.dateOfBirth, c.isDobUncertain) : ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {events.length > 0 && (
            <>
              <h3>Events</h3>
              <ul>
                {events.map((e) => (
                  <li key={e.id}>
                    {e.name} <span className="muted">{formatDate(e.start)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="muted">Click a lifeline to see the person.</p>
      )}

      <h3>How to read it</h3>
      <div className="help">
        <p>Each line is a life, from birth to death (or today). Lines converge at marriage and diverge at divorce; dashed lines link parents to children.</p>
        <p>
          <kbd>click</kbd> focus · <kbd>double-click</kbd> new root · <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>click</kbd> pin (DOI mode) ·
          wheel: zoom · drag: pan
        </p>
        <p>A fading line end marks an estimated date; a yellow halo marks an estimated marriage date.</p>
      </div>

      <h3>Data</h3>
      <div className="help">
        {genealogy.people.length} people · {genealogy.marriages.length} marriages · {genealogy.events.length} events
        {warnings.length > 0 && (
          <details>
            <summary>{warnings.length} estimation warning(s)</summary>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </aside>
  );
}
