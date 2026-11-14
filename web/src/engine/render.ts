/**
 * Turns a laid-out scene into drawable primitives (global coordinates).
 * Port of genvis.vis.data.render.LifelineRenderer / EdgeSprite / AttributeRenderer.
 */
import { type LifeEvent, NOW, type Person, type Sex, addYears } from '../model/genealogy';
import type { TimeNetLayout } from './layout';
import { BETA, GAMMA } from './lifeline';
import { type Edge, type EvtPt, EvtType, type LNode, NodeKind, type Scene } from './scene';

export type CurveStyle = 'curved' | 'straight';

/** a piece of lifeline; `fade` draws it with a horizontal opacity gradient */
export interface Stroke {
  d: string;
  fade?: { x1: number; x2: number; from: number; to: number };
}

export interface RenderLifeline {
  id: string;
  person: Person;
  sex: Sex;
  kind: NodeKind;
  simplified: boolean;
  strokes: Stroke[];
  doi: number;
  label?: { x: number; y: number; text: string; maxWidth: number };
  /** global position of the birth point */
  birth: { x: number; y: number };
}

export interface RenderDropLine {
  id: string;
  sex: Sex;
  from: { x: number; y: number };
  to: { x: number; y: number };
  markers: { x: number; y: number }[];
  outOfWedlock: boolean;
}

export interface RenderStub {
  id: string;
  sex: Sex;
  from: { x: number; y: number };
  to: { x: number; y: number };
  hidden: Person;
}

export interface RenderMarker {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface RenderEvent {
  event: LifeEvent;
  points: { x: number; y: number }[];
}

export interface RenderBand {
  event: LifeEvent;
  x1: number;
  x2: number;
}

export interface RenderModel {
  lifelines: RenderLifeline[];
  dropLines: RenderDropLine[];
  stubs: RenderStub[];
  uncertainMarriages: RenderMarker[];
  events: RenderEvent[];
  bands: RenderBand[];
  now: number;
  lineWidth: number;
  labelStyle: 'inside' | 'outside';
  yMin: number;
  yMax: number;
}

const f = (n: number) => (Math.round(n * 10) / 10).toString();

function curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  return `C${f(mx)},${f(a.y)} ${f(mx)},${f(b.y)} ${f(b.x)},${f(b.y)}`;
}

function globalPoints(n: LNode): { x: number; y: number; type: EvtType; src: EvtPt }[] {
  return n.points.map((p) => ({ x: n.toGlobalX(p.x), y: n.toGlobalY(p.y), type: p.type, src: p }));
}

