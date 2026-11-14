/**
 * Global TimeNets layout: time scale, local block layout, hourglass placement of blocks,
 * DOI-driven simplification to fit the screen, event placement.
 * Port of genvis.vis.operator.layout.LifelineLayout.
 */
import { NOW, type Person } from '../model/genealogy';
import { type LabelStyle, Lifeline } from './lifeline';
import { type Block, BlockKind, type LNode, type Scene } from './scene';

export interface LayoutOptions {
  width: number;
  height: number;
  doiEnabled: boolean;
  labelStyle: LabelStyle;
  /** fit the time axis to everybody (true) or show `xrange` years around the focus */
  fitHorzBound: boolean;
  xrange: number;
  /** horizontal padding of the time axis, in pixels */
  padding: number;
}

/** vertical gap between blocks */
export const GAP = 5;

export interface PlacedEventPoint {
  person: Person;
  x: number;
  y: number;
}

export class TimeNetLayout {
  readonly lifeline: Lifeline;
  readonly opts: LayoutOptions;
  xMin = NOW;
  xMax = NOW;
  /** bounds of the visible blocks after layout */
  yMin = 0;
  yMax = 0;

  constructor(opts: LayoutOptions) {
    this.opts = opts;
    this.lifeline = new Lifeline(opts.labelStyle);
    this.lifeline.X = (d) => this.X(d);
  }

  X(d: Date): number {
    const span = this.xMax.getTime() - this.xMin.getTime() || 1;
    const w = this.opts.width - 2 * this.opts.padding;
    return this.opts.padding + ((d.getTime() - this.xMin.getTime()) / span) * w;
  }

  dateAt(x: number): Date {
    const span = this.xMax.getTime() - this.xMin.getTime();
    const w = this.opts.width - 2 * this.opts.padding;
    return new Date(this.xMin.getTime() + ((x - this.opts.padding) / w) * span);
  }

  buildScale(scene: Scene, recentFocus: LNode): void {
    if (!this.opts.fitHorzBound) {
      const p = recentFocus.person;
      const birth = p.dateOfBirth ?? NOW;
      const median = birth.getFullYear() + (p.endOfLife.getFullYear() - birth.getFullYear()) / 2;
      this.xMin = new Date(median - this.opts.xrange / 2, 0, 1);
      this.xMax = new Date(median + this.opts.xrange / 2, 0, 1);
      return;
    }
    let min: Date | null = null;
    let max: Date | null = null;
    for (const n of scene.nodes) {
      const p = n.person;
      if (p.dateOfBirth && (!min || p.dateOfBirth < min)) min = p.dateOfBirth;
      const end = p.endOfLife;
      if (!max || end > max) max = end;
    }
    this.xMin = min ?? NOW;
    this.xMax = max ?? NOW;
  }

  /** runs the whole layout; visibility (fisheye) must have been computed before */
  run(scene: Scene, recentFocus: LNode, yPan = 0): void {
    this.lifeline.curDate = NOW;
    this.buildScale(scene, recentFocus);
    const displayNodes: LNode[] = [];
    const displayBlocks: Block[] = [];

    if (this.opts.doiEnabled) {
      for (const n of scene.nodes) {
        if (n.visible) {
          displayNodes.push(n);
          n.simplified = false;
        }
      }
      for (const b of scene.blocks) {
        if (b.focus.visible) {
          b.aggregated = false;
          displayBlocks.push(b);
        } else if (b.parentBlock && b.parentBlock.focus.visible) {
          // collapsed block: keep a stub (information scent)
          while (b.simplify(scene.nodeOf));
          b.aggregated = true;
          displayBlocks.push(b);
        } else {
          b.aggregated = false;
        }
      }
    } else {
      for (const n of scene.nodes) {
        n.visible = true;
        n.simplified = false;
        displayNodes.push(n);
      }
      for (const b of scene.blocks) {
        b.aggregated = false;
        displayBlocks.push(b);
      }
    }

    // horizontal positioning of blocks, then local layout
    for (const b of displayBlocks) b.x = b.min ? this.X(b.min) : 0;
    for (const b of displayBlocks) this.lifeline.layout(b, scene);

    this.verticalPositioning(scene, displayNodes, recentFocus, yPan);
  }

  private verticalPositioning(scene: Scene, displayNodes: LNode[], recentFocus: LNode, yPan: number): void {
    this.verticalLayout(scene);
    let offset: number;
    if (this.opts.doiEnabled) {
      offset = -this.fitLayoutToScreen(scene, displayNodes);
    } else {
      // The original put the focus block at mid-height. We centre the whole chart when it
      // fits, and otherwise centre the focus lifeline without leaving empty space at the edges.
      const H = this.opts.height;
      const { top, bottom } = this.computeBounds(scene);
      if (bottom - top <= H) {
        offset = (H - (bottom - top)) / 2 - top;
      } else {
        offset = H / 2 - recentFocus.toGlobalY(0);
        offset = Math.max(H - bottom, Math.min(-top, offset));
      }
      offset += yPan;
    }
    for (const b of scene.blocks) b.ty += offset;
    this.computeBounds(scene);
  }

