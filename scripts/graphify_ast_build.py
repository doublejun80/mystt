#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from graphify.analyze import god_nodes, suggest_questions, surprising_connections
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.detect import detect
from graphify.export import to_html, to_json
from graphify.extract import extract
from graphify.report import generate
from graphify.wiki import to_wiki


def _preserve_semantic_graph(graph_path: Path) -> tuple[list[dict], list[dict], list[dict]]:
    if not graph_path.exists():
        return [], [], []

    try:
        existing = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception:
        return [], [], []

    nodes = existing.get("nodes", [])
    edges = existing.get("links", existing.get("edges", []))
    code_ids = {node["id"] for node in nodes if node.get("file_type") == "code"}

    semantic_nodes = [node for node in nodes if node.get("file_type") != "code"]
    semantic_edges = [
        edge
        for edge in edges
        if edge.get("confidence") in {"INFERRED", "AMBIGUOUS"}
        or (edge.get("source") not in code_ids and edge.get("target") not in code_ids)
    ]

    return semantic_nodes, semantic_edges, existing.get("hyperedges", [])


def _node_community_map(communities: dict[int, list[str]]) -> dict[str, int]:
    return {node_id: community_id for community_id, node_ids in communities.items() for node_id in node_ids}


def build_graph(root: Path) -> dict[str, object]:
    out_dir = root / "graphify-out"
    wiki_dir = out_dir / "wiki"
    out_dir.mkdir(parents=True, exist_ok=True)

    detection_result = detect(root)
    (out_dir / ".graphify_python").write_text(sys.executable, encoding="utf-8")
    (out_dir / ".graphify_detect.json").write_text(
        json.dumps(detection_result, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    code_files = [Path(path) for path in detection_result.get("files", {}).get("code", [])]
    if not code_files:
        raise SystemExit("No code files found for graphify AST build.")

    ast_result = extract(code_files, cache_root=out_dir / "cache")
    (out_dir / ".graphify_ast.json").write_text(
        json.dumps(ast_result, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    semantic_nodes, semantic_edges, hyperedges = _preserve_semantic_graph(out_dir / "graph.json")
    merged_result = {
        "nodes": ast_result.get("nodes", []) + semantic_nodes,
        "edges": ast_result.get("edges", []) + semantic_edges,
        "hyperedges": hyperedges,
        "input_tokens": 0,
        "output_tokens": 0,
    }

    graph = build_from_json(merged_result)
    communities = cluster(graph)
    node_communities = _node_community_map(communities)
    for node_id, community_id in node_communities.items():
        graph.nodes[node_id]["community"] = community_id

    cohesion = score_all(graph, communities)
    labels = {community_id: f"Community {community_id}" for community_id in communities}
    gods = god_nodes(graph)
    surprises = surprising_connections(graph, communities)
    questions = suggest_questions(graph, communities, labels)

    report = generate(
        graph,
        communities,
        cohesion,
        labels,
        gods,
        surprises,
        detection_result,
        {"input": 0, "output": 0},
        root.name or str(root),
        suggested_questions=questions,
    )

    (out_dir / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    (out_dir / "community_labels.json").write_text(
        json.dumps(labels, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    to_json(graph, communities, str(out_dir / "graph.json"))

    try:
        to_html(graph, communities, str(out_dir / "graph.html"), community_labels=labels)
    except ValueError:
        pass

    to_wiki(
        graph,
        communities,
        wiki_dir,
        community_labels=labels,
        cohesion=cohesion,
        god_nodes_data=gods,
    )

    analysis = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "ast_only",
        "root": str(root),
        "total_files": detection_result.get("total_files", 0),
        "total_words": detection_result.get("total_words", 0),
        "code_files": len(code_files),
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "communities": len(communities),
        "preserved_semantic_nodes": len(semantic_nodes),
        "preserved_semantic_edges": len(semantic_edges),
        "god_nodes": gods,
        "surprising_connections": surprises,
        "suggested_questions": questions,
    }
    (root / ".graphify_analysis.json").write_text(
        json.dumps(analysis, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return {
        "graph": graph,
        "communities": communities,
        "code_files": len(code_files),
        "total_files": detection_result.get("total_files", 0),
        "total_words": detection_result.get("total_words", 0),
        "preserved_semantic_nodes": len(semantic_nodes),
        "preserved_semantic_edges": len(semantic_edges),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a local AST-first graphify graph.")
    parser.add_argument("path", nargs="?", default=".", help="Repository root to index")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    result = build_graph(root)
    graph = result["graph"]
    communities = result["communities"]
    print(
        "graphify AST build complete: "
        f"{graph.number_of_nodes()} nodes, "
        f"{graph.number_of_edges()} edges, "
        f"{len(communities)} communities"
    )
    print(
        "corpus: "
        f"{result['total_files']} files, "
        f"{result['total_words']:,} words, "
        f"{result['code_files']} code files"
    )
    if result["preserved_semantic_nodes"] or result["preserved_semantic_edges"]:
        print(
            "preserved existing semantic graph data: "
            f"{result['preserved_semantic_nodes']} nodes, "
            f"{result['preserved_semantic_edges']} edges"
        )
    print(f"outputs: {root / 'graphify-out'}")


if __name__ == "__main__":
    main()
