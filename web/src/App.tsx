import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Genealogy } from './model/genealogy';
import { type JsonGenealogy, decodeGenealogyFile, fromJson, parseGenealogy } from './model/io';
import { DEFAULT_OPTIONS, type ViewOptions, type ViewState, computeView, defaultRoot } from './engine/timenet';
import { InfoPanel } from './ui/InfoPanel';
import { TimeNetView } from './ui/TimeNetView';
import martinJson from './samples/martin-family.json';
import haddadGed from './samples/haddad-family.ged?raw';

const SAMPLES: Record<string, { label: string; load: () => Genealogy }> = {
  martin: { label: 'Martin family (sample)', load: () => fromJson(structuredClone(martinJson) as JsonGenealogy) },
  haddad: { label: 'Haddad family — GEDCOM (sample)', load: () => parseGenealogy(haddadGed, 'haddad-family.ged') },
};

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

function initialState(g: Genealogy): ViewState {
  const root = defaultRoot(g);
  const id = root?.id ?? '';
  return { rootId: id, focusId: id, pinnedIds: [] };
}

export default function App() {
  const [source, setSource] = useState('martin');
  const [genealogy, setGenealogy] = useState<Genealogy>(() => SAMPLES.martin.load());
  const [state, setState] = useState<ViewState>(() => initialState(genealogy));
  const [options, setOptions] = useState<ViewOptions>(DEFAULT_OPTIONS);
  const [selectedId, setSelectedId] = useState<string | null>(state.rootId);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loadCount, setLoadCount] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // measure right away too: ResizeObserver callbacks can be delayed in background tabs
    const box = el.getBoundingClientRect();
    setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!notice || notice.startsWith('Reading')) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const view = useMemo(() => {
    if (size.width < 50 || size.height < 50) return null;
    try {
      return computeView(genealogy, state, options, { width: size.width, height: size.height - 26 });
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [genealogy, state, options, size]);

  const load = useCallback((g: Genealogy, name: string) => {
    if (g.people.length === 0) throw new Error('No people found in this file.');
    const s = initialState(g);
    setGenealogy(g);
    setState(s);
    setSelectedId(s.rootId);
    setSource(name);
    setError(null);
    setQuery('');
    setLoadCount((c) => c + 1);
  }, []);

  const openFile = async (file: File) => {
    setNotice(`Reading ${file.name}…`);
    try {
      const { text, encoding } = decodeGenealogyFile(await file.arrayBuffer());
      const g = parseGenealogy(text, file.name);
      load(g, file.name);
      setNotice(`${file.name}: ${g.people.length} people, ${g.marriages.length} marriages (${encoding})`);
    } catch (e) {
      setNotice(null);
      setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const byId = useMemo(() => new Map(genealogy.people.map((p) => [p.id, p])), [genealogy]);
  const root = byId.get(state.rootId) ?? null;
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const makeRoot = (id: string) => {
    setState({ rootId: id, focusId: id, pinnedIds: [] });
    setSelectedId(id);
  };

  const select = (id: string, { ctrl }: { ctrl: boolean }) => {
    const p = byId.get(id);
    if (!p) return;
    if (view && !view.scene.nodeOf(p)) {
      // not part of the current hourglass: re-root on that person
      makeRoot(id);
      return;
    }
    if (ctrl && options.doiEnabled) {
      setState((s) => ({
        ...s,
        pinnedIds: s.pinnedIds.includes(id) ? s.pinnedIds.filter((x) => x !== id) : [...s.pinnedIds, id],
      }));
      return;
    }
    setSelectedId(id);
    setState((s) => ({ ...s, focusId: id }));
  };

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return new Set<string>();
    return new Set(genealogy.people.filter((p) => normalize(p.name).includes(q)).map((p) => p.id));
  }, [query, genealogy]);

  const set = <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => setOptions((o) => ({ ...o, [k]: v }));

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          TimeNets<small>Akinu, revisited</small>
        </div>

        <div className="group">
          <select
            aria-label="Dataset"
            value={SAMPLES[source] ? source : 'file'}
            onChange={(e) => {
              if (SAMPLES[e.target.value]) load(SAMPLES[e.target.value].load(), e.target.value);
            }}
          >
            {Object.entries(SAMPLES).map(([k, s]) => (
              <option key={k} value={k}>
                {s.label}
              </option>
            ))}
            {!SAMPLES[source] && <option value="file">{source}</option>}
          </select>
          {/* A real <label> around the input: opening a file picker from a <select> change
              is blocked silently by some browsers. No `accept` filter either: Safari greys out
              .ged files because it does not know their type. */}
          <label className="btn file-btn">
            Open file…
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <div className="group">
          <input
            type="search"
            placeholder="Search for a person"
            aria-label="Search for a person"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.size) select([...matches][0], { ctrl: false });
              if (e.key === 'Escape') setQuery('');
            }}
          />
          {query && <span className="muted">{matches.size}</span>}
        </div>

        <div className="group">
          <label>Show</label>
          <div className="seg" role="group" aria-label="Degree of interest">
            <button type="button" aria-pressed={!options.doiEnabled} onClick={() => set('doiEnabled', false)}>
              All
            </button>
            <button type="button" aria-pressed={options.doiEnabled} onClick={() => set('doiEnabled', true)} title="Filter by degree of interest (fisheye) and fit to the screen">
              DOI
            </button>
          </div>
          {options.doiEnabled && (
            <input
              type="number"
              min={0}
              max={6}
              aria-label="DOI distance"
              title="Number of generations shown around the focus"
              value={options.doiDistance}
              onChange={(e) => set('doiDistance', Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
            />
          )}
        </div>

        <div className="group">
          <label>Lines</label>
          <div className="seg" role="group" aria-label="Label style">
            <button type="button" aria-pressed={options.labelStyle === 'inside'} onClick={() => set('labelStyle', 'inside')}>
              Thick
            </button>
            <button type="button" aria-pressed={options.labelStyle === 'outside'} onClick={() => set('labelStyle', 'outside')}>
              Thin
            </button>
          </div>
          <div className="seg" role="group" aria-label="Interpolation">
            <button type="button" aria-pressed={options.curveStyle === 'curved'} onClick={() => set('curveStyle', 'curved')}>
              Curved
            </button>
            <button type="button" aria-pressed={options.curveStyle === 'straight'} onClick={() => set('curveStyle', 'straight')}>
              Straight
            </button>
          </div>
        </div>

        <div className="group">
          <label>Time</label>
          <select
            aria-label="Time axis"
            value={options.fitHorzBound ? 'fit' : String(options.xrange)}
            onChange={(e) => {
              if (e.target.value === 'fit') set('fitHorzBound', true);
              else setOptions((o) => ({ ...o, fitHorzBound: false, xrange: Number(e.target.value) }));
            }}
          >
            <option value="fit">Whole family</option>
            <option value="60">60 years around the focus</option>
            <option value="90">90 years around the focus</option>
            <option value="150">150 years around the focus</option>
          </select>
          <button type="button" className="btn" onClick={() => setLoadCount((c) => c + 1)}>
            Recenter
          </button>
        </div>
      </header>

      <main
        className="stage"
        ref={stageRef}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) void openFile(f);
        }}
      >
        {view ? (
          <TimeNetView
            view={view}
            width={size.width}
            height={size.height}
            selectedId={selectedId}
            pinnedIds={state.pinnedIds}
            matchIds={matches}
            resetKey={`${loadCount}-${state.rootId}`}
            onSelect={select}
            onMakeRoot={makeRoot}
          />
        ) : (
          <div className="empty">{size.width ? 'Nothing to display.' : ''}</div>
        )}
        {error && (
          <button type="button" className="tooltip notice error" role="alert" onClick={() => setError(null)}>
            <b>Import failed</b>
            {error}
            <span className="muted"> (click to dismiss)</span>
          </button>
        )}
        {notice && !error && (
          <div className="tooltip notice" role="status">
            {notice}
          </div>
        )}
        {dragging && <div className="dropzone">Drop a GEDCOM (.ged) or JSON file</div>}
      </main>

      <InfoPanel
        genealogy={genealogy}
        person={selected}
        root={root}
        warnings={view?.warnings ?? []}
        onSelect={(id) => select(id, { ctrl: false })}
        onMakeRoot={makeRoot}
      />
    </div>
  );
}
