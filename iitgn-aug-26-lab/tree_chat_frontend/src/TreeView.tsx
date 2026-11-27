// The tree view: top-to-bottom, with long straight stretches folded into "run" cards.
// What is drawn is decided in treeModel.ts, where it goes in treeLayout.ts (both pure).
// Ported from the TreeGPT side panel (cs437--KTP--hack), plus "Selected" context picking.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from "reactflow";
import "reactflow/dist/style.css";
import { Icon } from "./Icons";
import { CARD_W, layoutTree } from "./treeLayout";
import { LIST_MAX, highlightParts, queryWords, searchTree, type SearchHit } from "./treeSearch";
import { fmtTokens, windowIds } from "./contextView";
import {
  buildVisible,
  descendantsOf,
  firstOf,
  itemShowing,
  readingOrder,
  unfoldPathTo,
  foldableIds,
  foldAllBut,
  indexTree,
  lastOf,
  mainPathOf,
  type VisItem,
  type VisNode,
  type VisRun,
} from "./treeModel";
import type { TreeNode } from "./types";

// Colours used inside the canvas (the same values as the CSS variables in index.css).
const ACCENT = "#ececec"; // off-white: the main path
const LINK_VIEWING = "#a3a3a3"; // the path the chat is showing (cards on it also get a white border)
const LINK_OTHER = "#5f5f5f";

type Actions = {
  /** Show this path in the chat: root -> this message -> its main children down to a leaf. */
  onOpen: (nodeId: string) => void;
  /** Show root -> this message; the next message becomes a child of it. */
  onContinue: (nodeId: string) => void;
  /** Make root -> this message the tree's main path. */
  onSetMain: (node: TreeNode) => void;
  onToggleFold: (id: string) => void;
  /** Unfold these branches (the side branches tucked into a run). */
  onUnfold: (ids: string[]) => void;
  onToggleRun: (runId: string) => void;
  /** Show what the model saw for this message (context mode). */
  onContext: (nodeId: string) => void;
  /** Tick / untick a message as context for the next send (selection mode). */
  onToggleSelect: (nodeId: string) => void;
};

// Highlights on the canvas (T21): search matches, the current match, and dimming of the rest; or,
// in context mode, the messages the model saw for one message (`context`, yellow).
type Marks = {
  match: Set<string>;
  current: string | null;
  dim: boolean;
  pulse: string | null;
  context: Set<string> | null;
  contextOf: string | null;
  /** Selection mode: tick boxes on every message; ticked ones show as in context. */
  selecting: boolean;
  selected: Set<string>;
};
const NO_MARKS: Marks = { match: new Set(), current: null, dim: false, pulse: null, context: null, contextOf: null, selecting: false, selected: new Set() };

type CardData = { item: VisNode; isMain: boolean; onPath: boolean; isTip: boolean; actions: Actions; marks: Marks; hiddenMatches: number };
type RunData = { item: VisRun; isMain: boolean; onPath: boolean; activePath: Set<string>; actions: Actions; marks: Marks; tuckedMatches: number };

function markClass(ids: string[], marks: Marks): string {
  if (marks.selecting) return ids.some((id) => marks.selected.has(id)) ? " in-context" : "";
  if (marks.context) {
    const inCtx = ids.some((id) => marks.context!.has(id));
    return (inCtx ? " in-context" : " is-dim") + (marks.contextOf && ids.includes(marks.contextOf) ? " is-context-of" : "");
  }
  const isCurrent = !!marks.current && ids.includes(marks.current);
  const isMatch = ids.some((id) => marks.match.has(id));
  return (
    (isCurrent ? " is-current" : isMatch ? " is-match" : "") +
    (marks.dim && !isMatch ? " is-dim" : "") +
    (marks.pulse && ids.includes(marks.pulse) ? " is-pulse" : "")
  );
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function Tags({ node, isMain, isTip, branchCount, isLeaf, inContext }: { node: TreeNode; isMain: boolean; isTip: boolean; branchCount: number; isLeaf: boolean; inContext: boolean }) {
  return (
    <div className="rf-tags">
      {inContext && <span className="tag tag--ctx-in" title="The model saw this message">In context</span>}
      {isTip && <span className="tag tag--here" title="The chat is showing the path up to this message">You are here</span>}
      {isMain && <span className="tag tag--main" title="On the tree's main path">Main</span>}
      {branchCount >= 2 && <span className="tag">{plural(branchCount, "branch", "branches")}</span>}
      {isLeaf && <span className="tag" title="The last message of this branch">Leaf</span>}
      {node.contextMode === "none" && node.parentId !== null && (
        <span className="tag" title="Sent without the earlier messages">No context</span>
      )}
      {node.contextMode === "selected" && (
        <span className="tag tag--ctx" title="Sent with only the messages picked by hand">Selected ctx · {node.contextNodeIds.length}</span>
      )}
      {node.contextSummarized && (
        <span className="tag tag--sum" title="Older messages were summarized to keep the input short">
          <Icon name="compress" size={11} /> Summarized
        </span>
      )}
    </div>
  );
}

function SelectBox({ id, marks, actions, size = 15 }: { id: string; marks: Marks; actions: Actions; size?: number }) {
  if (!marks.selecting) return null;
  const on = marks.selected.has(id);
  return (
    <button
      type="button"
      className={`rf-select${on ? " on" : ""}`}
      title={on ? "Remove from context" : "Use as context"}
      aria-label={on ? "Remove from context" : "Use as context"}
      aria-pressed={on}
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        actions.onToggleSelect(id);
      }}
    >
      <Icon name={on ? "checkSquare" : "square"} size={size} />
    </button>
  );
}

