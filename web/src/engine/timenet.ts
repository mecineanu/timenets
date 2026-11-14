/**
 * Facade: estimation + scene + fisheye + layout + render model.
 * Plays the role of genvis.GenVis (without the Flash UI).
 */
import { estimate } from '../model/estimator';
import type { Genealogy, Person } from '../model/genealogy';
import { applyFisheye, showAll } from './fisheye';
import { TimeNetLayout } from './layout';
import type { LabelStyle } from './lifeline';
import { type CurveStyle, type RenderModel, buildRenderModel } from './render';
import { type LNode, Scene } from './scene';

export interface ViewOptions {
  doiEnabled: boolean;
  doiDistance: number;
  labelStyle: LabelStyle;
  curveStyle: CurveStyle;
  fitHorzBound: boolean;
  xrange: number;
}

export const DEFAULT_OPTIONS: ViewOptions = {
  doiEnabled: false,
  doiDistance: 2,
  labelStyle: 'inside',
  curveStyle: 'curved',
  fitHorzBound: true,
  xrange: 90,
};

export interface ViewState {
  rootId: string;
  /** most recently selected person: centre of the view, time window */
  focusId: string;
  /** persistent foci (ctrl-click), DOI mode only */
  pinnedIds: string[];
}

export interface ComputedView {
  model: RenderModel;
  layout: TimeNetLayout;
  scene: Scene;
  warnings: string[];
}

/** number of people in a person's hourglass chart */
export function hourglassSize(p: Person): number {
  let n = 1;
  p.visitAncestors(() => n++);
  p.visitDescendants(() => n++);
  return n;
}

export function defaultRoot(g: Genealogy): Person | undefined {
  if (g.rootId) {
    const r = g.people.find((p) => p.id === g.rootId);
    if (r) return r;
  }
  let best: Person | undefined;
  let bestSize = -1;
  for (const p of g.people) {
    const s = hourglassSize(p);
    if (s > bestSize) {
      best = p;
      bestSize = s;
    }
  }
  return best;
}

const estimated = new WeakMap<Person, string[]>();

export function computeView(
  g: Genealogy,
  state: ViewState,
  opts: ViewOptions,
  size: { width: number; height: number },
): ComputedView | null {
  const byId = new Map(g.people.map((p) => [p.id, p]));
  const root = byId.get(state.rootId);
  if (!root) return null;
  if (!estimated.has(root)) estimated.set(root, estimate(root).warnings);
  const warnings = estimated.get(root)!;

  const scene = new Scene(root, g);
  const focusNode: LNode = scene.nodeOf(byId.get(state.focusId) ?? root) ?? scene.rootNode;

  if (opts.doiEnabled) {
    const foci = state.pinnedIds
      .map((id) => byId.get(id))
      .map((p) => (p ? scene.nodeOf(p) : undefined))
      .filter((n): n is LNode => Boolean(n));
    if (!foci.includes(focusNode)) foci.push(focusNode);
    applyFisheye(scene, foci, opts.doiDistance);
  } else {
    showAll(scene);
  }

  const layout = new TimeNetLayout({
    width: size.width,
    height: size.height,
    doiEnabled: opts.doiEnabled,
    labelStyle: opts.labelStyle,
    fitHorzBound: opts.fitHorzBound,
    xrange: opts.xrange,
    padding: 24,
  });
  layout.run(scene, focusNode);
  return { model: buildRenderModel(scene, layout, opts.curveStyle), layout, scene, warnings };
}
