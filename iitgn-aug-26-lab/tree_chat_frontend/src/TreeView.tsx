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
const COL_W = 320;   // horizontal gap between depth levels
const ROW_H = 130;   // vertical gap between sibling nodes

// ─── Types passed to each custom RF node ──────────────────────────────────
type NodeData = {
  treeNode: TreeNode;
  isOnActivePath: boolean;   // node is in the currently loaded chat path
  onNodeClick: (n: TreeNode) => void;
  onSetMainChild: (parentId: string, childId: string) => void;
  isMainChild: boolean;      // this node is parent's main_child_id
  siblings: TreeNode[];      // other children of the same parent
};

// ─── Custom RF node renderer ───────────────────────────────────────────────
function ChatNode({ data }: NodeProps<NodeData>) {
  const { treeNode, isOnActivePath, onNodeClick, onSetMainChild, isMainChild } = data;

  // A node is visually a "leaf" when it has no main_child_id
  // (i.e. nothing points forward from it in the main path)
  const hasNoChildren = treeNode.main_child_id === null;

  const shortPrompt = treeNode.prompt.length > 55
    ? treeNode.prompt.slice(0, 55) + "…"
    : treeNode.prompt;
  const shortResp = treeNode.response.length > 70
    ? treeNode.response.slice(0, 70) + "…"
    : treeNode.response;
  const modelShort = treeNode.model_used.split("/").pop() ?? treeNode.model_used;

  return (
    <div
      className={[
        "rf-node",
        isOnActivePath ? "rf-node--active" : "",
        hasNoChildren ? "rf-node--leaf" : "",
      ].join(" ")}
      onClick={() => onNodeClick(treeNode)}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div className="rf-node-prompt">{shortPrompt}</div>
      <div className="rf-node-response">{shortResp}</div>

      <div className="rf-node-footer">
        <span className="rf-model-badge">{modelShort}</span>
        {isMainChild && <span className="rf-main-badge">★ main</span>}
        {/* Show "set as main" for non-main siblings that have a parent */}
        {!isMainChild && treeNode.parent_id !== null && (
          <button
            className="rf-set-main-btn"
            title="Set as main child"
            onClick={(e) => {
              e.stopPropagation();
              onSetMainChild(treeNode.parent_id!, treeNode.id);
            }}
          >
            ☆ set main
          </button>
        )}
        {hasNoChildren && <span className="rf-leaf-badge">leaf</span>}
      </div>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { chatNode: ChatNode };

// ─── Layout: BFS left-to-right, siblings stacked top-to-bottom ────────────
function buildLayout(
  treeNodes: TreeNode[],
  activePathIds: Set<string>,
  onNodeClick: (n: TreeNode) => void,
  onSetMainChild: (parentId: string, childId: string) => void,
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const byId = new Map(treeNodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, TreeNode[]>();

  for (const n of treeNodes) {
    const key = n.parent_id ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(n);
  }

  // BFS: assign depth (x) and sibling index (y)
  const posMap = new Map<string, { x: number; y: number }>();

  // subtreeHeight: total number of leaf slots under a node
  function subtreeHeight(nodeId: string): number {
    const kids = childrenOf.get(nodeId) ?? [];
    if (kids.length === 0) return 1;
    return kids.reduce((acc, k) => acc + subtreeHeight(k.id), 0);
  }

  function assign(nodeId: string, depth: number, startY: number): void {
    const kids = childrenOf.get(nodeId) ?? [];
    const h = subtreeHeight(nodeId);
    // center this node in its allocated vertical span
    posMap.set(nodeId, { x: depth * COL_W, y: (startY + startY + h - 1) / 2 * ROW_H });

    let cursor = startY;
    for (const kid of kids) {
      const kh = subtreeHeight(kid.id);
      assign(kid.id, depth + 1, cursor);
      cursor += kh;
    }
  }

  const root = treeNodes.find((n) => n.parent_id === null);
  if (root) {
    assign(root.id, 0, 0);
  }

  const rfNodes: Node<NodeData>[] = treeNodes.map((n) => {
    const pos = posMap.get(n.id) ?? { x: 0, y: 0 };
    const parent = n.parent_id ? byId.get(n.parent_id) : null;
    const isMainChild = parent?.main_child_id === n.id;
    const siblings = childrenOf.get(n.parent_id ?? null) ?? [];

    return {
      id: n.id,
      type: "chatNode",
      position: pos,
      data: {
        treeNode: n,
        isOnActivePath: activePathIds.has(n.id),
        onNodeClick,
        onSetMainChild,
        isMainChild,
        siblings,
      },
    };
  });

  const rfEdges: Edge[] = treeNodes
    .filter((n) => n.parent_id !== null)
    .map((n) => {
      const parent = byId.get(n.parent_id!);
      const isMain = parent?.main_child_id === n.id;
      return {
        id: `e-${n.parent_id}-${n.id}`,
        source: n.parent_id!,
        target: n.id,
        style: isMain
          ? { stroke: "#3b82f6", strokeWidth: 2.5 }
          : { stroke: "#4b5563", strokeWidth: 1.2, strokeDasharray: "5,4" },
        animated: isMain,
      };
    });

  return { nodes: rfNodes, edges: rfEdges };
}

// ─── Main TreeView component ───────────────────────────────────────────────
type TreeViewProps = {
  treeNodes: TreeNode[];
  activePathIds: Set<string>;         // IDs of nodes currently shown in chat
  onSelectLeaf: (nodeId: string) => void;   // called with the effective leaf to navigate to
  onSetMainChild: (parentId: string, childId: string) => void;
  onClose: () => void;
};

function InnerFlow({
  treeNodes,
  activePathIds,
  onSelectLeaf,
  onSetMainChild,
}: Omit<TreeViewProps, "onClose">) {
  const { fitView } = useReactFlow();

  // Follow main_child_id chain from a node to find the effective leaf
  const findEffectiveLeaf = useCallback(
    (startNode: TreeNode): TreeNode => {
      const byId = new Map(treeNodes.map((n) => [n.id, n]));
      let current = startNode;
      while (current.main_child_id) {
        const next = byId.get(current.main_child_id);
        if (!next) break;
        current = next;
      }
      return current;
    },
    [treeNodes],
  );

  const handleNodeClick = useCallback(
    (node: TreeNode) => {
      const leaf = findEffectiveLeaf(node);
      onSelectLeaf(leaf.id);
    },
    [findEffectiveLeaf, onSelectLeaf],
  );

  const { nodes, edges } = useMemo(
    () => buildLayout(treeNodes, activePathIds, handleNodeClick, onSetMainChild),
    [treeNodes, activePathIds, handleNodeClick, onSetMainChild],
  );

  // Re-fit whenever the tree nodes change
  useEffect(() => {
    const timer = setTimeout(() => fitView({ padding: 0.15 }), 80);
    return () => clearTimeout(timer);
  // fitView identity changes; treeNodes is the meaningful dependency
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background color="#1f2937" gap={20} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(n) =>
          (n.data as NodeData).isOnActivePath ? "#3b82f6" : "#374151"
        }
        style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}
      />
    </ReactFlow>
  );
}


export default function TreeView(props: TreeViewProps) {
  return (
    <div className="tree-drawer">
      <div className="tree-drawer-header">
        <span className="tree-drawer-title">🌲 Conversation Tree</span>
        <div className="tree-drawer-hint">
          Click any node to navigate · Blue edges = main path · ★ marks main child
        </div>
        <button className="tree-close-btn" onClick={props.onClose}>✕ Close</button>
      </div>
      <div className="tree-drawer-body">
        <ReactFlowProvider>
          <InnerFlow
            treeNodes={props.treeNodes}
            activePathIds={props.activePathIds}
            onSelectLeaf={props.onSelectLeaf}
            onSetMainChild={props.onSetMainChild}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