function lifelineStrokes(n: LNode, style: CurveStyle): Stroke[] {
  const pts = globalPoints(n);
  if (pts.length < 2) return [];
  if (style === 'straight') {
    return [{ d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)},${f(p.y)}`).join(' ') }];
  }
  let d = '';
  const fades: Stroke[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[i - 1];
    const next = pts[i + 1];
    switch (p.type) {
      case EvtType.BORN:
        d += `M${f(p.x)},${f(p.y)} `;
        break;
      case EvtType.DATING:
        if (!prev || n.simplified) d += `M${f(p.x)},${f(p.y)} `;
        else d += `L${f(p.x)},${f(p.y)} `;
        break;
      case EvtType.MARRIAGE:
        if (!prev) {
          d += `M${f(p.x)},${f(p.y)} `;
        } else if (n.simplified) {
          fades.push({ d: `M${f(prev.x)},${f(prev.y)} ${curve(prev, p)}`, fade: { x1: prev.x, x2: p.x, from: 0, to: 1 } });
          d += `M${f(p.x)},${f(p.y)} `;
        } else {
          d += `${curve(prev, p)} `;
        }
        break;
      case EvtType.DIVORCE:
        d += `${d ? 'L' : 'M'}${f(p.x)},${f(p.y)} `;
        if (next && next.type === EvtType.RESTING) {
          if (n.simplified) {
            fades.push({ d: `M${f(p.x)},${f(p.y)} ${curve(p, next)}`, fade: { x1: p.x, x2: next.x, from: 1, to: 0 } });
            d += `M${f(next.x)},${f(next.y)} `;
          } else {
            d += `${curve(p, next)} `;
          }
          i++;
        }
        break;
      case EvtType.RESTING:
        d += `M${f(p.x)},${f(p.y)} `;
        break;
      case EvtType.ROUTESTART:
      case EvtType.DEAD:
        d += `${d ? 'L' : 'M'}${f(p.x)},${f(p.y)} `;
        break;
      case EvtType.ROUTEEND:
        d += prev ? `${curve(prev, p)} ` : `M${f(p.x)},${f(p.y)} `;
        break;
    }
  }
  // a simplified lifeline that ends with its divorce draws nothing after "resting"
  d = d.replace(/(M[-\d.,]+\s*)+$/, '').trim();
  return [...(d ? [{ d }] : []), ...fades];
}

function labelFor(n: LNode, layout: TimeNetLayout): RenderLifeline['label'] {
  const pts = globalPoints(n);
  if (pts.length < 2 || pts[0].type !== EvtType.BORN) return undefined;
  const inside = layout.opts.labelStyle === 'inside';
  const lw = layout.lifeline.lineWidth;
  // longest horizontal stretch of the lifeline, preferring the first one
  let best = { x1: pts[0].x, x2: pts[0].x, y: pts[0].y };
  let start = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (Math.abs(p.y - start.y) > 0.5 || p.type === EvtType.DATING || p.type === EvtType.ROUTESTART) {
      const cand = { x1: start.x, x2: p.x, y: start.y };
      if (best.x2 - best.x1 < 60 && cand.x2 - cand.x1 > best.x2 - best.x1) best = cand;
      start = p;
    }
  }
  const tail = { x1: start.x, x2: pts[pts.length - 1].x, y: start.y };
  if (best.x2 - best.x1 < 60 && tail.x2 - tail.x1 > best.x2 - best.x1) best = tail;
  if (!inside) {
    // thin lines: the label sits above the start of the lifeline and may run along its whole length
    const maxWidth = pts[pts.length - 1].x - pts[0].x - 2;
    return maxWidth < 12 ? undefined : { x: pts[0].x + 1, y: pts[0].y - lw / 2 - 3, text: n.person.name, maxWidth };
  }
  const maxWidth = best.x2 - best.x1 - 6;
  if (maxWidth < 12) return undefined;
  return { x: best.x1 + 4, y: best.y + 5, text: n.person.name, maxWidth };
}

function edgeStart(e: Edge, bx: number, lw: number): { x: number; y: number } | null {
  let nf: LNode | undefined;
  for (const p of e.parents) {
    if (p.block.focus !== p && !p.simplified && p.lines.length) {
      nf = p;
      break;
    }
  }
  if (nf) {
    const y = nf.Y(bx);
    if (Number.isFinite(y)) return { x: bx, y: y + lw / 2 + BETA / 2 };
  }
  for (const p of e.parents) {
    const y = p.Y(bx);
    if (Number.isFinite(y)) return { x: bx, y };
  }
  return null;
}

function drawable(n: LNode): boolean {
  return n.visible && n.block.visible && !n.block.aggregated;
}

export function buildRenderModel(scene: Scene, layout: TimeNetLayout, style: CurveStyle): RenderModel {
  const lw = layout.lifeline.lineWidth;
  const lifelines: RenderLifeline[] = [];
  for (const n of scene.nodes) {
    if (!drawable(n)) continue;
    const strokes = lifelineStrokes(n, style);
    const p = n.person;
    if (!n.simplified && n.points.length) {
      const born = n.points[0];
      const last = n.points[n.points.length - 1];
      if (p.isDobUncertain && p.dateOfBirth && born.type === EvtType.BORN) {
        const x0 = layout.X(addYears(p.dateOfBirth, -3));
        const bx = n.toGlobalX(born.x);
        const by = n.toGlobalY(born.y);
        strokes.push({ d: `M${f(x0)},${f(by)} L${f(bx)},${f(by)}`, fade: { x1: x0, x2: bx, from: 0, to: 1 } });
      }
      if (p.isDodUncertain && p.deceased && p.dateOfDeath && last.type === EvtType.DEAD) {
        const x1 = layout.X(addYears(p.dateOfDeath, 3));
        const dx = n.toGlobalX(last.x);
        const dy = n.toGlobalY(last.y);
        strokes.push({ d: `M${f(dx)},${f(dy)} L${f(x1)},${f(dy)}`, fade: { x1: dx, x2: x1, from: 1, to: 0 } });
      }
    }
    if (!strokes.length) continue;
    lifelines.push({
      id: p.id,
      person: p,
      sex: p.sex ?? 'None',
      kind: n.kind,
      simplified: n.simplified,
      strokes,
      doi: n.doi,
      label: n.simplified ? undefined : labelFor(n, layout),
      birth: { x: n.toGlobalX(0), y: n.toGlobalY(0) },
    });
  }

  const dropLines: RenderDropLine[] = [];
  for (const e of scene.edges) {
    const c = e.child;
    if (!e.visible || !drawable(c) || c.simplified || !c.person.dateOfBirth || e.parents.length === 0) continue;
    if (!e.parents.some((p) => drawable(p) && !p.simplified)) continue;
    const bx = layout.X(c.person.dateOfBirth);
    const to = { x: bx, y: c.toGlobalY(0) };
    const sex = c.person.sex ?? 'None';
    if (e.outOfWedlock && e.parents.length === 2) {
      const ys = e.parents.map((p) => p.Y(bx)).filter(Number.isFinite);
      if (!ys.length) continue;
      const far = ys.reduce((a, b) => (Math.abs(b - to.y) > Math.abs(a - to.y) ? b : a));
      dropLines.push({ id: c.person.id, sex, from: { x: bx, y: far }, to, markers: ys.map((y) => ({ x: bx, y })), outOfWedlock: true });
    } else {
      const from = edgeStart(e, bx, lw);
      if (!from) continue;
      dropLines.push({ id: c.person.id, sex, from, to, markers: [from], outOfWedlock: false });
    }
  }

  // collapsed blocks keep a faded stub towards their parent (information scent)
  const stubs: RenderStub[] = [];
  const height = GAMMA + lw;
  for (const b of scene.blocks) {
    const pn = b.focus.parentNode;
    if (!b.aggregated || !pn || !pn.visible || !b.parentBlock || b.parentBlock.aggregated) continue;
    const upward = b.ty - pn.block.ty <= 0;
    const sex = b.focus.person.sex ?? 'None';
    if (b.focus.kind === NodeKind.ANCESTOR) {
      if (!pn.person.dateOfBirth) continue;
      const x = layout.X(pn.person.dateOfBirth);
      const y = pn.toGlobalY(0);
      stubs.push({ id: b.focus.person.id, sex, from: { x, y }, to: { x, y: y + (upward ? -height : height) }, hidden: b.focus.person });
    } else if (b.focus.kind === NodeKind.DESCENDANT && b.focus.inEdge && b.focus.person.dateOfBirth) {
      const bx = layout.X(b.focus.person.dateOfBirth);
      const from = edgeStart(b.focus.inEdge, bx, lw);
      if (!from) continue;
      stubs.push({ id: b.focus.person.id, sex, from, to: { x: bx, y: pn.toGlobalY(0) + (upward ? -height : height) }, hidden: b.focus.person });
    }
  }

  // uncertain marriage dates: halo on the spouse's lifeline
  const uncertainMarriages: RenderMarker[] = [];
  for (const m of scene.marriages) {
    if (!m.isStartUncertain || !m.startDate) continue;
    const n1 = scene.nodeOf(m.person1);
    const n2 = scene.nodeOf(m.person2);
    if (!n1 || !n2 || !drawable(n1) || !drawable(n2) || n1.simplified || n2.simplified) continue;
    const span = (BETA + lw) / 2;
    for (const [a, b] of [[n1, n2], [n2, n1]] as const) {
      if (a.block.focus === a) continue;
      const pt = a.points.find((p) => p.type === EvtType.MARRIAGE && p.date === m.startDate);
      if (!pt) continue;
      uncertainMarriages.push({
        id: m.id,
        x: a.toGlobalX(pt.x),
        y: a.toGlobalY(pt.y) + (a.y - b.y > 0 ? -span : span),
        label: `${m.person1.name} & ${m.person2.name}`,
      });
      break;
    }
  }

  const events: RenderEvent[] = [];
  const bands: RenderBand[] = [];
  for (const ev of scene.events) {
    if (ev.historical) {
      bands.push({ event: ev, x1: layout.X(ev.start), x2: layout.X(ev.end ?? ev.start) });
    } else {
      const points = layout.placeEvent(scene, ev.start, ev.people);
      if (points.length) events.push({ event: ev, points });
    }
  }

  return {
    lifelines,
    dropLines,
    stubs,
    uncertainMarriages,
    events,
    bands,
    now: layout.X(NOW),
    lineWidth: lw,
    labelStyle: layout.opts.labelStyle,
    yMin: layout.yMin,
    yMax: layout.yMax,
  };
}