// ─── A message card ────────────────────────────────────────────────────────
function ChatCard({ data }: NodeProps<CardData>) {
  const { item, isMain, onPath, isTip, actions, marks, hiddenMatches } = data;
  const n = item.node;
  const isLeaf = n.mainChildId === null;
  return (
    <div
      className={`rf-node nodrag nopan${onPath ? " rf-node--path" : ""}${isTip ? " rf-node--tip" : ""}${markClass([n.id], marks)}`}
      onClick={() => (marks.selecting ? actions.onToggleSelect(n.id) : actions.onOpen(n.id))}
      title={marks.selecting ? "Tick to use as context" : "Open this path in the chat"}
    >
      <Handle type="target" position={Position.Top} className="rf-handle" />
      <div className="rf-head">
        <SelectBox id={n.id} marks={marks} actions={actions} />
        <div className="rf-title">{n.prompt}</div>
        <button
          type="button"
          className={`rf-star rf-ctx-btn${marks.contextOf === n.id ? " on" : ""}`}
          title="Show what the model saw for this message"
          aria-label="Show what the model saw for this message"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            actions.onContext(n.id);
          }}
        >
          <Icon name="layers" size={15} />
        </button>
        <button
          type="button"
          className={`rf-star${isMain ? " on" : ""}`}
          title={isMain ? "On the main path" : "Make this the main path"}
          aria-label={isMain ? "On the main path" : "Make this the main path"}
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            if (!isMain) actions.onSetMain(n);
          }}
        >
          <Icon name="star" size={15} filled={isMain} />
        </button>
      </div>
      {n.response ? <div className="rf-sub">{n.response}</div> : null}
      <Tags node={n} isMain={isMain} isTip={isTip} branchCount={item.branchCount} isLeaf={isLeaf} inContext={!!(marks.selecting ? marks.selected : marks.context)?.has(n.id)} />
      {item.foldable ? (
        <button
          type="button"
          className={`rf-fold${item.hidden ? " folded" : ""}`}
          title={item.hidden ? "Show this branch" : "Hide everything below this message"}
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            actions.onToggleFold(n.id);
          }}
        >
          <Icon name={item.hidden ? "chevronRight" : "chevronDown"} size={13} />
          {item.hidden
            ? `${plural(item.hidden.messages, "message")} hidden${item.hidden.branches > 1 ? ` · ${item.hidden.branches} branches` : ""}`
            : "Fold branch"}
          {item.hidden && hiddenMatches > 0 ? (
            <span className="tag tag--match" title="Search matches inside this folded branch">
              {hiddenMatches === 1 ? "1 match inside" : `${hiddenMatches} matches inside`}
            </span>
          ) : null}
        </button>
      ) : null}
      <div className="rf-actions">
        <button
          type="button"
          className="btn btn-sm"
          title="Show this path in the chat: from the first message, through this one, down its main branch"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            actions.onOpen(n.id);
          }}
        >
          Open Path
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          title="Show the chat up to this message; your next message continues from it"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            actions.onContinue(n.id);
          }}
        >
          Continue here
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} className="rf-handle" />
    </div>
  );
}

