/**
 * Local layout of a block and generation of lifeline event points.
 * Port of genvis.vis.lifeline.Lifeline and LineSpline.
 */
import { Marriage, Person, addYears } from '../model/genealogy';
import { type Block, type EvtPt, EvtType, type LNode, NodeKind, type Scene } from './scene';

export const FONTSIZE = 14;
export const TOPMARGIN = 2;
export const BOTTOMMARGIN = 1;
/** years between "dating" and marriage, and between divorce and "resting" */
export const ALPHA = 5;
/** gap between two married lines */
export const BETA = 2;
/** vertical distance from a baseline to a marriage line */
export const GAMMA = TOPMARGIN + FONTSIZE + BOTTOMMARGIN;
/** years used to shift a spouse from one marriage lane to another */
export const DELTA = 3;
const THIN_LINE = 2.5;

export type LabelStyle = 'inside' | 'outside';

const UP = 0;
const DOWN = 1;

export class Lifeline {
  readonly style: LabelStyle;
  readonly lineWidth: number;
  /** minimal horizontal distance between event points */
  readonly epsilon: number;
  X: (d: Date) => number = () => 0;
  curDate: Date = new Date();

  private datMap = new Map<string, EvtPt>();
  private marMap = new Map<string, EvtPt>();
  private divMap = new Map<string, EvtPt>();
  private retMap = new Map<string, EvtPt>();

  constructor(style: LabelStyle) {
    this.style = style;
    this.lineWidth = style === 'outside' ? THIN_LINE : GAMMA;
    this.epsilon = style === 'outside' ? THIN_LINE : GAMMA;
  }

  get labelHeight(): number {
    return BOTTOMMARGIN + FONTSIZE + TOPMARGIN;
  }

  /** called after the blocks were positioned horizontally */
  layout(b: Block, scene: Scene): void {
    if (b.aggregated) {
      for (const n of b.nodes) n.points = [];
      for (const n of b.nodes) n.calcBBox(this.style === 'outside', this.lineWidth, this.labelHeight);
      b.calcBBox();
      return;
    }
    this.horizontalPositioning(b);
    this.verticalPositioning(b, scene);
    this.generateLifelines(b, scene);
    const display = new Set<LNode>([b.focus]);
    for (const s of b.focus.person.spouses) {
      const n = scene.nodeOf(s);
      if (n) display.add(n);
    }
    for (const n of b.nodes) {
      if (!display.has(n)) {
        n.simplified = true;
        this.simplify(n, scene);
        n.calcBBox(this.style === 'outside', this.lineWidth, this.labelHeight);
      }
    }
    b.calcBBox();
  }

  private generateLifelines(b: Block, scene: Scene): void {
    const node = b.focus;
    this.lifeline(node, scene);
    node.calcBBox(this.style === 'outside', this.lineWidth, this.labelHeight);
    for (const s of node.person.spouses) {
      const sn = scene.nodeOf(s);
      if (!sn) continue;
      this.lifelineOfSpouse(sn, node, scene);
      sn.calcBBox(this.style === 'outside', this.lineWidth, this.labelHeight);
    }
  }

  /** a lifeline that is not displayed keeps only its marriage points */
  private simplify(n: LNode, scene: Scene): void {
    n.points = [];
    for (const s of n.person.spouses) {
      const sn = scene.nodeOf(s);
      if (!sn || sn.kind === NodeKind.SPOUSE || sn.simplified) continue;
      for (const m of n.person.marriageWith(s)) {
        if (!m.startDate) continue;
        const x = n.toLocalX(this.X(m.startDate));
        const y = sn.toLocalY(sn.Y(n.toGlobalX(x))) + sn.y - n.y;
        if (!Number.isNaN(y)) n.points.push({ x, y, type: EvtType.MARRIAGE, date: m.startDate, data: s });
      }
    }
  }

  private horizontalPositioning(b: Block): void {
    for (const n of b.nodes) {
      n.x = n.person.dateOfBirth ? this.X(n.person.dateOfBirth) - b.x : 0;
    }
  }

