import { useCallback, useEffect, useMemo } from "react";
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
} from "reactflow";
import "reactflow/dist/style.css";
import type { TreeNode } from "./types";

// ─── Layout constants ──────────────────────────────────────────────────────
const COL_W = 320; // px between depth levels (left → right)
const ROW_H = 150; // px between sibling rows (top → bottom)

// ─── Data baked into each ReactFlow node ──────────────────────────────────
type NodeData = {
  treeNode: TreeNode;
  isOnActivePath: boolean;
  isMainChild: boolean;
  /** Show full branch: ancestors + main-child chain to leaf */
  onShowBranch: (nodeId: string) => void;
  /** Load path to exactly this node so composer adds a child here */
  onChatHere: (nodeId: string) => void;
  /** Promote this node to be its parent's main child */
  onSetMain: (parentId: string, childId: string) => void;
};

// ─── Custom node card ─────────────────────────────────────────────────────
function ChatNode({ data }: NodeProps<NodeData>) {
  const { treeNode, isOnActivePath, isMainChild, onShowBranch, onChatHere, onSetMain } = data;

  const isLeaf = treeNode.main_child_id === null;
  const shortPrompt = treeNode.prompt.length > 52
    ? treeNode.prompt.slice(0, 52) + "…"
    : treeNode.prompt;
  const shortResp = treeNode.response.length > 65
    ? treeNode.response.slice(0, 65) + "…"
    : treeNode.response;
  const modelLabel = (treeNode.model_used.split("/").pop() ?? treeNode.model_used).replace(":free", "");

  // ReactFlow needs nodrag + nopan on interactive areas so it doesn't intercept clicks
  return (
    <div className={`rf-node${isOnActivePath ? " rf-node--active" : ""}${isLeaf ? " rf-node--leaf" : ""}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      {/* Text preview — not interactive, just info */}
      <div className="rf-node-preview nodrag nopan">
        <div className="rf-node-prompt">{shortPrompt}</div>
        <div className="rf-node-response">{shortResp}</div>
      </div>

      {/* Badges row */}
      <div className="rf-node-badges nodrag nopan">
        <span className="rf-model-badge">{modelLabel}</span>
        {isMainChild && <span className="rf-main-badge">★ main</span>}
        {isLeaf && <span className="rf-leaf-badge">leaf</span>}
      </div>

      {/* Action buttons — all have nodrag/nopan so ReactFlow doesn't swallow clicks */}
      <div className="rf-node-actions nodrag nopan">
        <button
          className="rf-btn rf-btn--show"
          title="Show this branch in chat (ancestors + main-child chain to leaf)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onShowBranch(treeNode.id); }}
        >
          👁 Show branch
        </button>

        <button
          className="rf-btn rf-btn--chat"
          title="Continue chatting from this node"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onChatHere(treeNode.id); }}
        >
          ▶ Chat here
        </button>

        {!isMainChild && treeNode.parent_id !== null && (
          <button
            className="rf-btn rf-btn--main"
            title="Make this the main child of its parent"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSetMain(treeNode.parent_id!, treeNode.id); }}
          >
            ☆ Set main
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { chatNode: ChatNode };

// ─── Recursive subtree-height layout ──────────────────────────────────────
function buildLayout(
  treeNodes: TreeNode[],
  activePathIds: Set<string>,
  onShowBranch: (id: string) => void,
  onChatHere: (id: string) => void,
  onSetMain: (parentId: string, childId: string) => void,
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const byId = new Map(treeNodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, TreeNode[]>();

  for (const n of treeNodes) {
    const key = n.parent_id ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(n);
  }

  const posMap = new Map<string, { x: number; y: number }>();

  function subtreeH(id: string): number {
    const kids = childrenOf.get(id) ?? [];
    return kids.length === 0 ? 1 : kids.reduce((s, k) => s + subtreeH(k.id), 0);
  }

  function place(id: string, depth: number, rowStart: number): void {
    const h = subtreeH(id);
    posMap.set(id, { x: depth * COL_W, y: ((rowStart * 2 + h - 1) / 2) * ROW_H });
    let cursor = rowStart;
    for (const kid of childrenOf.get(id) ?? []) {
      place(kid.id, depth + 1, cursor);
      cursor += subtreeH(kid.id);
    }
  }

  const root = treeNodes.find((n) => n.parent_id === null);
  if (root) place(root.id, 0, 0);

  const rfNodes: Node<NodeData>[] = treeNodes.map((n) => ({
    id: n.id,
    type: "chatNode",
    position: posMap.get(n.id) ?? { x: 0, y: 0 },
    data: {
      treeNode: n,
      isOnActivePath: activePathIds.has(n.id),
      isMainChild: byId.get(n.parent_id ?? "")?.main_child_id === n.id,
      onShowBranch,
      onChatHere,
      onSetMain,
    },
  }));

  const rfEdges: Edge[] = treeNodes
    .filter((n) => n.parent_id !== null)
    .map((n) => {
      const isMain = byId.get(n.parent_id!)?.main_child_id === n.id;
      return {
        id: `e-${n.parent_id}-${n.id}`,
        source: n.parent_id!,
        target: n.id,
        animated: isMain,
        style: isMain
          ? { stroke: "#3b82f6", strokeWidth: 2.5 }
          : { stroke: "#374151", strokeWidth: 1, strokeDasharray: "5 4" },
      };
    });

  return { nodes: rfNodes, edges: rfEdges };
}

// ─── Props ─────────────────────────────────────────────────────────────────
type TreeViewProps = {
  treeNodes: TreeNode[];
  activePathIds: Set<string>;
  /** ancestors + main-child chain to leaf → show in chat, close tree */
  onShowBranch: (leafId: string) => void;
  /** load path to exactly this node, close tree */
  onChatFromNode: (nodeId: string) => void;
  /** promote child to be parent's main child */
  onSetMainChild: (parentId: string, childId: string) => void;
  onClose: () => void;
};

// ─── Inner ReactFlow component (needs ReactFlowProvider parent) ────────────
function InnerFlow({
  treeNodes,
  activePathIds,
  onShowBranch,
  onChatFromNode,
  onSetMainChild,
}: Omit<TreeViewProps, "onClose">) {
  const { fitView } = useReactFlow();

  // Follow main_child_id chain from startNode to find the effective leaf
  const resolveLeaf = useCallback(
    (startId: string): string => {
      const byId = new Map(treeNodes.map((n) => [n.id, n]));
      let cur = byId.get(startId);
      while (cur?.main_child_id) {
        const next = byId.get(cur.main_child_id);
        if (!next) break;
        cur = next;
      }
      return cur?.id ?? startId;
    },
    [treeNodes],
  );

  const handleShowBranch = useCallback(
    (nodeId: string) => onShowBranch(resolveLeaf(nodeId)),
    [resolveLeaf, onShowBranch],
  );

  const { nodes, edges } = useMemo(
    () => buildLayout(treeNodes, activePathIds, handleShowBranch, onChatFromNode, onSetMainChild),
    [treeNodes, activePathIds, handleShowBranch, onChatFromNode, onSetMainChild],
  );

  // Stable key: changes only when main_child_id relationships change → forces remount
  const rfKey = useMemo(
    () => treeNodes.map((n) => `${n.id}=${n.main_child_id ?? "x"}`).join(","),
    [treeNodes],
  );

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.18 }), 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfKey]);

  return (
    <ReactFlow
      key={rfKey}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.15}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      // DO NOT set elementsSelectable={false} — that disables pointer-events on nodes,
      // which blocks button clicks inside custom nodes!
      panOnScroll
      zoomOnScroll
    >
      <Background color="#1e293b" gap={20} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(n) => ((n.data as NodeData).isOnActivePath ? "#3b82f6" : "#1e293b")}
        style={{ background: "#080f1e", border: "1px solid #1e3a5f" }}
      />
    </ReactFlow>
  );
}

// ─── Exported component ────────────────────────────────────────────────────
export default function TreeView(props: TreeViewProps) {
  return (
    <div className="tree-drawer">
      <div className="tree-drawer-header">
        <span className="tree-drawer-title">🌲 Conversation Tree</span>
        <span className="tree-drawer-hint">
          👁 Show branch → loads full branch in chat &nbsp;·&nbsp;
          ▶ Chat here → continue from this node &nbsp;·&nbsp;
          ☆ Set main → change the main-child path
        </span>
        <button className="tree-close-btn" onClick={props.onClose}>✕ Close</button>
      </div>
      <div className="tree-drawer-body">
        <ReactFlowProvider>
          <InnerFlow
            treeNodes={props.treeNodes}
            activePathIds={props.activePathIds}
            onShowBranch={props.onShowBranch}
            onChatFromNode={props.onChatFromNode}
            onSetMainChild={props.onSetMainChild}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
