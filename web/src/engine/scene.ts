/**
 * Scene graph: nodes (one per lifeline), local blocks (people connected by marriage)
 * and birth edges (drop lines).
 * Port of genvis.vis.data.{Data, NodeSprite, BlockSprite, EdgeSprite}.
 */
import { type Genealogy, type LifeEvent, Marriage, Person } from '../model/genealogy';

export const EvtType = {
  BORN: 0,
  DATING: 1,
  MARRIAGE: 2,
  DIVORCE: 3,
  RESTING: 4,
  DEAD: 5,
  ROUTESTART: 6,
  ROUTEEND: 7,
} as const;
export type EvtType = (typeof EvtType)[keyof typeof EvtType];

/** An event point of a lifeline, in the node's local coordinates. */
export interface EvtPt {
  x: number;
  y: number;
  type: EvtType;
  date: Date | null;
  data?: Marriage | Person | null;
}

export const NodeKind = { ROOT: 0, ANCESTOR: 1, DESCENDANT: 2, SPOUSE: 3, UNDETERMINED: 4 } as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const BlockKind = { ROOT: 0, ANCESTOR: 1, DESCENDANT: 2, UNDETERMINED: 4 } as const;
export type BlockKind = (typeof BlockKind)[keyof typeof BlockKind];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const boxHeight = (b: Box) => b.maxY - b.minY;

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** y of a segment at x, NaN when x is outside the segment */
function intersectLineX(l: Segment, x: number): number {
  const minX = Math.min(l.x1, l.x2);
  const maxX = Math.max(l.x1, l.x2);
  if (x < minX || x > maxX) return Number.NaN;
  if (l.x2 === l.x1) return l.y1;
  return l.y1 + ((l.y2 - l.y1) * (x - l.x1)) / (l.x2 - l.x1);
}

export class LNode {
  readonly person: Person;
  kind: NodeKind = NodeKind.UNDETERMINED;
  /** x relative to the block, y relative to the block */
  x = 0;
  y = 0;
  points: EvtPt[] = [];
  bbox: Box | null = null;
  lines: Segment[] = [];
  block!: Block;
  doi = -Number.MAX_VALUE;
  visible = true;
  simplified = false;
  expanded = false;
  /** DOI tree: parents and children of an hourglass person; the tree's root is the chart's root */
  childNodes: LNode[] = [];
  parentNode: LNode | null = null;
  pseudoParents: LNode[] = [];
  inEdge: Edge | null = null;
  outEdges: Edge[] = [];

  constructor(person: Person) {
    this.person = person;
  }

  toGlobalX(lx = 0): number {
    return lx + this.x + this.block.x;
  }
  toGlobalY(ly = 0): number {
    return ly + this.y + this.block.ty;
  }
  toLocalX(gx: number): number {
    return gx - (this.x + this.block.x);
  }
  toLocalY(gy: number): number {
    return gy - (this.y + this.block.ty);
  }

  addChildNode(c: LNode): void {
    if (!this.childNodes.includes(c)) this.childNodes.push(c);
  }

  calcBBox(labelOutside: boolean, lineWidth: number, labelHeight: number): Box | null {
    if (this.points.length === 0) {
      this.bbox = null;
      this.lines = [];
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    this.lines = [];
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      this.lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    if (labelOutside) {
      minY = Math.min(minY, -labelHeight);
    } else {
      minY -= lineWidth / 2;
    }
    maxY += lineWidth / 2;
    this.bbox = { minX, minY, maxX, maxY };
    return this.bbox;
  }

  /** global y of the lifeline at global x */
  Y(gx: number): number {
    if (this.lines.length === 0) return Number.NaN;
    const lx = this.toLocalX(gx);
    for (const l of this.lines) {
      const ly = intersectLineX(l, lx);
      if (!Number.isNaN(ly)) return this.toGlobalY(ly);
    }
    return Number.NaN;
  }

  visit(fn: (n: LNode) => void, seen = new Set<LNode>()): void {
    if (seen.has(this)) return;
    seen.add(this);
    fn(this);
    for (const c of this.childNodes) c.visit(fn, seen);
  }
}

export class Block {
  primaryNodes: LNode[] = [];
  secondaryNodes: LNode[] = [];
  nodes: LNode[] = [];
  focus!: LNode;
  min: Date | null = null;
  max: Date | null = null;
  x = 0;
  ty = 0;
  bbox: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  parentBlock: Block | null = null;
  pseudoParents: Block[] = [];
  childBlocks: Block[] = [];
  type: BlockKind = BlockKind.UNDETERMINED;
  aggregated = false;
  visited = false;