  /**
   * Spouses are stacked above the focus person (latest spouse on top);
   * the focus sits below, lowered by the number of overlapping marriages.
   */
  private verticalPositioning(b: Block, scene: Scene): void {
    const person = b.focus.person;
    let noMarEvtPts = true;
    for (const s of person.spouses) {
      const sn = scene.nodeOf(s);
      if (!sn) continue;
      if (!sn.simplified) noMarEvtPts = false;
      else sn.y = 0;
    }
    const initY = this.style === 'outside' ? this.labelHeight : this.lineWidth / 2;
    let y = initY;
    if (person.spouses.length !== 0 && !noMarEvtPts) {
      let dist = GAMMA + this.lineWidth;
      for (let i = person.spouses.length - 1; i >= 0; i--) {
        const sn = scene.nodeOf(person.spouses[i]);
        if (!sn || sn.simplified) continue;
        sn.y = y;
        y += dist;
      }
      // maximum number of simultaneous marriages
      const pts: { date: Date; delta: number }[] = [];
      for (const m of person.marriages) {
        const line = m.marriageLine();
        if (!line) continue;
        pts.push({ date: line.start, delta: 1 });
        if (line.end) pts.push({ date: line.end, delta: -1 });
      }
      pts.sort((a, c) => a.date.getTime() - c.date.getTime() || a.delta - c.delta);
      let cur = 0;
      let maxMar = 0;
      for (const p of pts) {
        cur += p.delta;
        maxMar = Math.max(maxMar, cur);
      }
      dist = maxMar > 1 ? (maxMar - 1) * (BETA + this.lineWidth) : 0;
      if (y !== initY) y += GAMMA + BETA + this.lineWidth + dist;
    }
    b.focus.y = y;
  }

  /** event points of the block's focus person (port of LineSpline.lifeline) */
  lifeline(node: LNode, scene: Scene): void {
    const person = node.person;
    const X = this.X;
    let points: EvtPt[] = [{ x: 0, y: 0, type: EvtType.BORN, date: person.dateOfBirth }];
    const dist = GAMMA + this.lineWidth / 2;
    let dir = UP;
    for (const m of person.marriages) {
      const spouse = m.spouseOf(person);
      const sn = spouse && scene.nodeOf(spouse);
      if (!sn || !m.startDate) continue;
      dir = node.y - sn.y > 0 ? UP : DOWN;
      const yy = dir === UP ? -dist : dist;
      points.push({ x: node.toLocalX(X(m.startDate)), y: yy, type: EvtType.MARRIAGE, date: m.startDate, data: m });
      if (m.divorced && m.endDate) {
        points.push({ x: node.toLocalX(X(m.endDate)), y: yy, type: EvtType.DIVORCE, date: m.endDate, data: m });
      }
    }
    const born = points[0];
    const rest = points.slice(1).sort((a, b) => a.date!.getTime() - b.date!.getTime());
    let numMar = 0;
    for (const e of rest) numMar += e.type === EvtType.MARRIAGE ? 1 : -1;
    const isDivorced = numMar === 0;
    const deathDate = person.deceased && person.dateOfDeath ? person.dateOfDeath : this.curDate;
    const deathY = isDivorced ? 0 : person.spouses.length === 0 ? 0 : dir === UP ? -dist : dist;

    // keep only the first marriage of a run of overlapping marriages and its last divorce
    points = [born];
    numMar = 0;
    for (const e of rest) {
      if (e.type === EvtType.MARRIAGE) {
        numMar++;
        if (numMar === 1) points.push(e);
      } else {
        numMar--;
        if (numMar === 0) points.push(e);
      }
    }
    points.push({ x: node.toLocalX(X(deathDate)), y: deathY, type: EvtType.DEAD, date: deathDate });

    // perturb event points that are too close to each other
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      let threshold: number;
      if (prev.type === EvtType.BORN || cur.type === EvtType.DEAD) threshold = this.epsilon;
      else if (cur.type === EvtType.DIVORCE) threshold = 0;
      else threshold = 2 * this.epsilon;
      if (cur.x - prev.x < threshold) cur.x = prev.x + threshold;
    }

