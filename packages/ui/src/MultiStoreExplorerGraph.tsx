import dagre from "@dagrejs/dagre";
import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  buildMultiStoreLinkGraph,
  type RegisteredStore,
} from "@mobx-devtools/sdk";

const NODE_W = 200;
const NODE_H = 48;

export type MultiStoreGraphTheme = {
  bg: string;
  bgRaised: string;
  border: string;
  accent: string;
  text: string;
  textMuted: string;
};

function layoutWithDagre(
  baseNodes: { id: string; label: string }[],
  edgeList: { source: string; target: string }[],
): Node[] {
  if (baseNodes.length === 0) return [];
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 52,
    ranksep: 88,
    marginx: 28,
    marginy: 28,
  });
  const idSet = new Set(baseNodes.map((n) => n.id));
  for (const n of baseNodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of edgeList) {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);
  return baseNodes.map((n) => {
    const p = g.node(n.id);
    const x = p?.x ?? 0;
    const y = p?.y ?? 0;
    return {
      id: n.id,
      position: { x: x - NODE_W / 2, y: y - NODE_H / 2 },
      data: { label: n.label },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

function FitViewOnGraphChange({
  nodeCount,
  edgeCount,
}: {
  nodeCount: number;
  edgeCount: number;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fitView({ padding: 0.14, duration: 240 });
    });
    return () => cancelAnimationFrame(id);
  }, [nodeCount, edgeCount, fitView]);
  return null;
}

function MultiStoreExplorerFlow({
  stores,
  selectedId,
  onSelectStore,
  isRemote,
  graphTheme: t,
}: {
  stores: RegisteredStore[];
  selectedId: string | null;
  onSelectStore: (id: string | null) => void;
  isRemote: boolean;
  graphTheme: MultiStoreGraphTheme;
}) {
  const { nodes, edges, truncated, edgeCount } = useMemo(() => {
    const r = buildMultiStoreLinkGraph(stores);
    const layouted = layoutWithDagre(r.nodes, r.edges);
    const nodesOut: Node[] = layouted.map((n) => ({
      ...n,
      selected: n.id === selectedId,
      style: {
        background: t.bgRaised,
        border:
          n.id === selectedId
            ? `2px solid ${t.accent}`
            : `1px solid ${t.border}`,
        borderRadius: 8,
        color: t.text,
        fontSize: 11,
        fontWeight: 600,
        padding: "8px 10px",
        width: NODE_W,
        boxSizing: "border-box" as const,
      },
    }));
    const edgesOut: Edge[] = r.edges.map((e, i) => ({
      id: `${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      label:
        e.viaFields.slice(0, 2).join(", ") +
        (e.viaFields.length > 2 ? "…" : ""),
      style: { stroke: t.border, strokeWidth: 1.5 },
      labelStyle: { fill: t.textMuted, fontSize: 9 },
      labelBgStyle: { fill: t.bgRaised, fillOpacity: 0.92 },
      labelBgPadding: [4, 2] as [number, number],
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: t.accent,
      },
    }));
    return {
      nodes: nodesOut,
      edges: edgesOut,
      truncated: r.truncated,
      edgeCount: r.edges.length,
    };
  }, [stores, selectedId, t]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectStore(node.id);
    },
    [onSelectStore],
  );

  const onPaneClick = useCallback(() => {
    onSelectStore(null);
  }, [onSelectStore]);

  if (stores.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: t.textMuted,
          fontSize: 12,
          padding: 24,
        }}
      >
        Нет сторов в реестре — появятся после spy-событий с{" "}
        <code style={{ fontFamily: "inherit", margin: "0 4px" }}>object</code>.
      </div>
    );
  }

  return (
    <ReactFlow
      colorMode="dark"
      nodes={nodes}
      edges={edges}
      fitView
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      proOptions={{ hideAttribution: true }}
      style={{ width: "100%", height: "100%", background: t.bg }}
    >
      <Background gap={22} size={1} color={t.border} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeStrokeWidth={2}
        nodeColor={(n) =>
          n.id === selectedId ? t.accent : t.bgRaised
        }
        maskColor="rgba(0,0,0,0.45)"
        style={{ background: t.bgRaised }}
      />
      <FitViewOnGraphChange
        nodeCount={nodes.length}
        edgeCount={edgeCount}
      />
      {isRemote ? (
        <Panel position="top-center">
          <div
            style={{
              fontSize: 10,
              color: t.textMuted,
              padding: "6px 12px",
              borderRadius: 6,
              border: `1px solid ${t.border}`,
              background: t.bgRaised,
              maxWidth: 420,
              textAlign: "center",
              lineHeight: 1.45,
            }}
          >
            Зеркало: список сторов с другой вкладки. Рёбра строятся по живым
            observable — в этом окне граф может быть без связей.
          </div>
        </Panel>
      ) : null}
      {truncated ? (
        <Panel position="bottom-center">
          <div
            style={{
              fontSize: 9,
              color: t.textMuted,
              padding: "4px 8px",
            }}
          >
            Часть полей не разобрана (лимит обхода) — граф может быть неполным.
          </div>
        </Panel>
      ) : null}
    </ReactFlow>
  );
}

/**
 * Multi-Store Explorer: список сторов уже слева; здесь граф связей (MobX dependency names).
 * Библиотека: @xyflow/react + @dagrejs/dagre.
 */
export function MultiStoreExplorerGraph({
  stores,
  selectedId,
  onSelectStore,
  isRemote,
  graphTheme,
}: {
  stores: RegisteredStore[];
  selectedId: string | null;
  onSelectStore: (id: string | null) => void;
  isRemote: boolean;
  graphTheme: MultiStoreGraphTheme;
}) {
  return (
    <ReactFlowProvider>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ flex: 1, minHeight: 280 }}>
          <MultiStoreExplorerFlow
            stores={stores}
            selectedId={selectedId}
            onSelectStore={onSelectStore}
            isRemote={isRemote}
            graphTheme={graphTheme}
          />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
