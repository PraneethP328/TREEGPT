// What the tree view draws (T20). A long chat is mostly straight lines of messages with a few
// branch points, so drawing every message as a card makes a 300-message chat unreadable. Only the
// messages that carry structure get a card; a straight run of messages between them becomes ONE
// "run" item (a card with a scrollable list inside), and whole branches can be folded.
//
// Always its own card:
//   - the first message of the tree (root);
//   - a branch point (2 or more children) and a leaf (no children);
//   - the message the chat is showing (activeId);
//   - the first message of a FOLDED branch (it stands for everything hidden below it).
// Everything else is a "plain" message (exactly one child). RUN_MIN or more plain messages in a
// row become one run; fewer stay as cards. An open branch's first message starts its run (the run
// card names it in its "from" line), which saves one card per branch.
//
// Folded side branches do not break a run: a branch point whose side branches (every child but the
// first, the main one) are ALL folded joins the run around it, and the run carries those branches
// ("tucked", shown as "3 side branches" on the run card). So a long path with a side branch every
// few messages still folds into one run. Such a branch point keeps its own card when a full run
// (RUN_MIN plain messages) sits on both sides of it anyway, and a lone one between short stretches
// stays a card too: a run needs RUN_MIN plain messages, or two or more such branch points.
// A side branch on the path on screen is never folded, so that path is never hidden.
//
// Pure (no React, no runtime imports), so it is tested in tests/panel_logic.test.js.
import type { TreeNode } from "./types";

export const RUN_MIN = 3; // a run needs at least this many plain messages in a row

export type VisNode = {
  kind: "node";
  id: string;
  parentId: string | null; // the visible item above it
  node: TreeNode;
  /** Can be folded: a branch's first message that has something below it. */
  foldable: boolean;
  /** Folded now: what is hidden below it. */
  hidden: { messages: number; branches: number } | null;
  /** Number of branches starting at this message (0 or 1 = not a branch point). */
  branchCount: number;
};
export type VisRun = {
  kind: "run";
  id: string; // "run:<first message id>"
  parentId: string | null;
  nodes: TreeNode[]; // oldest first
  open: boolean;
  /** Set when the run starts a branch: folding it (by this id) hides the branch. */
  foldId: string | null;
  /** Folded side branches tucked into the run: each one's first message, and the row it hangs from. */
  tucked: Array<{ id: string; at: string }>;
  /** Messages in the tucked side branches (hidden). */
  tuckedMessages: number;
};
export type VisItem = VisNode | VisRun;

export type TreeIndex = {
  byId: Map<string, TreeNode>;
  /** Children per parent: the main child first, then oldest first. */
  kids: Map<string, TreeNode[]>;
  root: TreeNode | null;
};

export function indexTree(nodes: TreeNode[], rootId: string | null): TreeIndex {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (n.parentId === null || !byId.has(n.parentId)) continue;
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId)!.push(n);
  }
  for (const [pid, list] of kids) {
    const main = byId.get(pid)?.mainChildId ?? null;
    list.sort((a, b) => (a.id === main ? -1 : b.id === main ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0)));
  }
  const root = (rootId ? byId.get(rootId) : null) ?? nodes.find((n) => n.parentId === null || !byId.has(n.parentId)) ?? null;
  return { byId, kids, root };
}

/** The tree's single main path: root, then each node's main child, down to a leaf. */
export function mainPathOf(index: TreeIndex): Set<string> {
  const out = new Set<string>();
  let cur = index.root;
  while (cur && !out.has(cur.id)) {
    out.add(cur.id);
    cur = cur.mainChildId ? index.byId.get(cur.mainChildId) ?? null : null;
  }
  return out;
}

const kidsOf = (index: TreeIndex, id: string) => index.kids.get(id) ?? [];

/** First messages of branches (children of a branch point) that have something below them, and
 *  one-message side branches (no fold control of their own: folded, they can only be tucked into
 *  the run beside them). */
export function foldableIds(index: TreeIndex): string[] {
  const out: string[] = [];
  for (const [pid, list] of index.kids) {
    if (list.length < 2 || !index.byId.has(pid)) continue;
    list.forEach((c, i) => {
      if (i > 0 || kidsOf(index, c.id).length) out.push(c.id);
    });
  }
  return out;
}

