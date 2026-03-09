# Dataiku API Reference Chunking

This repo now includes a no-dependency parser/chunker for your `index.html` API dump.

## What was generated

- `build/api_reference.json`
  - Canonical structured export (overview, modules, resources, endpoints, params, request/response sections).
- `build/chunks.jsonl`
  - Retrieval-ready chunks (one JSON object per line).
  - Chunk kinds:
    - `global_overview` (read-first context)
    - `group_overview` (module -> resource map)
    - `resource_overview` (resource -> endpoint map)
    - `endpoint_core` (small, high-signal endpoint summary)
    - `endpoint_request_description`, `endpoint_request_section`
    - `endpoint_response_description`, `endpoint_response_section`
- `build/manifest.json`
  - Counts and generation stats.

## Rebuild

```bash
python3 scripts/build_api_chunks.py --input index.html --out-dir build
```

## Recommended retrieval strategy

1. Retrieve from `endpoint_core` first (`kind == "endpoint_core"`).
2. Add matching request/response detail chunks only if needed.
3. Include `global_overview` for broad or ambiguous questions.
4. Use metadata filters when possible:
   - `method`
   - `path`
   - `group_name`
   - `resource_name`
   - `param_names`

## Minimal local search example

```bash
python3 scripts/retrieve_chunks.py \
  --chunks build/chunks.jsonl \
  --query "create project" \
  --top-k 8
```