  get visible(): boolean {
    return this.aggregated || this.focus.visible;
  }

  addChildBlock(c: Block): void {
    if (c !== this && !this.childBlocks.includes(c)) this.childBlocks.push(c);
  }

  addNode(n: LNode): void {
    if (this.nodes.includes(n)) return;
    if (n.kind === NodeKind.SPOUSE) this.secondaryNodes.push(n);
    else if (n.kind !== NodeKind.UNDETERMINED) this.primaryNodes.push(n);
    this.nodes.push(n);
    if (!this.focus) this.focus = n;
    n.block = this;
    const p = n.person;
    const end = p.endOfLife;
    if (p.dateOfBirth && (!this.min || p.dateOfBirth < this.min)) this.min = p.dateOfBirth;
    if (!this.max || end > this.max) this.max = end;
  }

  static union(b1: Block | null, b2: Block | null): Block | null {
    if (!b1) return b2;
    if (!b2) return b1;
    const nb = new Block();
    for (const src of [b1, b2]) {
      for (const n of [...src.primaryNodes].reverse()) nb.addNode(n);
      for (const n of [...src.secondaryNodes].reverse()) nb.addNode(n);
    }
    nb.type = b1.type === BlockKind.ROOT ? b1.type : b2.type === BlockKind.ROOT ? b2.type : b1.type;
    return nb;
  }

  toGlobalX(lx: number): number {
    return lx + this.x;
  }
  toGlobalY(ly: number): number {
    return ly + this.ty;
  }
  toLocalX(gx: number): number {
    return gx - this.x;
  }
  toLocalY(gy: number): number {
    return gy - this.ty;
  }

  intersect(b: Block): boolean {
    const a1 = this.bbox;
    const a2 = b.bbox;
    return (
      this.toGlobalX(a1.minX) < b.toGlobalX(a2.maxX) &&
      this.toGlobalX(a1.maxX) > b.toGlobalX(a2.minX) &&
      this.toGlobalY(a1.minY) < b.toGlobalY(a2.maxY) &&
      this.toGlobalY(a1.maxY) > b.toGlobalY(a2.minY)
    );
  }

  /** focus and its spouses, the latest spouse first */
  private displayList(nodeOf: (p: Person) => LNode | undefined): LNode[] {
    const list: LNode[] = [this.focus];
    const spouses = this.focus.person.spouses;
    for (let i = spouses.length - 1; i >= 0; i--) {
      const n = nodeOf(spouses[i]);
      if (n) list.push(n);
    }
    return list;
  }

  /**
   * Simplify the least interesting lifeline of the block (spouses before the focus);
   * aggregate the block when everything is simplified. Returns false when nothing changed.
   * NB: the original sorted by DOI *descending* although its comment says "lowest first";
   * we follow the comment (and the paper's Figure 11).
   */
  simplify(nodeOf: (p: Person) => LNode | undefined): boolean {
    const list = this.displayList(nodeOf).sort((a, b) => a.doi - b.doi);
    let ret = false;
    for (const n of list) {
      if (!n.simplified) {
        n.simplified = true;
        ret = true;
        break;
      }
    }
    if (list.every((n) => n.simplified)) this.aggregated = true;
    return ret;
  }

  desimplify(nodeOf: (p: Person) => LNode | undefined): boolean {
    this.aggregated = false;
    const list = this.displayList(nodeOf).sort((a, b) => b.doi - a.doi);
    for (const n of list) {
      if (n.simplified) {
        n.simplified = false;
        return true;
      }
    }
    return false;
  }