// ─── A run: several messages in a row, as one card with a list inside ──────
function RunCard({ data }: NodeProps<RunData>) {
  const { item, isMain, onPath, activePath, actions, marks, tuckedMatches } = data;
  const first = item.nodes[0];
  const last = item.nodes[item.nodes.length - 1];
  const ids = item.nodes.map((n) => n.id);
  const matches = ids.filter((id) => marks.match.has(id)).length;
  const ctxSet = marks.selecting ? marks.selected : marks.context;
  const inCtx = ctxSet ? ids.filter((id) => ctxSet.has(id)).length : 0;
  const sidesAt = (id: string) => item.tucked.filter((t) => t.at === id).length;
  // The current search match is a row of this list: keep it in view inside the list.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!item.open || !marks.current || !ids.includes(marks.current)) return;
    const row = listRef.current?.querySelector<HTMLElement>(".rf-row.is-current");
    if (row && listRef.current) listRef.current.scrollTop = row.offsetTop - listRef.current.clientHeight / 2 + row.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.open, marks.current]);
  return (
    <div className={`rf-node rf-run nodrag nopan${onPath ? " rf-node--path" : ""}${item.open ? " open" : ""}${markClass(ids, marks)}`}>
      <Handle type="target" position={Position.Top} className="rf-handle" />
      <button
        type="button"
        className="rf-run-head"
        title={item.open ? "Close the list" : "Show these messages"}
        aria-expanded={item.open}
        onPointerDown={stop}
        onClick={(e) => {
          e.stopPropagation();
          actions.onToggleRun(item.id);
        }}
      >
        <Icon name="list" size={14} />
        <span className="rf-run-count">{item.nodes.length} messages</span>
        {matches > 0 ? <span className="tag tag--match">{matches === 1 ? "1 match" : `${matches} matches`}</span> : null}
        {inCtx > 0 ? <span className="tag tag--ctx-in">{inCtx} of {ids.length} in context</span> : null}
        <Icon name={item.open ? "chevronUp" : "chevronDown"} size={14} />
      </button>

      {item.open ? (
        <div className="rf-run-list nowheel" onPointerDown={stop} ref={listRef}>
          {item.nodes.map((n, i) => (
            <div
              key={n.id}
              className={`rf-row${activePath.has(n.id) ? " on-path" : ""}${marks.current === n.id ? " is-current" : marks.match.has(n.id) ? " is-match" : ""}${(marks.selecting ? marks.selected : marks.context)?.has(n.id) ? " in-context" : ""}${marks.contextOf === n.id ? " is-context-of" : ""}`}
              title={n.prompt}
              onClick={(e) => {
                e.stopPropagation();
                actions.onOpen(n.id);
              }}
            >
              <SelectBox id={n.id} marks={marks} actions={actions} size={13} />
              <span className="rf-row-n">{i + 1}</span>
              <span className="rf-row-text">{n.prompt}</span>
              {sidesAt(n.id) ? (
                <span className="tag rf-row-side" title="Folded side branches start here (show them with the button below)">
                  <Icon name="branch" size={11} /> {sidesAt(n.id)}
                </span>
              ) : null}
              <span className="rf-row-actions">
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  title="Open this path in the chat"
                  aria-label="Open this path in the chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onOpen(n.id);
                  }}
                >
                  <Icon name="eye" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  title="Continue from this message"
                  aria-label="Continue from this message"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onContinue(n.id);
                  }}
                >
                  <Icon name="chevronRight" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  title="Show what the model saw for this message"
                  aria-label="Show what the model saw for this message"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onContext(n.id);
                  }}
                >
                  <Icon name="layers" size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rf-run-summary" onClick={() => actions.onToggleRun(item.id)}>
          <div className="rf-run-line">
            <span className="rf-run-key">from</span>
            <span className="rf-run-val">{first.prompt}</span>
          </div>
          <div className="rf-run-line">
            <span className="rf-run-key">to</span>
            <span className="rf-run-val">{last.prompt}</span>
          </div>
        </div>
      )}

      {isMain || onPath ? (
        <div className="rf-tags">
          {onPath && <span className="tag tag--here" title="The path the chat is showing goes through these messages">On your path</span>}
          {isMain && <span className="tag tag--main">Main</span>}
        </div>
      ) : null}

      {item.tucked.length ? (
        <button
          type="button"
          className="rf-fold folded"
          title="Show the side branches folded into these messages"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            actions.onUnfold(item.tucked.map((t) => t.id));
          }}
        >
          <Icon name="branch" size={13} />
          {`${plural(item.tucked.length, "side branch", "side branches")} · ${plural(item.tuckedMessages, "message")} hidden`}
          {tuckedMatches > 0 ? (
            <span className="tag tag--match" title="Search matches inside these folded side branches">
              {tuckedMatches === 1 ? "1 match inside" : `${tuckedMatches} matches inside`}
            </span>
          ) : null}
        </button>
      ) : null}

      {item.foldId ? (
        <button
          type="button"
          className="rf-fold"
          title="Hide this whole branch"
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation();
            actions.onToggleFold(item.foldId!);
          }}
        >
          <Icon name="chevronDown" size={13} />
          Fold branch
        </button>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="rf-handle" />
    </div>
  );
}

