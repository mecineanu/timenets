import { scaleTime } from 'd3-scale';
import { select } from 'd3-selection';
import { type ZoomBehavior, type ZoomTransform, zoom, zoomIdentity } from 'd3-zoom';
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { ComputedView } from '../engine/timenet';
import type { RenderLifeline } from '../engine/render';
import { sexColor } from './colors';
import { formatDate, lifespan } from './format';


interface Props {
  view: ComputedView;
  width: number;
  height: number;
  selectedId: string | null;
  pinnedIds: string[];
  matchIds: Set<string>;
  /** changes when the view should be re-centred (new data or root) */
  resetKey: string;
  onSelect: (id: string, e: { ctrl: boolean }) => void;
  onMakeRoot: (id: string) => void;
}

type Tip = { x: number; y: number; content: ReactNode } | null;

const AXIS_H = 26;

export function TimeNetView({ view, width, height, selectedId, pinnedIds, matchIds, resetKey, onSelect, onMakeRoot }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const [tip, setTip] = useState<Tip>(null);
  const { model, layout } = view;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 8])
      .filter((ev: Event) => !(ev as MouseEvent).button && ev.type !== 'dblclick')
      .on('zoom', (ev) => setT(ev.transform));
    zoomRef.current = z;
    select(svg).call(z);
    return () => {
      select(svg).on('.zoom', null);
    };
  }, []);

  useEffect(() => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).call(zoomRef.current.transform, zoomIdentity.translate(0, AXIS_H / 2));
    }
  }, [resetKey]);

  const xScale = useMemo(
    () => scaleTime().domain([layout.xMin, layout.xMax]).range([layout.opts.padding, layout.opts.width - layout.opts.padding]),
    [layout],
  );
  const zx = useMemo(() => t.rescaleX(xScale), [t, xScale]);
  const ticks = zx.ticks(Math.max(2, Math.floor(width / 90)));
  const tickFormat = zx.tickFormat();
  const pinned = new Set(pinnedIds);
  const lw = model.lineWidth;
  const inside = model.labelStyle === 'inside';

  const showTip = (e: ReactMouseEvent, content: ReactNode) => {
    const box = svgRef.current!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };

  const personTip = (l: RenderLifeline) => (
    <>
      <b>{l.person.name}</b>
      <span>{lifespan(l.person)}</span>
      {l.person.marriages.length > 0 && (
        <div className="muted">
          {l.person.marriages.map((m) => {
            const s = m.spouseOf(l.person);
            return (
              <div key={m.id}>
                ∞ {s?.name} {m.startDate ? formatDate(m.startDate, m.isStartUncertain) : '?'}
                {m.divorced && m.endDate ? ` – div. ${formatDate(m.endDate, m.isEndUncertain)}` : ''}
              </div>
            );
          })}
        </div>
      )}
      {l.simplified && <div className="muted">Collapsed lifeline (low interest)</div>}
      <div className="muted">Click: focus · double-click: root</div>
    </>
  );

  return (
    <>
      <svg ref={svgRef} role="img" aria-label="TimeNets visualization" onMouseLeave={() => setTip(null)}>
        <defs>
          {model.lifelines.flatMap((l) =>
            l.strokes.map((s, i) =>
              s.fade ? (
                <linearGradient
                  key={`${l.id}-${i}`}
                  id={`fade-${l.id}-${i}`}
                  gradientUnits="userSpaceOnUse"
                  x1={s.fade.x1}
                  x2={s.fade.x2}
                  y1={0}
                  y2={0}
                >
                  <stop offset="0" stopColor={sexColor(l.sex)} stopOpacity={s.fade.from} />
                  <stop offset="1" stopColor={sexColor(l.sex)} stopOpacity={s.fade.to} />
                </linearGradient>
              ) : null,
            ),
          )}
          <radialGradient id="uncertain-halo">
            <stop offset="0.3" stopColor="var(--uncertain)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--uncertain)" stopOpacity="0" />
          </radialGradient>
          {model.stubs.map((s) => (
            <linearGradient key={s.id} id={`stub-${s.id}`} gradientUnits="userSpaceOnUse" x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y}>
              <stop offset="0" stopColor={sexColor(s.sex)} stopOpacity="0.9" />
              <stop offset="1" stopColor={sexColor(s.sex)} stopOpacity="0.05" />
            </linearGradient>
          ))}
        </defs>

        {/* screen-space background: grid, historical bands, now line */}
        <g className="axis">
          {ticks.map((d) => (
            <line key={+d} x1={zx(d)} x2={zx(d)} y1={AXIS_H} y2={height} stroke="var(--grid)" />
          ))}
        </g>
        <g className="band">
          {bandRows(model.bands.map((b) => ({ b, x1: t.applyX(b.x1), x2: t.applyX(b.x2) }))).map(({ b, x1, x2, row }) => {
            const w = Math.max(2, x2 - x1);
            return (
              <g key={b.event.id} onMouseMove={(e) => showTip(e, eventTip(b.event))} onMouseLeave={() => setTip(null)}>
                <rect x={x1} y={AXIS_H} width={w} height={height - AXIS_H} fill="var(--band)" opacity={0.45} />
                <text x={x1 + 4} y={height - 8 - row * 14}>
                  {b.event.name}
                </text>
              </g>
            );
          })}
          <line x1={t.applyX(model.now)} x2={t.applyX(model.now)} y1={AXIS_H} y2={height} stroke="var(--muted)" strokeDasharray="2 4" />
        </g>

        <g transform={t.toString()}>
          {model.stubs.map((s) => (
            <path
              key={`stub-${s.id}`}
              d={`M${s.from.x},${s.from.y} L${s.to.x},${s.to.y}`}
              stroke={`url(#stub-${s.id})`}
              strokeWidth={2}
              strokeDasharray="4 3"
              fill="none"
              onMouseMove={(e) => showTip(e, <><b>{s.hidden.name}</b><span className="muted">hidden — click to expand</span></>)}
              onMouseLeave={() => setTip(null)}
              onClick={() => onSelect(s.hidden.id, { ctrl: false })}
              style={{ cursor: 'pointer' }}
            />
          ))}

          <g className="drop">
            {model.dropLines.map((d) => (
              <g key={`drop-${d.id}`} opacity={0.65}>
                <path d={`M${d.from.x},${d.from.y} L${d.to.x},${d.to.y}`} stroke={sexColor(d.sex)} strokeWidth={1.5} />
                {d.markers.map((m, i) => (
                  <path
                    key={i}
                    d={d.to.y > m.y ? `M${m.x - 4},${m.y} L${m.x + 4},${m.y} L${m.x},${m.y + 6} Z` : `M${m.x - 4},${m.y} L${m.x + 4},${m.y} L${m.x},${m.y - 6} Z`}
                    fill={sexColor(d.sex)}
                  />
                ))}
              </g>
            ))}
          </g>

          {model.lifelines.map((l) => {
            const cls = [
              'lifeline',
              selectedId === l.id ? 'selected' : '',
              pinned.has(l.id) ? 'pinned' : '',
              matchIds.size && matchIds.has(l.id) ? 'match' : '',
              matchIds.size && !matchIds.has(l.id) ? 'dim' : '',
            ].join(' ');
            const main = l.strokes.filter((s) => !s.fade);
            return (
              <g
                key={l.id}
                className={cls}
                onClick={(e) => onSelect(l.id, { ctrl: e.ctrlKey || e.metaKey })}
                onDoubleClick={() => onMakeRoot(l.id)}
                onMouseMove={(e) => showTip(e, personTip(l))}
                onMouseLeave={() => setTip(null)}
              >
                {main.map((s, i) => (
                  <path key={`h${i}`} className="hit" d={s.d} />
                ))}
                {l.strokes.map((s, i) => (
                  <path
                    key={i}
                    className={s.fade ? 'fade' : 'main'}
                    d={s.d}
                    stroke={s.fade ? `url(#fade-${l.id}-${i})` : sexColor(l.sex)}
                    strokeWidth={lw}
                    strokeOpacity={l.simplified && !s.fade ? 0.85 : 1}
                  />
                ))}
                {l.label && (
                  <text
                    style={{ transform: `translate(${l.label.x}px, ${l.label.y}px)` }}
                    fill={inside ? 'var(--label-inside)' : 'var(--label-outside)'}
                  >
                    {truncate(l.label.text, l.label.maxWidth)}
                  </text>
                )}
              </g>
            );
          })}

          {model.uncertainMarriages.map((m) => (
            <circle
              key={`unc-${m.id}`}
              r={lw * 0.6 + 4}
              cx={m.x}
              cy={m.y}
              fill="url(#uncertain-halo)"
              onMouseMove={(e) => showTip(e, <><b>Estimated marriage date</b><span>{m.label}</span></>)}
              onMouseLeave={() => setTip(null)}
            />
          ))}

          {model.events.flatMap((ev) =>
            ev.points.map((p, i) => (
              <circle
                key={`${ev.event.id}-${i}`}
                className="event-dot"
                r={inside ? 4.5 : 4}
                style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
                fill="var(--event)"
                stroke="var(--panel)"
                strokeWidth={1.5}
                onMouseMove={(e) => showTip(e, eventTip(ev.event))}
                onMouseLeave={() => setTip(null)}
              />
            )),
          )}
        </g>

        {/* time axis on top, in screen space */}
        <g className="axis">
          <rect x={0} y={0} width={width} height={AXIS_H} fill="var(--bg)" />
          <line x1={0} x2={width} y1={AXIS_H} y2={AXIS_H} stroke="var(--border)" />
          {ticks.map((d) => (
            <text key={+d} x={zx(d)} y={17} textAnchor="middle">
              {tickFormat(d)}
            </text>
          ))}
        </g>
      </svg>
      {tip && (
        <div className="tooltip" style={{ left: Math.min(tip.x + 14, width - 290), top: tip.y + 14 }}>
          {tip.content}
        </div>
      )}
    </>
  );
}