  private computeBounds(scene: Scene): { top: number; bottom: number } {
    let top = Number.MAX_VALUE;
    let bottom = -Number.MAX_VALUE;
    for (const b of scene.blocks) {
      if (!b.visible) continue;
      top = Math.min(top, b.ty);
      bottom = Math.max(bottom, b.ty + b.bbox.maxY - b.bbox.minY);
    }
    if (top === Number.MAX_VALUE) top = bottom = 0;
    this.yMin = top;
    this.yMax = bottom;
    return { top, bottom };
  }

  /**
   * Simplify blocks of the least interesting people, leaves first, until the
   * chart fits the screen height. Returns the top of the layout.
   */
  private fitLayoutToScreen(scene: Scene, displayNodes: LNode[]): number {
    let { top, bottom } = this.computeBounds(scene);
    let newHeight = bottom - top;
    const bound = this.opts.height;
    const nodes = [...displayNodes].sort((a, b) => a.doi - b.doi);
    const reverted: LNode[] = [];
    let idx = 0;
    const relayout = (n: LNode) => {
      this.lifeline.layout(n.block, scene);
      this.verticalLayout(scene);
      ({ top, bottom } = this.computeBounds(scene));
      return bottom - top;
    };
    let guard = 0;
    while (newHeight > bound && idx < nodes.length && guard++ < 10000) {
      const prevHeight = newHeight;
      const n = nodes[idx++];
      if (n.simplified) continue;
      const simplifiable = n.childNodes.every((c) => c.block.aggregated || !c.block.visible || c.block === n.block);
      if (!simplifiable) {
        idx--;
        let progressed = false;
        for (let i = 0; i < reverted.length; i++) {
          const r = reverted[i];
          r.block.simplify(scene.nodeOf);
          const h = relayout(r);
          if (h >= newHeight) {
            r.block.desimplify(scene.nodeOf);
            relayout(r);
          } else {
            newHeight = h;
            reverted.splice(i, 1);
            i--;
            progressed = true;
            if (newHeight <= bound) break;
          }
        }
        if (!progressed) idx++; // the original could loop forever here
        continue;
      }
      n.block.simplify(scene.nodeOf);
      const h = relayout(n);
      if (h >= prevHeight) {
        newHeight = prevHeight;
        n.block.desimplify(scene.nodeOf);
        relayout(n);
        reverted.push(n);
      } else {
        newHeight = h;
      }
    }
    return this.computeBounds(scene).top;
  }

  /**
   * Hourglass placement without overlaps:
   * root at 0; descendants below in pre-order (youngest child first);
   * mother's ancestors above; father's ancestors share the root's band (they are
   * to its left in time) unless they collide with the root, in which case they are
   * pushed above ("rollback").
   */
  verticalLayout(scene: Scene): void {
    for (const b of scene.blocks) if (b.visible) b.visited = false;
    const root = scene.rootNode.block;
    const h = (b: Block) => b.bbox.maxY - b.bbox.minY;
    root.ty = 0;
    let y = h(root) + GAP;

    // descendants first, so that the father's ancestors can be checked against them too
    // (the original only checked the root block and could overlap with descendants)
    const placed: Block[] = [root];
    for (const cb of root.childBlocks) {
      if (cb.type !== BlockKind.DESCENDANT) continue;
      cb.visit((b) => {
        if (!b.visible || b.visited) return;
        b.visited = true;
        b.ty = y;
        y += h(b) + GAP;
        placed.push(b);
      });
    }
    y = 0;

    for (const cb of root.childBlocks) {
      if (cb.type !== BlockKind.ANCESTOR || cb.visited) continue;
      cb.visited = true;
      cb.ty = -(root.bbox.minY + h(cb) + GAP);
      for (let i = cb.childBlocks.length - 1; i >= 0; i--) {
        const db = cb.childBlocks[i];
        if (db.focus.parentNode?.person.sex !== 'Male') continue;
        const prevBlocks: Block[] = [cb];
        y = -root.bbox.minY;
        db.visitInOrder((b) => {
          if (!b.visible || b.visited) return;
          b.visited = true;
          prevBlocks.push(b);
          b.ty = y;
          if (placed.some((pb) => b.intersect(pb))) {
            let newY = -root.bbox.minY;
            for (const pb of [...prevBlocks].reverse()) {
              newY -= h(pb) + GAP;
              pb.ty = newY;
            }
            y = -root.bbox.minY;
          } else {
            y += h(b) + GAP;
          }
        }, false);
      }
      for (let i = cb.childBlocks.length - 1; i >= 0; i--) {
        const db = cb.childBlocks[i];
        if (db.focus.parentNode?.person.sex === 'Male') continue;
        y = cb.ty - GAP;
        db.visitInOrder((b) => {
          if (!b.visible || b.visited) return;
          b.visited = true;
          y -= h(b) + GAP;
          b.ty = y;
        }, true);
      }
    }
  }

  /** positions of personal events on the lifelines of the people involved */
  placeEvent(scene: Scene, date: Date, people: Person[]): PlacedEventPoint[] {
    const x = this.X(date);
    const out: PlacedEventPoint[] = [];
    for (const p of people) {
      const n = scene.nodeOf(p);
      if (!n || !n.visible || n.simplified || !n.block.visible || n.block.aggregated) continue;
      const y = n.Y(x);
      if (Number.isFinite(y)) out.push({ person: p, x, y });
    }
    return out;
  }
}
