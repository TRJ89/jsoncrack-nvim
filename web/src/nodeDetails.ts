import type { GraphData, NodeData } from "jsoncrack-react";

export type NodeDetails = {
  content: string;
  path: string;
  omittedChildContainers?: boolean;
};

type PathSegment = string | number;
type SourceNode = {
  id: string;
  path: PathSegment[];
  value: unknown;
};

const IDENTIFIER_PROPERTY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rendererType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "object";
  return typeof value;
}

function pathKey(path: PathSegment[]): string {
  return JSON.stringify(path);
}

function formatPath(path: PathSegment[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${segment}]`;
    if (IDENTIFIER_PROPERTY.test(segment)) return `${formatted}.${segment}`;
    return `${formatted}[${JSON.stringify(segment)}]`;
  }, "$" as string);
}

function serialize(value: unknown): string | null {
  try {
    const content = JSON.stringify(value, null, 2);
    return content === undefined ? null : content;
  } catch {
    return null;
  }
}

type ParsedSource = { ok: true; value: unknown } | { ok: false };

function parseSource(sourceJson: string): ParsedSource {
  try {
    return { ok: true, value: JSON.parse(sourceJson) as unknown };
  } catch {
    return { ok: false };
  }
}

function objectNodeValue(value: Record<string, unknown>): {
  value: Record<string, unknown>;
  omittedChildContainers: boolean;
} {
  const local = Object.create(null) as Record<string, unknown>;
  let omittedChildContainers = false;

  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      if (child.length === 0) local[key] = child;
      else omittedChildContainers = true;
    } else if (isRecord(child)) {
      if (Object.keys(child).length === 0) local[key] = child;
      else omittedChildContainers = true;
    } else {
      local[key] = child;
    }
  }

  return { value: local, omittedChildContainers };
}

function collectRendererNodes(root: unknown): Map<string, SourceNode> {
  const byId = new Map<string, SourceNode>();
  let nextId = 1;

  const visit = (value: unknown, path: PathSegment[]): void => {
    const id = String(nextId++);
    byId.set(id, { id, path, value });

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
      return;
    }

    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (Array.isArray(child)) {
        child.forEach((item, index) => visit(item, [...path, key, index]));
      } else if (isRecord(child)) {
        visit(child, [...path, key]);
      }
    }
  };

  visit(root, []);
  return byId;
}

function rowList(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  return value.every((row) => typeof row === "object" && row !== null)
    ? (value as Array<Record<string, unknown>>)
    : null;
}

function matchesNodeText(value: unknown, node: NodeData): boolean {
  const text: unknown = node.text;
  if (Array.isArray(value)) {
    const rows = rowList(text);
    return rows?.length === 1 &&
      rows[0].key === null &&
      rows[0].type === "array" &&
      rows[0].value === `[${value.length} items]` &&
      rows[0].childrenCount === value.length;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      const rows = rowList(text);
      return rows?.length === 1 &&
        rows[0].key === null &&
        rows[0].type === "object" &&
        rows[0].value === "{0 keys}" &&
        rows[0].childrenCount === 0;
    }

    const rows = rowList(text);
    if (!rows || rows.length !== entries.length) return false;
    return entries.every(([key, child], index) => {
      const row = rows[index];
      if (row.key !== key || row.type !== rendererType(child)) return false;
      if (Array.isArray(child)) return row.childrenCount === child.length;
      if (isRecord(child)) return row.childrenCount === Object.keys(child).length;
      return row.value === child;
    });
  }

  const rows = rowList(text);
  return rows?.length === 1 &&
    rows[0].key === null &&
    rows[0].type === rendererType(value) &&
    rows[0].value === value;
}

function expectedOutgoingEdges(
  sourceNode: SourceNode,
  byPath: Map<string, SourceNode>,
  graphNodeIds: Set<string>,
): Array<{ to: string; text: string }> {
  const targets: Array<{ path: PathSegment[]; text: string }> = [];
  if (Array.isArray(sourceNode.value)) {
    sourceNode.value.forEach((_item, index) => {
      targets.push({ path: [...sourceNode.path, index], text: "" });
    });
  } else if (isRecord(sourceNode.value)) {
    for (const [key, child] of Object.entries(sourceNode.value)) {
      if (Array.isArray(child)) {
        child.forEach((_item, index) => {
          targets.push({ path: [...sourceNode.path, key, index], text: key });
        });
      } else if (isRecord(child)) {
        targets.push({ path: [...sourceNode.path, key], text: key });
      }
    }
  }

  return targets.flatMap(({ path, text }) => {
    const target = byPath.get(pathKey(path));
    return target && graphNodeIds.has(target.id) ? [{ to: target.id, text }] : [];
  });
}

function expectedIncomingEdge(
  sourceNode: SourceNode,
  byPath: Map<string, SourceNode>,
  graphNodeIds: Set<string>,
): { from: string; text: string } | null {
  if (sourceNode.path.length === 0) return null;

  const segment = sourceNode.path[sourceNode.path.length - 1];
  if (typeof segment === "string") {
    const parent = byPath.get(pathKey(sourceNode.path.slice(0, -1)));
    return parent && graphNodeIds.has(parent.id) ? { from: parent.id, text: segment } : null;
  }

  const arrayPath = sourceNode.path.slice(0, -1);
  const arrayParent = byPath.get(pathKey(arrayPath));
  if (arrayParent && graphNodeIds.has(arrayParent.id) && Array.isArray(arrayParent.value)) {
    return { from: arrayParent.id, text: "" };
  }

  if (arrayPath.length === 0) return null;
  const property = arrayPath[arrayPath.length - 1];
  if (typeof property !== "string") return null;
  const objectParent = byPath.get(pathKey(arrayPath.slice(0, -1)));
  return objectParent && graphNodeIds.has(objectParent.id)
    ? { from: objectParent.id, text: property }
    : null;
}

function sameConnections(
  graph: GraphData,
  sourceNode: SourceNode,
  byPath: Map<string, SourceNode>,
): boolean {
  const graphNodeIds = new Set(graph.nodes.map(({ id }) => id));
  const outgoing = graph.edges
    .filter((edge) => edge.from === sourceNode.id)
    .map(({ to, text }) => ({ to, text: text ?? "" }))
    .sort((left, right) => left.to.localeCompare(right.to) || left.text.localeCompare(right.text));
  const expectedOutgoing = expectedOutgoingEdges(sourceNode, byPath, graphNodeIds)
    .sort((left, right) => left.to.localeCompare(right.to) || left.text.localeCompare(right.text));
  if (JSON.stringify(outgoing) !== JSON.stringify(expectedOutgoing)) return false;

  const expectedIncoming = expectedIncomingEdge(sourceNode, byPath, graphNodeIds);
  const incoming = graph.edges
    .filter((edge) => edge.to === sourceNode.id)
    .map(({ from, text }) => ({ from, text: text ?? "" }));
  if (!expectedIncoming) return incoming.length === 0;
  return incoming.length === 1 &&
    incoming[0].from === expectedIncoming.from &&
    incoming[0].text === expectedIncoming.text;
}

export function resolveRootDetails(sourceJson: string): NodeDetails | null {
  const parsed = parseSource(sourceJson);
  if (!parsed.ok) return null;
  const value = parsed.value;
  if (value === null || (isRecord(value) && Object.keys(value).length !== 0) ||
      (Array.isArray(value) && value.length !== 0)) {
    return null;
  }
  const content = serialize(value);
  return content === null ? null : { content, path: "$" };
}

/**
 * Resolve a clicked renderer node through the source tree. The pinned parser
 * gives nested arrays an empty `path`; IDs, local node text, and graph edges
 * are checked together so that this metadata bug cannot silently become `$`.
 */
export function resolveNodeDetails(
  sourceJson: string,
  graph: GraphData,
  clickedNode: NodeData,
): NodeDetails | null {
  const parsed = parseSource(sourceJson);
  if (!parsed.ok) return null;
  const root = parsed.value;

  const graphNode = graph.nodes.find(({ id }) => id === clickedNode.id);
  if (!graphNode) return null;

  const byId = collectRendererNodes(root);
  const sourceNode = byId.get(graphNode.id);
  if (!sourceNode || !matchesNodeText(sourceNode.value, graphNode)) return null;

  const byPath = new Map<string, SourceNode>();
  for (const node of byId.values()) byPath.set(pathKey(node.path), node);
  if (!sameConnections(graph, sourceNode, byPath)) return null;

  const projected = isRecord(sourceNode.value) ? objectNodeValue(sourceNode.value) : null;
  const content = serialize(projected?.value ?? sourceNode.value);
  return content === null
    ? null
    : {
        content,
        path: formatPath(sourceNode.path),
        ...(projected?.omittedChildContainers ? { omittedChildContainers: true } : {}),
      };
}
