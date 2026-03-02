#!/usr/bin/env python3
"""
Seed ZZBENCH projects with notebook-level code env usage.

For each selected project:
- randomly choose 1..4 code envs
- create one notebook per selected env
- encode env choice in notebook kernelspec

This avoids project-default code env changes and keeps setup simple.
"""

import argparse
import os
import random
import sys
from pathlib import Path
from typing import Dict, List

from dataikuapi import DSSClient


def _read_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def _load_credentials(repo_root: Path) -> Dict[str, str]:
    url = os.environ.get("DSS_URL", "").strip()
    key = os.environ.get("DSS_API_KEY", "").strip()

    if not url:
        file_path = repo_root / ".dss-url"
        if file_path.exists():
            url = _read_text_file(file_path)
    if not key:
        file_path = repo_root / ".dss-api-key"
        if file_path.exists():
            key = _read_text_file(file_path)

    if not url or not key:
        raise RuntimeError("Missing DSS_URL / DSS_API_KEY (or .dss-url / .dss-api-key)")

    return {"url": url, "key": key}


def _mk_notebook_content(env_name: str) -> Dict:
    return {
        "cells": [
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": [f"# benchmark notebook for {env_name}\n"],
            }
        ],
        "metadata": {
            "kernelspec": {
                "display_name": f"Python (env {env_name})",
                "language": "python",
                "name": f"py-dku-venv-{env_name}",
            },
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed benchmark notebook usage across projects")
    parser.add_argument("--project-prefix", default="ZZBENCH_", help="Project key prefix")
    parser.add_argument("--env-prefix", default="zzbench-env-", help="Code env name prefix")
    parser.add_argument("--project-limit", type=int, default=10, help="Number of projects to target")
    parser.add_argument("--env-limit", type=int, default=10, help="Number of code envs to draw from")
    parser.add_argument("--min-envs", type=int, default=1, help="Minimum envs per project")
    parser.add_argument("--max-envs", type=int, default=4, help="Maximum envs per project")
    parser.add_argument("--seed", type=int, default=None, help="Random seed (optional)")
    parser.add_argument(
        "--keep-existing-notebooks",
        action="store_true",
        help="Do not delete existing notebooks in target projects",
    )
    args = parser.parse_args()

    if args.min_envs < 1 or args.max_envs < args.min_envs:
        raise RuntimeError("Invalid env range")

    repo_root = Path(__file__).resolve().parents[1]
    creds = _load_credentials(repo_root)
    client = DSSClient(creds["url"], creds["key"])

    rng = random.Random(args.seed)

    all_projects = client.list_projects() or []
    project_keys = sorted(
        [
            str(p.get("projectKey", "")).strip()
            for p in all_projects
            if isinstance(p, dict) and str(p.get("projectKey", "")).startswith(args.project_prefix)
        ]
    )
    project_keys = project_keys[: args.project_limit]

    all_envs = client.list_code_envs() or []
    env_names = sorted(
        [
            str(e.get("envName", "")).strip()
            for e in all_envs
            if isinstance(e, dict) and str(e.get("envName", "")).startswith(args.env_prefix)
        ]
    )
    env_names = env_names[: args.env_limit]

    if not project_keys:
        raise RuntimeError(f"No projects found with prefix {args.project_prefix}")
    if not env_names:
        raise RuntimeError(f"No code envs found with prefix {args.env_prefix}")

    print(f"Using {len(project_keys)} projects: {', '.join(project_keys)}")
    print(f"Using {len(env_names)} code envs: {', '.join(env_names)}")
    print(f"Random seed: {args.seed if args.seed is not None else 'system-random'}")

    summary: List[Dict[str, object]] = []

    for project_key in project_keys:
        project = client.get_project(project_key)
        existing = project.list_jupyter_notebooks() or []

        if not args.keep_existing_notebooks:
            for nb in existing:
                try:
                    nb.delete()
                except Exception as exc:  # noqa: BLE001
                    print(f"[warn] {project_key}: failed deleting notebook {nb.notebook_name}: {exc}")

        max_envs_for_project = min(args.max_envs, len(env_names))
        env_count = rng.randint(args.min_envs, max_envs_for_project)
        selected = sorted(rng.sample(env_names, env_count))

        created_names: List[str] = []
        for idx, env_name in enumerate(selected, start=1):
            notebook_name = f"bench_env_use_{idx:02d}_{env_name}"
            content = _mk_notebook_content(env_name)
            project.create_jupyter_notebook(notebook_name, content)
            created_names.append(notebook_name)

        summary.append(
            {
                "projectKey": project_key,
                "envCount": env_count,
                "envs": selected,
                "notebooks": created_names,
            }
        )
        print(f"[ok] {project_key}: envs={env_count} -> {', '.join(selected)}")

    print("\n=== Final assignment ===")
    for row in summary:
        print(
            f"{row['projectKey']}: envs={row['envCount']} | "
            f"{', '.join(row['envs'])}"
        )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"[error] {exc}", file=sys.stderr)
        raise
