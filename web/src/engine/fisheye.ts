/**
 * Furnas fisheye degree-of-interest over the genealogy's DOI tree.
 * Port of genvis.vis.operator.filter.FisheyeFilter.
 *
 * Focus nodes and the path to the root get DOI 0; DOI decreases by 1 per
 * consanguine hop, by a small fraction for spouses (first spouse highest) and
 * siblings (closest in birth order highest). Nodes farther than `distance` are hidden.
 */
import { type LNode, NodeKind, type Scene } from './scene';

export function applyFisheye(scene: Scene, focusNodes: LNode[], distance: number): void {
  const root = scene.rootNode;
  const divisor = Math.min(1000, scene.nodeMap.size);

  for (const n of scene.nodes) {
    n.doi = -Number.MAX_VALUE;
    n.visible = false;
    n.expanded = false;
  }
  for (const e of scene.edges) {
    e.doi = -Number.MAX_VALUE;
    e.visible = false;
  }

  const setVisible = (n: LNode) => {
    n.visible = true;
    n.expanded = n.doi > -distance;
  };

  const visit = (n: LNode, doi: number, ldist: number) => {
    setVisible(n);
    const localDOI = -ldist / divisor;
    if (n.doi < doi) n.doi = doi + localDOI;
    const spouses = n.person.spouses;
    for (let i = 0; i < spouses.length; i++) {
      const sp = scene.nodeOf(spouses[i]);
      if (!sp) continue;
      setVisible(sp);
      const spDOI = n.doi - (i + 1) / divisor;
      if (sp.doi < spDOI) sp.doi = spDOI;
    }
    const e = n.inEdge;
    if (e) {
      e.doi = n.kind === NodeKind.ANCESTOR ? n.doi - 0.5 : n.doi + 0.5;
      e.visible = e.doi >= -distance;
    }
  };

  const visitDescendants = (p: LNode, skip: LNode | null) => {
    const lidx = skip && skip.parentNode ? skip.parentNode.childNodes.indexOf(skip) : 0;
    p.expanded = p.childNodes.length > 0;
    p.childNodes.forEach((c, i) => {
      if (c === skip) return;
      const doi = Math.trunc(p.doi - 1);
      visit(c, doi, Math.abs(lidx - i));
      if (doi > -distance) visitDescendants(c, null);
    });
  };

  const visitFocus = (n: LNode | null, c: LNode | null) => {
    if (!n || n.doi >= 0) return;
    visit(n, 0, 0);
    if (distance > 0) visitDescendants(n, c);
    if (n !== root) visitFocus(n.parentNode, n);
  };

  for (const f of focusNodes) visitFocus(f, null);
  visitFocus(root, null);

  // spouses are visible only with their partner; edges need both ends
  for (const e of scene.edges) {
    if (!e.child.visible) e.visible = false;
  }
}

/** every node visible (DOI disabled) */
export function showAll(scene: Scene): void {
  for (const n of scene.nodes) {
    n.visible = true;
    n.doi = 0;
  }
  for (const e of scene.edges) e.visible = true;
}