  calcBBox(): Box {
    if (this.aggregated) return (this.bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      const b = n.bbox;
      if (!b) continue;
      minX = Math.min(minX, b.minX + n.x);
      maxX = Math.max(maxX, b.maxX + n.x);
      minY = Math.min(minY, b.minY + n.y);
      maxY = Math.max(maxY, b.maxY + n.y);
    }
    if (minX === Infinity) return (this.bbox = { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    if (minY !== 0) {
      // block origin = top of its bounding box
      for (const n of this.nodes) n.y -= minY;
      maxY -= minY;
      minY = 0;
    }
    return (this.bbox = { minX, minY, maxX, maxY });
  }

  /** pre-order */
  visit(fn: (b: Block) => void, seen = new Set<Block>()): void {
    if (seen.has(this)) return;
    seen.add(this);
    fn(this);
    for (const c of this.childBlocks) c.visit(fn, seen);
  }

  /** in-order traversal of an ancestor tree; forward = male side first */
  visitInOrder(fn: (b: Block) => void, forward = true, seen = new Set<Block>()): void {
    if (seen.has(this)) return;
    seen.add(this);
    const cbs = this.childBlocks;
    if (cbs.length >= 2) {
      (forward ? cbs[0] : cbs[1]).visitInOrder(fn, forward, seen);
      fn(this);
      (forward ? cbs[1] : cbs[0]).visitInOrder(fn, forward, seen);
      for (const extra of cbs.slice(2)) extra.visitInOrder(fn, forward, seen);
    } else if (cbs.length === 1) {
      const cb = cbs[0];
      const sex = cb.focus.parentNode?.person.sex;
      const first = forward ? 'Male' : 'Female';
      if (sex === first) cb.visitInOrder(fn, forward, seen);
      fn(this);
      if (sex !== first) cb.visitInOrder(fn, forward, seen);
    } else {
      fn(this);
    }
  }
}

export class Edge {
  readonly parents: LNode[];
  readonly child: LNode;
  visible = true;
  doi = -Number.MAX_VALUE;

  constructor(father: LNode | null, mother: LNode | null, child: LNode) {
    this.parents = [];
    if (father) {
      this.parents.push(father);
      father.outEdges.push(this);
    }
    if (mother) {
      this.parents.push(mother);
      mother.outEdges.push(this);
    }
    this.child = child;
    child.inEdge = this;
  }

  /** born outside of the parents' marriage */
  get outOfWedlock(): boolean {
    const p = this.child.person;
    const f = p.father;
    const m = p.mother;
    if (!f || !m || !p.dateOfBirth) return false;
    for (const mar of f.marriageWith(m)) {
      if (mar.startDate && p.dateOfBirth >= mar.startDate && (!mar.divorced || (mar.endDate && p.dateOfBirth < mar.endDate))) {
        return false;
      }
    }
    return true;
  }
}

/** The chart for one root person: its ancestors, its descendants and all their spouses. */
export class Scene {
  readonly root: Person;
  readonly nodeMap = new Map<Person, LNode>();
  readonly blocks: Block[] = [];
  readonly edges: Edge[] = [];
  readonly events: LifeEvent[];
  readonly marriages: Marriage[] = [];

  constructor(root: Person, genealogy: Genealogy) {
    this.root = root;
    this.events = genealogy.events;
    this.constructNodes();
    this.constructEdges();
    this.constructDOITree();
    this.constructBlocks();
  }

  get nodes(): LNode[] {
    return [...this.nodeMap.values()];
  }

  nodeOf = (p: Person): LNode | undefined => this.nodeMap.get(p);

  get rootNode(): LNode {
    return this.nodeMap.get(this.root)!;
  }

  private ensure(p: Person): LNode {
    let n = this.nodeMap.get(p);
    if (!n) {
      n = new LNode(p);
      this.nodeMap.set(p, n);
    }
    return n;
  }

  private constructNode(p: Person, kind: NodeKind): void {
    const n = this.ensure(p);
    n.kind = kind;
    for (const s of p.spouses) {
      const sn = this.ensure(s);
      if (sn.kind === NodeKind.UNDETERMINED) sn.kind = NodeKind.SPOUSE;
    }
    for (const m of p.marriages) if (!this.marriages.includes(m)) this.marriages.push(m);
  }

  private constructNodes(): void {
    this.constructNode(this.root, NodeKind.ROOT);
    this.root.visitAncestors((p) => this.constructNode(p, NodeKind.ANCESTOR));
    this.root.visitDescendants((p) => {
      if (this.nodeMap.get(p)?.kind === NodeKind.ANCESTOR) return;
      this.constructNode(p, NodeKind.DESCENDANT);
    });
  }

  private hourglass(): Person[] {
    const list: Person[] = [this.root];
    this.root.visitAncestors((p) => list.push(p));
    this.root.visitDescendants((p) => list.push(p));
    return list;
  }

  private constructEdges(): void {
    for (const p of this.hourglass()) {
      const f = p.father ? this.nodeMap.get(p.father) ?? null : null;
      const m = p.mother ? this.nodeMap.get(p.mother) ?? null : null;
      const c = this.nodeMap.get(p);
      if (c && !c.inEdge) this.edges.push(new Edge(f, m, c));
    }
  }

  private link(parent: LNode, child: LNode): void {
    parent.addChildNode(child);
    if (child.parentNode == null && child !== parent) child.parentNode = parent;
    else if (child.parentNode !== parent && !child.pseudoParents.includes(parent)) child.pseudoParents.push(parent);
  }

  /** DOI tree rooted at the chart's root: up through parents, down through children */
  private constructDOITree(): void {
    const root = this.rootNode;
    for (const parent of this.root.parents) this.link(root, this.nodeMap.get(parent)!);
    for (const child of this.root.children) this.link(root, this.nodeMap.get(child)!);
    this.root.visitAncestors((p) => {
      for (const parent of p.parents) this.link(this.nodeMap.get(p)!, this.nodeMap.get(parent)!);
    });
    this.root.visitDescendants((p) => {
      for (const child of p.children) this.link(this.nodeMap.get(p)!, this.nodeMap.get(child)!);
    });
  }

  private blockOf = new Map<LNode, Block>();

  private constructBlock(p: Person, type: BlockKind): void {
    const pn = this.nodeMap.get(p)!;
    const existing: Block[] = [];
    let nb = this.blockOf.get(pn) ?? new Block();
    nb.type = type;
    nb.addNode(pn);
    for (const s of p.spouses) {
      const sn = this.nodeMap.get(s);
      if (!sn) continue;
      const sb = this.blockOf.get(sn);
      if (sb && sb !== nb) {
        if (!existing.includes(sb)) existing.push(sb);
      } else {
        nb.addNode(sn);
      }
    }
    let union: Block | null = null;
    for (const b of existing) {
      union = Block.union(union, b);
      const idx = this.blocks.indexOf(b);
      if (idx >= 0) this.blocks.splice(idx, 1);
    }
    const prev = nb;
    nb = Block.union(union, nb)!;
    if (nb !== prev) {
      const idx = this.blocks.indexOf(prev);
      if (idx >= 0) this.blocks.splice(idx, 1);
    }
    for (const n of nb.nodes) this.blockOf.set(n, nb);
    if (!this.blocks.includes(nb)) this.blocks.push(nb);
  }

  private constructBlocks(): void {
    this.constructBlock(this.root, BlockKind.ROOT);
    this.root.visitAncestors((p) => this.constructBlock(p, BlockKind.ANCESTOR));
    this.root.visitDescendants((p) => {
      if (this.nodeMap.get(p)?.kind === NodeKind.ANCESTOR) return;
      this.constructBlock(p, BlockKind.DESCENDANT);
    });
    // block tree: descendants youngest to oldest, ancestors male side then female side
    this.rootNode.visit((n) => {
      for (const c of n.childNodes) {
        if (n.block === c.block || n.block.childBlocks.includes(c.block)) continue;
        n.block.addChildBlock(c.block);
        if (c.block.parentBlock == null) c.block.parentBlock = n.block;
        else if (!c.block.pseudoParents.includes(n.block)) c.block.pseudoParents.push(n.block);
      }
    });
  }
}