/** "Focus my path": fold every branch that is not on the path the chat is showing. */
export function foldAllBut(index: TreeIndex, keep: Set<string>): Set<string> {
  return new Set(foldableIds(index).filter((id) => !keep.has(id)));
}

function countBelow(index: TreeIndex, id: string): { messages: number; branches: number } {
  let messages = 0;
  let branches = 0;
  const stack = [...kidsOf(index, id)];
  const seen = new Set<string>([id]);
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue; // never loop on damaged data
    seen.add(n.id);
    messages += 1;
    const k = kidsOf(index, n.id);
    if (!k.length) branches += 1;
    stack.push(...k);
  }
  return { messages, branches };
}

export type VisibleOptions = {
  rootId: string | null;
  /** The message the chat is showing (the last one of the path on screen), or null. */
  activeId: string | null;
  /** Every message of the path on screen: it is never hidden by a fold. */
  activePath: Set<string>;
  folded: Set<string>;
  openRuns: Set<string>;
};

export function buildVisible(nodes: TreeNode[], opts: VisibleOptions): VisItem[] {
  const index = indexTree(nodes, opts.rootId);
  const items: VisItem[] = [];
  if (!index.root) return items;
  const seen = new Set<string>();

  // A branch's first message (a child of a branch point) with something below it can be folded.
  const isFoldable = (n: TreeNode): boolean => {
    const parent = n.parentId ? index.byId.get(n.parentId) : null;
    return !!parent && kidsOf(index, parent.id).length >= 2 && kidsOf(index, n.id).length > 0;
  };
  // Folded now? The path on screen is never hidden: a fold on it is ignored.
  const isFolded = (n: TreeNode): boolean =>
    isFoldable(n) && opts.folded.has(n.id) && !kidsOf(index, n.id).some((k) => opts.activePath.has(k.id));

  // A branch point whose side branches are all folded (none on the path on screen) can join a run.
  const isTucking = (n: TreeNode): boolean => {
    const k = kidsOf(index, n.id);
    return k.length >= 2 && k.slice(1).every((c) => opts.folded.has(c.id) && !opts.activePath.has(c.id) && c.id !== opts.activeId);
  };
  const isStructural = (n: TreeNode): boolean => {
    if (n.id === index.root!.id || n.id === opts.activeId || isFolded(n)) return true;
    const k = kidsOf(index, n.id).length;
    return k !== 1 && !(k >= 2 && isTucking(n));
  };
  const isPlain = (n: TreeNode) => kidsOf(index, n.id).length === 1;

  const emitNode = (n: TreeNode, parentId: string | null): boolean => {
    const kids = kidsOf(index, n.id);
    const folded = isFolded(n);
    items.push({ kind: "node", id: n.id, parentId, node: n, foldable: isFoldable(n), hidden: folded ? countBelow(index, n.id) : null, branchCount: kids.length >= 2 ? kids.length : 0 });
    return folded;
  };

  // Iterative walk (a 500-message straight chat must not overflow the stack).
  const stack: Array<{ node: TreeNode; parentId: string | null }> = [{ node: index.root, parentId: null }];

  // Draws a chain of non-structural messages (plain ones and tucking branch points) below `above`:
  // runs where it is long enough, cards elsewhere. Returns the last item drawn. The side branches
  // of a tucking branch point drawn as a card go to `later`, to be walked as usual.
  const emitChain = (chain: TreeNode[], above: string | null, later: Array<{ node: TreeNode; parentId: string | null }>): string | null => {
    const plainAround = (i: number, step: number) => {
      let c = 0;
      for (let j = i + step; j >= 0 && j < chain.length && isPlain(chain[j]); j += step) c += 1;
      return c;
    };
    const card = (n: TreeNode) => {
      emitNode(n, above); // never folded here: a folded message is structural
      const side = kidsOf(index, n.id).slice(1);
      for (let i = side.length - 1; i >= 0; i--) later.push({ node: side[i], parentId: n.id });
      above = n.id;
    };
    let group: TreeNode[] = [];
    const flush = () => {
      const plain = group.filter(isPlain).length;
      if (group.length >= RUN_MIN && (plain >= RUN_MIN || group.length - plain >= 2)) {
        const id = `run:${group[0].id}`;
        const tucked: VisRun["tucked"] = [];
        let tuckedMessages = 0;
        for (const n of group)
          for (const c of kidsOf(index, n.id).slice(1)) {
            tucked.push({ id: c.id, at: n.id });
            tuckedMessages += 1 + countBelow(index, c.id).messages;
          }
        items.push({ kind: "run", id, parentId: above, nodes: group, open: opts.openRuns.has(id), foldId: isFoldable(group[0]) ? group[0].id : null, tucked, tuckedMessages });
        above = id;
      } else {
        for (const n of group) card(n);
      }
      group = [];
    };
    chain.forEach((n, i) => {
      // a branch point between two full runs keeps its card, as it would with its branches open
      if (!isPlain(n) && plainAround(i, -1) >= RUN_MIN && plainAround(i, 1) >= RUN_MIN) {
        flush();
        card(n);
      } else group.push(n);
    });
    flush();
    return above;
  };
  while (stack.length) {
    const { node, parentId } = stack.pop()!;
    if (seen.has(node.id)) continue;
    let above = parentId;
    let cur: TreeNode | null = node;

    if (!isStructural(cur)) {
      // a chain of plain messages: cur, then each single child while it is plain too
      const chain: TreeNode[] = [];
      while (cur && !seen.has(cur.id) && !isStructural(cur)) {
        chain.push(cur);
        seen.add(cur.id);
        cur = kidsOf(index, cur.id)[0] ?? null;
      }
      const later: Array<{ node: TreeNode; parentId: string | null }> = [];
      above = emitChain(chain, above, later);
      // pushed before what is below the chain (walked after it), deepest branch point on top:
      // items keep reading order
      for (const s of later) stack.push(s);
      if (!cur || seen.has(cur.id)) continue;
    }

    // cur is structural
    seen.add(cur.id);
    const folded = emitNode(cur, above);
    if (folded) continue;
    const kids = kidsOf(index, cur.id);
    // pushed in reverse so the first (main) child is walked first: items keep reading order
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], parentId: cur.id });
  }
  return items;
}

