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
  isOnActivePath: boolean;
  onNodeClick: (n: TreeNode) => void;
  onChatFromNode: (nodeId: string) => void;
  onSetMainChild: (parentId: string, childId: string) => void;
  isMainChild: boolean;
};

// ─── Custom RF node renderer ───────────────────────────────────────────────
function ChatNode({ data }: NodeProps<NodeData>) {
  const { treeNode, isOnActivePath, onNodeClick, onChatFromNode, onSetMainChild, isMainChild } = data;

  // visually a leaf = no main_child_id
  const hasNoChildren = treeNode.main_child_id === null;

  const shortPrompt = treeNode.prompt.length > 55
    ? treeNode.prompt.slice(0, 55) + "…"
    : treeNode.prompt;
  const shortResp = treeNode.response.length > 60
    ? treeNode.response.slice(0, 60) + "…"
    : treeNode.response;
  const modelShort = treeNode.model_used.split("/").pop() ?? treeNode.model_used;

  return (
    <div
      className={[
        "rf-node",
        isOnActivePath ? "rf-node--active" : "",
        hasNoChildren ? "rf-node--leaf" : "",
      ].join(" ")}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      {/* Top area: prompt + response preview — clicking reads this branch */}
      <div className="rf-node-body" onClick={() => onNodeClick(treeNode)} title="View this branch">
        <div className="rf-node-prompt">{shortPrompt}</div>
        <div className="rf-node-response">{shortResp}</div>
      </div>

      <div className="rf-node-footer">
        <span className="rf-model-badge">{modelShort}</span>
        {isMainChild && <span className="rf-main-badge">★ main</span>}
        {hasNoChildren && <span className="rf-leaf-badge">leaf</span>}

        <div className="rf-node-actions">
          {/* Chat from here — loads path to exactly this node, closes tree */}
          <button
            className="rf-chat-btn"
            title="Continue chatting from this node"
            onClick={(e) => {
              e.stopPropagation();
              onChatFromNode(treeNode.id);
            }}
          >
            ▶ Chat here
          </button>

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
        </div>
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
  onChatFromNode: (nodeId: string) => void,
  onSetMainChild: (parentId: string, childId: string) => void,
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const byId = new Map(treeNodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, TreeNode[]>();

  for (const n of treeNodes) {
    const key = n.parent_id ?? null;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(n);
  }

  const posMap = new Map<string, { x: number; y: number }>();

  function subtreeHeight(nodeId: string): number {
    const kids = childrenOf.get(nodeId) ?? [];
    if (kids.length === 0) return 1;
    return kids.reduce((acc, k) => acc + subtreeHeight(k.id), 0);
  }

  function assign(nodeId: string, depth: number, startY: number): void {
    const kids = childrenOf.get(nodeId) ?? [];
    const h = subtreeHeight(nodeId);
    posMap.set(nodeId, { x: depth * COL_W, y: ((startY * 2 + h - 1) / 2) * ROW_H });
    let cursor = startY;
    for (const kid of kids) {
      assign(kid.id, depth + 1, cursor);
      cursor += subtreeHeight(kid.id);
    }
  }

  const root = treeNodes.find((n) => n.parent_id === null);
  if (root) assign(root.id, 0, 0);

  const rfNodes: Node<NodeData>[] = treeNodes.map((n) => {
    const pos = posMap.get(n.id) ?? { x: 0, y: 0 };
    const parent = n.parent_id ? byId.get(n.parent_id) : null;
    const isMainChild = parent?.main_child_id === n.id;

    return {
      id: n.id,
      type: "chatNode",
      position: pos,
      data: {
        treeNode: n,
        isOnActivePath: activePathIds.has(n.id),
        onNodeClick,
        onChatFromNode,
        onSetMainChild,
        isMainChild,
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
  activePathIds: Set<string>;
  onSelectLeaf: (nodeId: string) => void;   // click body → resolve leaf → load path
  onChatFromNode: (nodeId: string) => void; // "Chat here" → load path to exactly this node
  onSetMainChild: (parentId: string, childId: string) => void;
  onClose: () => void;
};

function InnerFlow({
  treeNodes,
  activePathIds,
  onSelectLeaf,
  onChatFromNode,
  onSetMainChild,
}: Omit<TreeViewProps, "onClose">) {
  const { fitView } = useReactFlow();

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
    () => buildLayout(treeNodes, activePathIds, handleNodeClick, onChatFromNode, onSetMainChild),
    [treeNodes, activePathIds, handleNodeClick, onChatFromNode, onSetMainChild],
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
          Click node body → view branch · ▶ Chat here → continue from that point · ☆ set main → change main path
        </div>
        <button className="tree-close-btn" onClick={props.onClose}>✕ Close</button>
      </div>
      <div className="tree-drawer-body">
        <ReactFlowProvider>
          <InnerFlow
            treeNodes={props.treeNodes}
            activePathIds={props.activePathIds}
            onSelectLeaf={props.onSelectLeaf}
            onChatFromNode={props.onChatFromNode}
            onSetMainChild={props.onSetMainChild}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