    // add "dating" points before marriages and "resting" points after divorces
    const out: EvtPt[] = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const next = points[i + 1];
      if (cur.type === EvtType.MARRIAGE && prev) {
        let datX = node.toLocalX(X(addYears(cur.date!, -ALPHA)));
        const marThreshold = prev.type === EvtType.BORN ? prev.x : (prev.x + cur.x) / 2;
        if (datX < marThreshold) datX = marThreshold;
        out.push({ x: datX, y: 0, type: EvtType.DATING, date: cur.date, data: cur.data });
      }
      out.push(cur);
      if (cur.type === EvtType.DIVORCE && next) {
        let retX = node.toLocalX(X(addYears(cur.date!, ALPHA)));
        const divThreshold = next.type === EvtType.DEAD ? next.x : (next.x + cur.x) / 2;
        if (retX > divThreshold) retX = divThreshold;
        out.push({ x: retX, y: 0, type: EvtType.RESTING, date: cur.date, data: cur.data });
      }
    }
    node.points = out;

    this.datMap.clear();
    this.marMap.clear();
    this.divMap.clear();
    this.retMap.clear();
    for (const e of out) {
      const id = (e.data as Marriage | undefined)?.id;
      if (!id) continue;
      if (e.type === EvtType.DATING) this.datMap.set(id, e);
      else if (e.type === EvtType.MARRIAGE) this.marMap.set(id, e);
      else if (e.type === EvtType.DIVORCE) this.divMap.set(id, e);
      else if (e.type === EvtType.RESTING) this.retMap.set(id, e);
    }
  }

  /**
   * Marriages of `ref` that started before `refMarriage` and are still running at its
   * start (START) or at its end (END).
   */
  private findIntersectingMarriages(refMarriage: Marriage, type: 'start' | 'end', marriages: Marriage[]): Marriage[] {
    const line = refMarriage.marriageLine();
    if (!line) return [];
    const out: Marriage[] = [];
    for (const m of marriages) {
      if (m === refMarriage || !m.startDate || m.startDate > line.start) continue;
      const other = m.marriageLine();
      if (!other) continue;
      if (type === 'start') {
        if (other.end == null || other.end >= line.start) out.push(m);
      } else if (other.end == null || (line.end != null && other.end >= line.end)) {
        out.push(m);
      }
    }
    return out;
  }

  /** event points of a spouse, converging to the focus' lifeline (port of LineSpline.lifelineOfSpouse) */
  lifelineOfSpouse(node: LNode, refNode: LNode, scene: Scene): void {
    void scene;
    const person = node.person;
    const ref = refNode.person;
    const X = this.X;
    const lw = this.lineWidth;
    const points: EvtPt[] = [];
    if (!node.simplified) points.push({ x: 0, y: 0, type: EvtType.BORN, date: person.dateOfBirth });
    const dir = refNode.y < node.y ? UP : DOWN;
    const lane = BETA + lw;
    const baseY = refNode.y - node.y + (dir === DOWN ? -(GAMMA + BETA + 1.5 * lw) : GAMMA + BETA + 1.5 * lw);
    const deathDate = person.deceased && person.dateOfDeath ? person.dateOfDeath : this.curDate;
    const deathX = node.toLocalX(X(deathDate));
    let deathY = 0;
    const toLocal = (refLocalX: number) => node.toLocalX(refNode.toGlobalX(refLocalX));

    for (const m of person.marriageWith(ref)) {
      if (!m.startDate) continue;
      const startMars = this.findIntersectingMarriages(m, 'start', ref.marriages);
      const endMars = this.findIntersectingMarriages(m, 'end', ref.marriages);
      let routes: Date[] | null = null;
      if (startMars.length !== endMars.length) {
        routes = [];
        for (const sm of startMars) {
          const end = sm.marriageLine()?.end;
          if ((endMars.length === 0 || !endMars.includes(sm)) && end) routes.push(end);
        }
      }
      const key = startMars.length === 0 ? m.id : startMars[0].id;
      const refMar = this.marMap.get(key);
      const refDat = this.datMap.get(key);
      const refMarX = refMar ? toLocal(refMar.x) : node.toLocalX(X(m.startDate));
      const dateSpan = refMar && refDat ? refMarX - toLocal(refDat.x) : refMarX - node.toLocalX(X(addYears(m.startDate, -ALPHA)));
      const marX = startMars.length === 0 ? refMarX : node.toLocalX(X(m.startDate));
      const marY = baseY + (dir === DOWN ? -(startMars.length * lane) : startMars.length * lane);
      const datY = node.simplified ? marY + (dir === DOWN ? -GAMMA : GAMMA) : 0;
      points.push({ x: marX - dateSpan, y: datY, type: EvtType.DATING, date: m.startDate, data: ref });
      points.push({ x: marX, y: marY, type: EvtType.MARRIAGE, date: m.startDate, data: ref });
      if (routes) {
        routes.sort((a, b) => a.getTime() - b.getTime());
        routes.forEach((r, i) => {
          const y1 = marY + (dir === DOWN ? i * lane : -(i * lane));
          points.push({ x: node.toLocalX(X(r)), y: y1, type: EvtType.ROUTESTART, date: r });
          const y2 = marY + (dir === DOWN ? (i + 1) * lane : -((i + 1) * lane));
          points.push({ x: node.toLocalX(X(addYears(r, DELTA))), y: y2, type: EvtType.ROUTEEND, date: r });
        });
      }
      deathY = baseY + (dir === DOWN ? -(endMars.length * lane) : endMars.length * lane);
      if (m.divorced && m.endDate) {
        const dkey = endMars.length === 0 ? m.id : endMars[0].id;
        const refDiv = this.divMap.get(dkey);
        const refRet = this.retMap.get(dkey);
        const refDivX = refDiv ? toLocal(refDiv.x) : Number.NaN;
        const restSpan = refDiv && refRet ? refRet.x - refDiv.x : Number.NaN;
        const divX = endMars.length === 0 && !Number.isNaN(refDivX) ? refDivX : node.toLocalX(X(m.endDate));
        const resX = Number.isNaN(restSpan) ? node.toLocalX(X(addYears(m.endDate, ALPHA))) : divX + restSpan;
        const resY = node.simplified ? deathY + (dir === DOWN ? -GAMMA : GAMMA) : 0;
        points.push({ x: divX, y: deathY, type: EvtType.DIVORCE, date: m.endDate, data: ref });
        points.push({ x: resX, y: resY, type: EvtType.RESTING, date: m.endDate, data: ref });
        deathY = 0;
      }
    }
    if (!node.simplified || deathY !== 0) points.push({ x: deathX, y: deathY, type: EvtType.DEAD, date: deathDate });
    node.points = points;

    // keep x monotonic
    for (let i = 1; i < points.length - 1; i++) {
      const cur = points[i];
      const next = points[i + 1];
      if (cur.type === EvtType.ROUTEEND) {
        if (next.x < cur.x) {
          if (next.type === EvtType.ROUTESTART) {
            points.splice(i, 2);
            i--;
          } else {
            cur.x = next.x;
          }
        }
      } else if (cur.type === EvtType.RESTING && next.type === EvtType.DATING) {
        if (next.x >= cur.x) continue;
        const prev = points[i - 1];
        const nextNext = points[i + 2];
        if (prev && nextNext) {
          if (nextNext.x - prev.x < 2 * this.epsilon) nextNext.x = prev.x + 2 * this.epsilon;
          const mid = (nextNext.x + prev.x) / 2;
          cur.x = next.x = mid;
        }
        i += 2;
      } else {
        const threshold = cur.type === EvtType.BORN || cur.type === EvtType.MARRIAGE || cur.type === EvtType.RESTING ? 0 : this.epsilon;
        if (next.x - cur.x < threshold) next.x = cur.x + threshold;
      }
    }
  }
}

export function isPerson(x: unknown): x is Person {
  return x instanceof Person;
}