/** The first and last message of an item (a card is both). */
export const firstOf = (it: VisItem): TreeNode => (it.kind === "run" ? it.nodes[0] : it.node);
export const lastOf = (it: VisItem): TreeNode => (it.kind === "run" ? it.nodes[it.nodes.length - 1] : it.node);

/** How many messages the items account for, drawn or folded (= the tree's size). */
export function countMessages(items: VisItem[]): number {
  return items.reduce((s, it) => s + (it.kind === "run" ? it.nodes.length + it.tuckedMessages : 1 + (it.hidden ? it.hidden.messages : 0)), 0);
}

/** Every message in reading order: root first, then depth-first with the main child first. */
export function readingOrder(index: TreeIndex): string[] {
  const out: string[] = [];
  if (!index.root) return out;
  const seen = new Set<string>();
  const stack = [index.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n.id);
    const k = kidsOf(index, n.id);
    for (let i = k.length - 1; i >= 0; i--) stack.push(k[i]);
  }
  return out;
}

/** The messages below `id` (not `id` itself). */
export function descendantsOf(index: TreeIndex, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...kidsOf(index, id)];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n.id);
    stack.push(...kidsOf(index, n.id));
  }
  return out;
}

/** `folded` without the folds that hide `id`: a fold at X hides what is below X, and X itself when
 *  X is a side branch tucked into a run, so a fold at `id` goes too. */
export function unfoldPathTo(index: TreeIndex, id: string, folded: Set<string>): Set<string> {
  const out = new Set(folded);
  out.delete(id);
  const seen = new Set<string>();
  let cur = index.byId.get(id);
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = index.byId.get(cur.parentId);
    if (!parent) break;
    out.delete(parent.id);
    cur = parent;
  }
  return out;
}

/** The item that shows message `id`: its card, or the run it is a row of; null if folded away. */
export function itemShowing(items: VisItem[], id: string): VisItem | null {
  for (const it of items) {
    if (it.kind === "node" ? it.id === id : it.nodes.some((n) => n.id === id)) return it;
  }
  return null;
}