const nodeTypes = { card: ChatCard, run: RunCard };

// What was opened or folded, per tree, kept while the panel is open (survives closing the view).
const savedView = new Map<string, { folded: Set<string>; openRuns: Set<string> }>();

// ─── Props ─────────────────────────────────────────────────────────────────
type TreeViewProps = {
  treeNodes: TreeNode[];
  activePathIds: Set<string>;
  /** The last message of the path the chat is showing. */
  activeTipId: string | null;
  /** Centre the view on this message when it opens (e.g. "2 branches here" in the chat). */
  focusId?: string | null;
  /** Open in context mode for this message ("Context: N messages" in the chat). */
  contextOf?: string | null;
  /** ancestors + main-child chain to leaf → show in chat, close tree */
  onShowBranch: (leafId: string) => void;
  /** load path to exactly this node, close tree */
  onChatFromNode: (nodeId: string) => void;
  /** promote child to be parent's main child */
  onSetMain: (nodeId: string) => void;
  onClose: () => void;
  /** Selection mode: tick messages from any branch as context for the next send. */
  selecting?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (nodeId: string) => void;
  onClearSelection?: () => void;
};

type ToolbarApi = {
  focusPath: () => void;
  expandAll: () => void;
  collapseAll: () => void;
  fit: () => void;
  /** Show message `id`: unfold what hides it, open its run, centre on it, pulse it (T21). */
  jumpTo: (id: string) => void;
};