function eventTip(ev: { name: string; start: Date; end?: Date | null; location?: string; description?: string; people: { name: string }[] }) {
  return (
    <>
      <b>{ev.name}</b>
      <span>
        {formatDate(ev.start)}
        {ev.end ? ` – ${formatDate(ev.end)}` : ''}
      </span>
      {ev.location && <div className="muted">{ev.location}</div>}
      {ev.description && <div>{ev.description}</div>}
      {ev.people.length > 0 && <div className="muted">{ev.people.map((p) => p.name).join(', ')}</div>}
    </>
  );
}

/** stack band labels on several rows so they do not overlap */
function bandRows<T extends { b: { event: { name: string } }; x1: number }>(items: T[]): (T & { row: number })[] {
  const rowEnds: number[] = [];
  return [...items]
    .sort((a, c) => a.x1 - c.x1)
    .map((it) => {
      const w = it.b.event.name.length * 6.2 + 12;
      let row = rowEnds.findIndex((end) => end < it.x1);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = it.x1 + w;
      return { ...it, row };
    });
}

/** approximate text truncation (average glyph width ≈ 0.56 em at 13px) */
function truncate(text: string, maxWidth: number): string {
  const maxChars = Math.floor(maxWidth / 7.3);
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '';
  return `${text.slice(0, maxChars - 1)}…`;
}
