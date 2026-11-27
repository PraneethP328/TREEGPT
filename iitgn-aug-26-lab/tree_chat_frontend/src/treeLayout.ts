// Tree layout for the tree view (T20): top -> bottom, packed to the left.
//
//   - A card's first child sits straight under it (same x). The tree model puts the main child
//     first, so the main path is a straight line down the left.
//   - Each further child's subtree is moved right only as far as it must to clear the cards already
//     placed that it would touch. So the side branches of a long main line stack in one column
//     beside it, instead of drifting right in a diagonal (each one used to be placed beyond the
//     whole subtree of its sibling, even where they do not meet).
//   - A child's top = its parent's top + the parent's real height + GAP_Y. So a card that grows
//     (a run opened into a list) only pushes its own subtree down.
//   - Real card sizes are used once reactflow has measured them; before that, estimates.
//
// Pure (no React), tested in tests/panel_logic.test.js.

export const CARD_W = 248; // px, every card has this width (index.css .rf-node)
export const GAP_X = 28; // px between cards side by side
export const GAP_Y = 44; // px between a card and its children
export const CLEAR_Y = 18; // px two cards in neighbouring columns keep between them vertically
export const EST_H = 150; // px, height assumed for a card not measured yet

export type LayoutItem = { id: string; parentId: string | null };
export type Size = { width: number; height: number };
type Box = { x: number; y: number; w: number; h: number };
type Placed = { boxes: Box[]; at: Array<[string, number, number]> }; // relative to the subtree's own card

export function layoutTree(
  items: LayoutItem[], // in reading order: a parent before its children, siblings left to right
  sizeOf: (id: string) => Partial<Size> | undefined,
): Map<string, { x: number; y: number }> {
  const ids = new Set(items.map((i) => i.id));
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const it of items) {
    if (it.parentId === null || !ids.has(it.parentId)) {
      roots.push(it.id);
      continue;
    }
    if (!kids.has(it.parentId)) kids.set(it.parentId, []);
    kids.get(it.parentId)!.push(it.id);
  }
  const w = (id: string) => {
    const v = sizeOf(id)?.width;
    return v && v > 0 ? v : CARD_W;
  };
  const h = (id: string) => {
    const v = sizeOf(id)?.height;
    return v && v > 0 ? v : EST_H;
  };

  // How far right `sub` (whose boxes start at dy) must move to clear every box in `placed`.
  const shiftToClear = (placed: Box[], sub: Box[], dy: number): number => {
    let dx = 0;
    for (const b of sub) {
      const top = b.y + dy;
      for (const p of placed) {
        if (top < p.y + p.h + CLEAR_Y && p.y < top + b.h + CLEAR_Y) dx = Math.max(dx, p.x + p.w + GAP_X - b.x);
      }
    }
    return dx;
  };

  // Children are laid out before their parents by walking the items backwards (a parent always
  // comes before its children), so no recursion is needed however deep the tree is.
  const done = new Map<string, Placed>();
  for (let i = items.length - 1; i >= 0; i--) {
    const id = items[i].id;
    const boxes: Box[] = [{ x: 0, y: 0, w: w(id), h: h(id) }];
    const at: Array<[string, number, number]> = [[id, 0, 0]];
    const dy = h(id) + GAP_Y;
    const below: Box[] = []; // the children's subtrees placed so far
    for (const c of kids.get(id) ?? []) {
      const sub = done.get(c);
      if (!sub) continue;
      const dx = shiftToClear(below, sub.boxes, dy);
      for (const b of sub.boxes) below.push({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
      for (const [cid, x, y] of sub.at) at.push([cid, x + dx, y + dy]);
      done.delete(c); // merged into its parent
    }
    boxes.push(...below);
    done.set(id, { boxes, at });
  }

  const pos = new Map<string, { x: number; y: number }>();
  const all: Box[] = [];
  for (const r of roots) {
    const sub = done.get(r);
    if (!sub) continue;
    const dx = shiftToClear(all, sub.boxes, 0);
    for (const b of sub.boxes) all.push({ ...b, x: b.x + dx });
    for (const [id, x, y] of sub.at) pos.set(id, { x: x + dx, y });
  }
  return pos;
}