// ─── Inner ReactFlow component (needs ReactFlowProvider parent) ────────────
function InnerFlow({
  treeNodes,
  activePathIds,
  activeTipId,
  focusId,
  onShowBranch,
  onChatFromNode,
  onSetMain,
  registerToolbar,
  marks,
  onContext,
  onToggleSelect,
}: Omit<TreeViewProps, "onClose" | "contextOf" | "selecting" | "selectedIds" | "onToggleSelect" | "onClearSelection"> & {
  registerToolbar: (api: ToolbarApi) => void;
  marks: Marks;
  onContext: (id: string) => void;
  onToggleSelect: (id: string) => void;
}) {
  const { fitView, setCenter } = useReactFlow();
  const rootId = treeNodes.find((n) => n.parentId === null)?.id ?? treeNodes[0]?.id ?? "";
  const index = useMemo(() => indexTree(treeNodes, rootId || null), [treeNodes, rootId]);
  const mainPath = useMemo(() => mainPathOf(index), [index]);

  // Folded branches and opened runs. The first time a tree is shown, every branch is folded (the
  // path the chat is showing always stays open: treeModel never hides it) and every run is closed.
  const [view, setView] = useState(() => {
    const saved = savedView.get(rootId);
    if (saved) return saved;
    return { folded: new Set(foldableIds(index)), openRuns: new Set<string>() };
  });
  useEffect(() => {
    savedView.set(rootId, view);
  }, [rootId, view]);

  // Follow mainChildId chain from startNode to find the effective leaf
  const resolveLeaf = useCallback(
    (startId: string): string => {
      let cur = index.byId.get(startId);
      // A loop in saved mainChildId data would hang the panel: stop at a node seen before (T18).
      const seen = new Set<string>();
      while (cur?.mainChildId && !seen.has(cur.id)) {
        seen.add(cur.id);
        const next = index.byId.get(cur.mainChildId);
        if (!next) break;
        cur = next;
      }
      return cur?.id ?? startId;
    },
    [index],
  );

  const actions: Actions = useMemo(
    () => ({
      onOpen: (id) => onShowBranch(resolveLeaf(id)),
      onContinue: onChatFromNode,
      onSetMain: (n) => {
        if (n.parentId) onSetMain(n.id);
      },
      onToggleFold: (id) =>
        setView((v) => {
          const folded = new Set(v.folded);
          if (folded.has(id)) folded.delete(id);
          else folded.add(id);
          return { ...v, folded };
        }),
      onUnfold: (ids) =>
        setView((v) => {
          const folded = new Set(v.folded);
          for (const id of ids) folded.delete(id);
          return { ...v, folded };
        }),
      onToggleRun: (id) =>
        setView((v) => {
          const openRuns = new Set(v.openRuns);
          if (openRuns.has(id)) openRuns.delete(id);
          else openRuns.add(id);
          return { ...v, openRuns };
        }),
      onContext,
      onToggleSelect,
    }),
    [onShowBranch, onChatFromNode, onSetMain, resolveLeaf, onContext, onToggleSelect],
  );

  const items: VisItem[] = useMemo(
    () => buildVisible(treeNodes, { rootId: rootId || null, activeId: activeTipId, activePath: activePathIds, folded: view.folded, openRuns: view.openRuns }),
    [treeNodes, rootId, activeTipId, activePathIds, view],
  );

  // Real card sizes, once reactflow has measured them. As a string so the layout only reruns
  // when a size actually changes (no render loop).
  const sizesKey = useStore((s) => {
    const parts: string[] = [];
    s.nodeInternals.forEach((n) => {
      if (n.width && n.height) parts.push(`${n.id}|${Math.round(n.width)}|${Math.round(n.height)}`);
    });
    return parts.sort().join(",");
  });
  const sizes = useMemo(() => {
    const m = new Map<string, { width: number; height: number }>();
    for (const p of sizesKey.split(",")) {
      const [id, w, h] = p.split("|");
      if (id && w && h) m.set(id, { width: Number(w), height: Number(h) });
    }
    return m;
  }, [sizesKey]);

  const { nodes, edges, positions } = useMemo(() => {
    const pos = layoutTree(items, (id) => sizes.get(id));
    const byItem = new Map(items.map((it) => [it.id, it]));
    const rfNodes: Node[] = items.map((it) => {
      const onPath = it.kind === "run" ? it.nodes.some((n) => activePathIds.has(n.id)) : activePathIds.has(it.id);
      const isMain = mainPath.has(firstOf(it).id);
      return {
        id: it.id,
        type: it.kind === "run" ? "run" : "card",
        position: pos.get(it.id) ?? { x: 0, y: 0 },
        // Hand reactflow's own measurements back: without width/height it treats a re-laid-out card
        // as unmeasured and keeps it hidden (its size did not change, so it is never re-measured).
        ...(sizes.get(it.id) ?? {}),
        data:
          it.kind === "run"
            ? ({
                item: it,
                isMain,
                onPath,
                activePath: activePathIds,
                actions,
                marks,
                tuckedMatches: marks.match.size
                  ? it.tucked.reduce((s, t) => s + [t.id, ...descendantsOf(index, t.id)].filter((id) => marks.match.has(id)).length, 0)
                  : 0,
              } satisfies RunData)
            : ({
                item: it,
                isMain,
                onPath,
                isTip: it.id === activeTipId,
                actions,
                marks,
                hiddenMatches: it.hidden && marks.match.size ? descendantsOf(index, it.id).filter((id) => marks.match.has(id)).length : 0,
              } satisfies CardData),
      };
    });
    const rfEdges: Edge[] = items
      .filter((it) => it.parentId !== null && byItem.has(it.parentId!))
      .map((it) => {
        const above = lastOf(byItem.get(it.parentId!)!).id;
        const below = firstOf(it).id;
        const isMain = mainPath.has(above) && mainPath.has(below);
        const viewing = activePathIds.has(above) && activePathIds.has(below);
        return {
          id: `e-${it.parentId}-${it.id}`,
          source: it.parentId!,
          target: it.id,
          type: "smoothstep",
          animated: isMain, // the main path keeps its moving dashes
          zIndex: isMain ? 2 : viewing ? 1 : 0,
          style: isMain
            ? { stroke: ACCENT, strokeWidth: 2.5 }
            : viewing
              ? { stroke: LINK_VIEWING, strokeWidth: 2 }
              : { stroke: LINK_OTHER, strokeWidth: 1.5 },
        };
      });
    return { nodes: rfNodes, edges: rfEdges, positions: pos };
  }, [items, sizes, activePathIds, activeTipId, mainPath, actions, marks, index]);

  // First view, once the cards are measured: the whole (collapsed) tree fitted to the window, unless a
  // message was asked for ("N branches here" in the chat), which is centred instead.
  const measured = items.length > 0 && items.every((it) => sizes.has(it.id));
  const placedOnce = useRef(false);
  const centreOn = useCallback(
    (nodeId: string | null): boolean => {
      const it = nodeId ? items.find((x) => (x.kind === "run" ? x.nodes.some((n) => n.id === nodeId) : x.id === nodeId)) : null;
      const p = it ? positions.get(it.id) : null;
      if (!it || !p) return false;
      const s = sizes.get(it.id);
      setCenter(p.x + (s?.width ?? CARD_W) / 2, p.y + (s?.height ?? 120) / 2, { zoom: 0.9, duration: 200 });
      return true;
    },
    [items, positions, sizes, setCenter],
  );
  useEffect(() => {
    if (!measured || placedOnce.current) return;
    placedOnce.current = true;
    const t = setTimeout(() => {
      if (focusId && centreOn(focusId)) return;
      fitView({ padding: 0.12, maxZoom: 1 });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured]);

  // Context mode: the context is a straight line of ancestors, so nothing in it is folded away;
  // the run where the context STARTS (partly inside) opens, and the view fits the context.
  const pendingCtx = useRef<string | null>(null);
  useEffect(() => {
    if (!marks.contextOf || !marks.context) return;
    pendingCtx.current = marks.contextOf;
    setView((v) => {
      const folded = unfoldPathTo(index, marks.contextOf!, v.folded);
      return { ...v, folded };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks.contextOf]);
  useEffect(() => {
    if (!pendingCtx.current || !marks.context) return;
    const ctx = marks.context;
    const partly = items.filter((it) => it.kind === "run" && !it.open && it.nodes.some((n) => ctx.has(n.id)) && it.nodes.some((n) => !ctx.has(n.id)));
    if (partly.length) {
      setView((v) => {
        const openRuns = new Set(v.openRuns);
        for (const it of partly) openRuns.add(it.id);
        return { ...v, openRuns };
      });
      return;
    }
    const shown = items.filter((it) => (it.kind === "run" ? it.nodes.some((n) => ctx.has(n.id)) : ctx.has(it.id)));
    if (!shown.every((it) => sizes.has(it.id))) return;
    pendingCtx.current = null;
    setTimeout(() => fitView({ nodes: shown.map((it) => ({ id: it.id })), padding: 0.25, maxZoom: 1, duration: 200 }), 30);
  }, [items, sizes, marks.context, fitView]);

  // A jump waits for the re-layout it causes (an unfolded branch, an opened run), then centres.
  const pendingJump = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingJump.current;
    if (!id) return;
    const it = itemShowing(items, id);
    if (!it) return; // still folded away (the unfold is on its way)
    if (it.kind === "run" && !it.open) {
      setView((v) => ({ ...v, openRuns: new Set(v.openRuns).add(it.id) }));
      return;
    }
    if (!sizes.has(it.id)) return; // not measured yet
    pendingJump.current = null;
    centreOn(id);
  }, [items, sizes, centreOn]);

  useEffect(() => {
    registerToolbar({
      jumpTo: (id: string) => {
        pendingJump.current = id;
        setView((v) => {
          const folded = unfoldPathTo(index, id, v.folded);
          return folded.size === v.folded.size ? { ...v } : { ...v, folded };
        });
      },
      focusPath: () => {
        setView((v) => ({ ...v, folded: foldAllBut(index, activePathIds) }));
        setTimeout(() => centreOn(activeTipId ?? rootId), 250);
      },
      expandAll: () => setView((v) => ({ ...v, folded: new Set() })),
      collapseAll: () => setView({ folded: new Set(foldableIds(index)), openRuns: new Set() }),
      fit: () => fitView({ padding: 0.15, maxZoom: 1, duration: 200 }),
    });
  }, [registerToolbar, index, activePathIds, activeTipId, rootId, centreOn, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      minZoom={0.1}
      maxZoom={1.75}
      nodesDraggable={false}
      nodesConnectable={false}
      // DO NOT set elementsSelectable={false} — that disables pointer-events on nodes,
      // which blocks button clicks inside custom nodes!
      panOnScroll
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#3a3a3a" gap={22} />
      <Controls showInteractive={false} />
      {items.length > 8 ? (
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const d = n.data as CardData | RunData;
            return d.onPath ? "#ffffff" : d.isMain ? "#b4b4b4" : "#555555";
          }}
          maskColor="rgba(0,0,0,0.45)"
        />
      ) : null}
    </ReactFlow>
  );
}

// ─── Exported component ────────────────────────────────────────────────────
export default function TreeView(props: TreeViewProps) {
  const toolbar = useRef<ToolbarApi | null>(null);
  const registerToolbar = useCallback((api: ToolbarApi) => {
    toolbar.current = api;
  }, []);
  const { onClose, treeNodes } = props;
  const toggleSelectProp = props.onToggleSelect;
  const onToggleSelect = useCallback((id: string) => toggleSelectProp?.(id), [toggleSelectProp]);

  // ── search (T21) ──
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [cur, setCur] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [pulse, setPulse] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);
  const order = useMemo(() => {
    const rootId = treeNodes.find((n) => n.parentId === null)?.id ?? null;
    return readingOrder(indexTree(treeNodes, rootId));
  }, [treeNodes]);
  const hits: SearchHit[] = useMemo(() => searchTree(treeNodes, debounced, order), [treeNodes, debounced, order]);
  const words = useMemo(() => queryWords(debounced), [debounced]);
  useEffect(() => setCur(0), [debounced]);
  const current = hits.length ? hits[Math.min(cur, hits.length - 1)].id : null;
  // ── context mode (T21) ──
  const [ctxId, setCtxId] = useState<string | null>(props.contextOf ?? null);
  const byId = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);
  const ctxSet = useMemo(() => (ctxId && byId.has(ctxId) ? new Set(windowIds(byId, ctxId)) : null), [ctxId, byId]);
  const ctxNode = ctxId ? byId.get(ctxId) ?? null : null;
  const toggleContext = useCallback((id: string) => {
    setCtxId((c) => (c === id ? null : id));
    setQuery("");
    setDebounced("");
    setListOpen(false);
  }, []);

  const selecting = !!props.selecting;
  const selectedIds = props.selectedIds;
  const marks: Marks = useMemo(() => {
    if (selecting) {
      const sel = selectedIds ?? new Set<string>();
      return hits.length
        ? { ...NO_MARKS, selecting, selected: sel, match: new Set(hits.map((h) => h.id)), current, pulse }
        : { ...NO_MARKS, selecting, selected: sel };
    }
    if (ctxSet) return { ...NO_MARKS, context: ctxSet, contextOf: ctxId };
    return hits.length ? { ...NO_MARKS, match: new Set(hits.map((h) => h.id)), current, dim: hits.length <= LIST_MAX, pulse } : NO_MARKS;
  }, [hits, current, pulse, ctxSet, ctxId, selecting, selectedIds]);
  const jump = useCallback((i: number) => {
    if (!hits.length) return;
    const k = (i + hits.length) % hits.length;
    setCur(k);
    toolbar.current?.jumpTo(hits[k].id);
    setPulse(hits[k].id);
    window.setTimeout(() => setPulse((p) => (p === hits[k].id ? null : p)), 1300);
  }, [hits]);
  const clearSearch = () => {
    setQuery("");
    setDebounced("");
    setListOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === searchRef.current;
      if ((e.key === "f" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing && !(document.activeElement instanceof HTMLTextAreaElement))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        setListOpen(true);
        return;
      }
      if (e.key === "Escape") {
        // Esc leaves context mode or clears the search first, then closes the tree view
        if (ctxId && !selecting) {
          e.preventDefault();
          setCtxId(null);
        } else if (query || listOpen) {
          e.preventDefault();
          clearSearch();
          searchRef.current?.blur();
        } else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, query, listOpen, ctxId, selecting]);

  const total = props.treeNodes.length;
  const rootKey = props.treeNodes.find((n) => n.parentId === null)?.id ?? "tree";
  return (
    <div className="tree-drawer" role="dialog" aria-label="Conversation tree">
      <div className="tree-drawer-header">
        <span className="tree-drawer-title">
          <Icon name="tree" /> Tree
          <span className="tree-drawer-count">{plural(total, "message")}</span>
        </span>
        <button className="btn btn-sm" onClick={onClose} title="Back to the chat (Esc)">
          <Icon name="close" size={13} /> Close
        </button>
      </div>
      <div className="tree-search">
        <div className={`search-box${query ? " has-text" : ""}`}>
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search this tree (Ctrl+F)"
            aria-label="Search this tree"
            onChange={(e) => {
              setQuery(e.target.value);
              setListOpen(true);
              setCtxId(null); // search and context mode do not mix
            }}
            onFocus={() => setListOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                jump(cur + 1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                jump(cur - 1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                jump(e.shiftKey ? cur - 1 : cur);
                setListOpen(false);
              }
            }}
          />
          {query ? (
            <button className="icon-btn icon-btn--bare" onClick={clearSearch} title="Clear (Esc)" aria-label="Clear search">
              <Icon name="close" size={13} />
            </button>
          ) : null}
        </div>
        {queryWords(query).length ? (
          <span className="search-count" aria-live="polite">
            {hits.length ? `${Math.min(cur, hits.length - 1) + 1} / ${hits.length}` : debounced === query ? "No matches" : "…"}
          </span>
        ) : null}
        <button className="icon-btn icon-btn--sm" disabled={!hits.length} onClick={() => jump(cur - 1)} title="Previous match (Shift+Enter)" aria-label="Previous match">
          <Icon name="chevronUp" size={14} />
        </button>
        <button className="icon-btn icon-btn--sm" disabled={!hits.length} onClick={() => jump(cur + 1)} title="Next match (Enter)" aria-label="Next match">
          <Icon name="chevronDown" size={14} />
        </button>
        {listOpen && hits.length ? (
          <div className="search-results" role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {hits.slice(0, LIST_MAX).map((h, i) => (
              <button
                key={h.id}
                type="button"
                role="option"
                aria-selected={i === cur}
                className={`search-hit${i === Math.min(cur, hits.length - 1) ? " current" : ""}`}
                onClick={() => {
                  jump(i);
                  setListOpen(false);
                }}
              >
                <span className="search-hit-text">
                  {highlightParts(h.snippet, words).map((p, k) => (p.hit ? <b key={k}>{p.text}</b> : <span key={k}>{p.text}</span>))}
                </span>
                <span className="search-hit-field">{h.field === "question" ? "in question" : "in reply"}</span>
              </button>
            ))}
            {hits.length > LIST_MAX ? (
              <div className="search-more">{LIST_MAX}+ matches: add another word to narrow the search</div>
            ) : null}
          </div>
        ) : null}
      </div>
      {selecting ? (
        <div className="ctx-bar" role="status">
          <Icon name="checkSquare" size={15} />
          <span className="ctx-bar-text">
            Picking context: tick any messages, from any branch. <b>{plural(selectedIds?.size ?? 0, "message")} selected</b>
          </span>
          {props.onClearSelection && (selectedIds?.size ?? 0) > 0 ? (
            <button className="btn btn-sm" onClick={props.onClearSelection}>
              Clear
            </button>
          ) : null}
          <button className="btn btn-sm btn-primary" onClick={onClose} title="Back to the chat (Esc)">
            Done
          </button>
        </div>
      ) : ctxNode ? (
        <div className="ctx-bar" role="status">
          <Icon name="layers" size={15} />
          <span className="ctx-bar-text">
            Context of “{ctxNode.prompt.length > 40 ? ctxNode.prompt.slice(0, 40) + "…" : ctxNode.prompt}”:{" "}
            <b>{plural(ctxSet ? ctxSet.size - 1 : 0, "earlier message")}</b>
            {ctxNode.contextTokens ? ` · ~${fmtTokens(ctxNode.contextTokens)} tokens sent` : ""}
            {ctxNode.parentId
              ? ` · ${ctxNode.contextMode === "full" ? "full context" : ctxNode.contextMode === "none" ? "no context" : "selected context"}`
              : " · the first message"}
            {ctxNode.contextSummarized ? " · older messages were summarized" : ""}
          </span>
          <button className="btn btn-sm" onClick={() => setCtxId(null)} title="Leave context mode (Esc)">
            Exit
          </button>
        </div>
      ) : null}
      <div className="tree-toolbar">
        <button className="btn btn-sm" onClick={() => toolbar.current?.focusPath()} title="Fold every branch except the path the chat is showing">
          <Icon name="target" size={13} /> Focus my path
        </button>
        <button className="btn btn-sm" onClick={() => toolbar.current?.expandAll()} title="Show every branch">
          <Icon name="expandAll" size={13} /> Expand all
        </button>
        <button className="btn btn-sm" onClick={() => toolbar.current?.collapseAll()} title="Fold every branch and close every list">
          <Icon name="collapseAll" size={13} /> Collapse all
        </button>
        <button className="btn btn-sm" onClick={() => toolbar.current?.fit()} title="Fit the whole tree in the window">
          <Icon name="fit" size={13} /> Fit
        </button>
      </div>
      <div className="tree-legend" aria-hidden="true">
        <span><i className="swatch swatch--main" /> main path</span>
        <span><i className="swatch swatch--viewing" /> path in the chat</span>
        <span><i className="swatch swatch--other" /> other branches</span>
      </div>
      <div className="tree-drawer-body">
        {total === 1 ? <div className="tree-empty">This tree has one message. Branch from a reply to grow it.</div> : null}
        <ReactFlowProvider>
          <InnerFlow
            key={rootKey}
            treeNodes={props.treeNodes}
            activePathIds={props.activePathIds}
            activeTipId={props.activeTipId}
            focusId={props.focusId}
            onShowBranch={props.onShowBranch}
            onChatFromNode={props.onChatFromNode}
            onSetMain={props.onSetMain}
            registerToolbar={registerToolbar}
            marks={marks}
            onContext={toggleContext}
            onToggleSelect={onToggleSelect}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
