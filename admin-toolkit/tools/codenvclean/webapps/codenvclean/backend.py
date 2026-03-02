import dataiku
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import request, jsonify, Response


def _dss_get(path):
    """Make an authenticated GET request to the DSS internal API."""
    client = dataiku.api_client()
    return client._perform_json("GET", path)


def _dss_delete(path):
    """Make an authenticated DELETE request to the DSS internal API."""
    client = dataiku.api_client()
    return client._perform_empty("DELETE", path)


def _filter_envs(envs):
    """Filter out plugin-managed and DSS-internal environments."""
    return [
        e for e in envs
        if e.get("deploymentMode", "") not in ("PLUGIN_MANAGED", "DSS_INTERNAL")
    ]


def _fetch_env_with_usages(env_info):
    """Fetch usage info for a single env and return result dict + timing."""
    env_name = env_info["envName"]
    env_lang = env_info["envLang"]
    t0 = time.time()

    try:
        usages = _dss_get(
            "/admin/code-envs/%s/%s/usages" % (env_lang, env_name)
        )
        usage_count = len(usages) if isinstance(usages, list) else 0
    except Exception:
        usages = []
        usage_count = -1

    usage_ms = int((time.time() - t0) * 1000)

    return {
        "envName": env_name,
        "envLang": env_lang,
        "deploymentMode": env_info.get("deploymentMode", ""),
        "owner": env_info.get("owner", ""),
        "pythonInterpreter": env_info.get("pythonInterpreter", ""),
        "usageCount": usage_count,
        "usages": usages if isinstance(usages, list) else [],
    }, usage_ms


@app.route("/api/code-envs")  # noqa: F821
def list_code_envs():
    """List all non-internal code envs with usage info, sorted unused-first."""
    t0 = time.time()
    envs = _dss_get("/admin/code-envs/")
    list_ms = int((time.time() - t0) * 1000)
    app.logger.info("[code-envs] list call: %dms", list_ms)  # noqa: F821

    filtered = _filter_envs(envs)
    results = []
    for env_info in filtered:
        result, usage_ms = _fetch_env_with_usages(env_info)
        app.logger.info(  # noqa: F821
            "[code-envs] usage %s/%s: %dms",
            env_info["envLang"], env_info["envName"], usage_ms,
        )
        results.append(result)

    total_ms = int((time.time() - t0) * 1000)
    app.logger.info(  # noqa: F821
        "[code-envs] total: %dms for %d envs", total_ms, len(results),
    )

    results.sort(key=lambda e: (e["usageCount"] != 0, e["envName"].lower()))
    return jsonify(results)


@app.route("/api/code-envs/stream")  # noqa: F821
def stream_code_envs():
    """Stream code env data via SSE for real-time progress.

    Query params:
        threads: number of parallel threads for usage checks (1-20, default 1)
    """
    threads = request.args.get("threads", "1", type=str)
    try:
        threads = max(1, min(20, int(threads)))
    except (ValueError, TypeError):
        threads = 1

    def generate():
        t0 = time.time()

        try:
            all_envs = _dss_get("/admin/code-envs/")
        except Exception as e:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": str(e)})
            return

        filtered = _filter_envs(all_envs)
        list_ms = int((time.time() - t0) * 1000)

        yield "event: init\ndata: %s\n\n" % json.dumps({
            "total": len(filtered),
            "list_ms": list_ms,
            "threads": threads,
        })

        if threads <= 1:
            # Sequential mode (original behavior)
            for i, env_info in enumerate(filtered):
                result, usage_ms = _fetch_env_with_usages(env_info)
                result["index"] = i
                result["usage_ms"] = usage_ms
                yield "event: env\ndata: %s\n\n" % json.dumps(result)
        else:
            # Parallel mode: submit all, yield as they complete
            counter = [0]
            with ThreadPoolExecutor(max_workers=threads) as pool:
                futures = {
                    pool.submit(_fetch_env_with_usages, env_info): env_info
                    for env_info in filtered
                }
                for future in as_completed(futures):
                    result, usage_ms = future.result()
                    result["index"] = counter[0]
                    result["usage_ms"] = usage_ms
                    counter[0] += 1
                    yield "event: env\ndata: %s\n\n" % json.dumps(result)

        total_ms = int((time.time() - t0) * 1000)
        yield "event: done\ndata: %s\n\n" % json.dumps({"total_ms": total_ms})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/code-envs/<lang>/<name>", methods=["DELETE"])  # noqa: F821
def delete_code_env(lang, name):
    """Delete a code env after verifying the confirmation header."""
    confirm = request.headers.get("X-Confirm-Name", "")
    if confirm != name:
        return jsonify({"error": "Confirmation header does not match env name"}), 400

    try:
        _dss_delete("/admin/code-envs/%s/%s/" % (lang, name))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"deleted": name}), 200
