import { parseGraph, type GraphData, type NodeData } from "jsoncrack-react";
import { describe, expect, it } from "vitest";
import { resolveNodeDetails } from "../src/nodeDetails";

function graphNode(
  source: string,
  predicate: (node: NodeData) => boolean,
): { graph: GraphData; node: NodeData } {
  const graph = parseGraph(source);
  const node = graph.nodes.find(predicate);
  if (!node) throw new Error("Expected renderer node was not present.");
  return { graph, node };
}

describe("resolveNodeDetails", () => {
  it("preserves a long primitive value without the renderer's truncation", () => {
    const value = "complete value ".repeat(12);
    const source = JSON.stringify(value);
    const { graph, node } = graphNode(
      source,
      (candidate) => candidate.text[0]?.type === "string",
    );

    expect(resolveNodeDetails(source, graph, node)).toEqual({
      content: JSON.stringify(value, null, 2),
      path: "$",
    });
  });

  it("shows direct values and empty containers for the selected object", () => {
    const source = '{"peer":{"hidden":true},"target":{"count":2,"emptyObject":{},"emptyArray":[],"child":{"enabled":true},"items":[1]}}';
    const { graph, node } = graphNode(
      source,
      (candidate) => JSON.stringify(candidate.path) === JSON.stringify(["target"]),
    );

    expect(resolveNodeDetails(source, graph, node)).toEqual({
      content: '{\n  "count": 2,\n  "emptyObject": {},\n  "emptyArray": []\n}',
      path: "$.target",
      omittedChildContainers: true,
    });
  });

  it("uses an empty object for an object node whose values are all child containers", () => {
    const source = '{"target":{"child":{"enabled":true},"items":[1,2]}}';
    const { graph, node } = graphNode(
      source,
      (candidate) => JSON.stringify(candidate.path) === JSON.stringify(["target"]),
    );

    expect(resolveNodeDetails(source, graph, node)).toEqual({
      content: "{}",
      path: "$.target",
      omittedChildContainers: true,
    });
  });

  it("shows the complete value and root path for an array node", () => {
    const source = '[1,{"name":"Ada"},[]]';
    const { graph, node } = graphNode(source, (candidate) => candidate.id === "1");

    expect(resolveNodeDetails(source, graph, node)).toEqual({
      content: '[\n  1,\n  {\n    "name": "Ada"\n  },\n  []\n]',
      path: "$",
    });
  });

  it("resolves empty object and array nodes to actual empty containers", () => {
    const source = "[{},[]]";
    const graph = parseGraph(source);
    const nodes = graph.nodes;
    const emptyObjectNode = nodes.find(
      (node) => node.text[0]?.type === "object" && node.text[0]?.value === "{0 keys}",
    );
    const emptyArrayNode = nodes.find(
      (node) => node.text[0]?.type === "array" && node.text[0]?.value === "[0 items]",
    );
    if (!emptyObjectNode || !emptyArrayNode) throw new Error("Expected empty renderer nodes.");
    expect(resolveNodeDetails(source, graph, emptyObjectNode)).toEqual({
      content: "{}",
      path: "$[0]",
    });
    expect(resolveNodeDetails(source, graph, emptyArrayNode)).toEqual({
      content: "[]",
      path: "$[1]",
    });
  });

  it("derives distinct indices for nested arrays whose renderer paths are empty", () => {
    const source = "[[1],[2]]";
    const nestedArrays = parseGraph(source).nodes.filter(
      (node) => node.text[0]?.type === "array" && node.text[0]?.value === "[1 items]",
    );
    expect(nestedArrays).toHaveLength(2);
    expect(nestedArrays.map((node) => node.path)).toEqual([[], []]);

    const graph = parseGraph(source);
    expect(resolveNodeDetails(source, graph, nestedArrays[0])).toEqual({
      content: "[\n  1\n]",
      path: "$[0]",
    });
    expect(resolveNodeDetails(source, graph, nestedArrays[1])).toEqual({
      content: "[\n  2\n]",
      path: "$[1]",
    });
  });

  it("quotes unusual property names in the formatted JSON path", () => {
    const source = '{"a.b\\\"c":{"x/y":1}}';
    const { graph, node } = graphNode(
      source,
      (candidate) => JSON.stringify(candidate.path) === JSON.stringify(['a.b"c']),
    );

    expect(resolveNodeDetails(source, graph, node)).toEqual({
      content: '{\n  "x/y": 1\n}',
      path: '$["a.b\\\"c"]',
    });
  });

  it("resolves a valid root null instead of treating it as a parse failure", () => {
    const source = "null";
    const { graph, node } = graphNode(source, (candidate) => candidate.id === "1");

    expect(resolveNodeDetails(source, graph, node)).toEqual({
      content: "null",
      path: "$",
    });
  });

  it("preserves special object keys in the node-local projection", () => {
    const source = '{"__proto__":1,"constructor":null}';
    const { graph, node } = graphNode(source, (candidate) => candidate.id === "1");

    expect(resolveNodeDetails(source, graph, node)).toEqual({
      content: '{\n  "__proto__": 1,\n  "constructor": null\n}',
      path: "$",
    });
  });
});
