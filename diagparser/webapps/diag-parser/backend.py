import json
import logging
import re
import dataiku
from flask import Flask, Response, jsonify, request

app = Flask(__name__)


class _SuppressPingFilter(logging.Filter):
    def filter(self, record):
        return '/__ping' not in record.getMessage()


logging.getLogger('werkzeug').addFilter(_SuppressPingFilter())


@app.route('/__ping')
def ping():
    return ('', 204)


@app.route('/api/llms')
def api_llms():
    try:
        client = dataiku.api_client()
        project = client.get_project(dataiku.default_project_key())
        llms = project.list_llms()
        completion_llms = [
            {'id': llm['id'], 'label': llm.get('friendlyName') or llm['id'], 'type': llm.get('type', '')}
            for llm in llms if llm.get('type') != 'RETRIEVAL_AUGMENTED'
        ]
        return jsonify({'llms': completion_llms})
    except Exception as e:
        return jsonify({'error': str(e), 'llms': []}), 500


@app.route('/api/logs/ai-analysis', methods=['POST'])
def api_logs_ai_analysis():
    """Stream AI log analysis via SSE with phase updates and token streaming.

    The frontend owns the log data (parsed from an uploaded diag ZIP) and sends
    both systemPrompt and userMessage. The backend just relays to the chosen
    LLM and streams tokens back.
    """
    body = request.get_json(force=True)
    llm_id = (body.get('llmId') or '').strip()
    system_prompt = (body.get('systemPrompt') or '').strip()
    user_message = (body.get('userMessage') or '').strip()

    _DEFAULT_SYSTEM_PROMPT = (
        "You are an expert Dataiku DSS administrator and backend engineer "
        "analyzing error logs from a DSS instance's backend.log file.\n\n"
        "Only analyze lines with log4j level WARN, ERROR, FATAL, or SEVERE. "
        "For severity use the exact log4j level from the log line. "
        "Do not mention things that are working correctly.\n\n"
        "For each distinct error pattern: identify the root cause, tag with its "
        "log4j level, and provide specific actionable remediation steps with "
        "links to doc.dataiku.com or KB articles when available. Group related "
        "errors sharing a root cause. Highlight data loss, security, or outage "
        "indicators.\n\n"
        "Format: markdown with a short Executive Summary, then a heading per "
        "issue (include the log4j level in the heading) and bullet points for "
        "remediation."
    )

    def generate():
        if not llm_id:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": "llmId is required"})
            return
        if not user_message:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": "userMessage is required"})
            return

        effective_prompt = system_prompt or _DEFAULT_SYSTEM_PROMPT
        log_chars = len(user_message)

        try:
            yield "event: phase\ndata: %s\n\n" % json.dumps({"phase": "Sending to LLM"})

            client = dataiku.api_client()
            project = client.get_project(dataiku.default_project_key())

            completion = project.get_llm(llm_id).new_completion()
            completion.settings['maxOutputTokens'] = 4096
            completion.with_message(message=effective_prompt, role='system')
            completion.with_message(message=user_message, role='user')

            streamed = False
            yield "event: phase\ndata: %s\n\n" % json.dumps({"phase": "Generating analysis"})
            try:
                for chunk in completion.execute_streamed():
                    text = getattr(chunk, 'text', None)
                    if text:
                        streamed = True
                        yield "event: chunk\ndata: %s\n\n" % json.dumps({"text": str(text)})
            except (AttributeError, TypeError):
                resp = completion.execute()
                yield "event: chunk\ndata: %s\n\n" % json.dumps({"text": str(resp.text)})

            yield "event: done\ndata: %s\n\n" % json.dumps({
                "llmId": llm_id,
                "logCharsAnalyzed": log_chars,
                "streamed": streamed,
            })
        except Exception as e:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": str(e)})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route('/api/report/generate', methods=['POST'])
def api_report_generate():
    """Generate a quarterly health check report via LLM Mesh. SSE with phase-only events."""
    body = request.get_json(force=True)
    llm_id = (body.get('llmId') or '').strip()
    diagnostic_data = body.get('diagnosticData') or {}

    _REPORT_SYSTEM_PROMPT = (
        "You are a senior Dataiku Technical Account Manager (TAM) creating a quarterly health check "
        "presentation for a customer's technical leadership. This will be rendered as an 18-slide "
        "HTML slideshow that the TAM presents live to the customer.\n\n"
        "Think deeply about the diagnostic data before writing. Analyze cross-cutting patterns, "
        "correlate issues across sections, and identify root causes. Take your time.\n\n"
        "=== VOICE & TONE ===\n"
        "- You are a trusted advisor, not a monitoring tool.\n"
        "- Use first-person plural: 'we recommend', 'our analysis shows', 'we observed'.\n"
        "- Lead with POSITIVES before concerns. Always acknowledge what's working well.\n"
        "- Frame findings in BUSINESS IMPACT: 'training pipeline reliability' not 'OutOfMemoryError'.\n"
        "- Cite exact numbers, project names, config values. Never be vague.\n"
        "- Reference doc.dataiku.com links where relevant.\n\n"
        "=== SLIDE LAYOUT DETAILS ===\n"
        "Your output populates 18 slides. Here is exactly how each slide renders:\n\n"
        "SLIDE 1 (Title): Static - company name, date, DSS version. You don't write this.\n\n"
        "SLIDE 2 (Executive Summary): LEFT COLUMN shows a large health score number (computed separately). "
        "RIGHT COLUMN shows your 'overall_status' text in a callout box. BELOW both columns, "
        "your 3 'findings' display as numbered cards in a row. Each finding should be ONE bullet point "
        "(1-2 sentences max) that a VP can read in 5 seconds.\n\n"
        "SLIDES 3-13 (Data Slides): Each has this layout:\n"
        "  LEFT COLUMN: 4 large metric cards showing numbers from the actual data (you don't write these).\n"
        "  RIGHT COLUMN: Your 'narrative' text in a callout box. This is the ONLY text you control on these slides.\n"
        "  BELOW the callout: optional extras (highlights, risks, warnings, upgrade_paths) shown as badges or bullet items.\n\n"
        "  CRITICAL: The narrative is displayed in a tall callout box with large font (1.25rem). "
        "Use BULLET POINTS (with bullet char), NOT paragraphs. 3-5 bullets per slide. "
        "Each bullet: one clear observation with a specific number or finding.\n"
        "  Format example:\n"
        "    '\\u2022 42 projects with healthy adoption across the organization\\n"
        "\\u2022 ML Pipeline (PROJ1) leads with 156 versions, indicating critical production use\\n"
        "\\u2022 Consider version retention policy for projects exceeding 100 versions'\n\n"
        "  The slides are:\n"
        "    Slide 3: Instance Overview - DSS version, OS, CPU, Python\n"
        "    Slide 4: Projects Overview - project count, health score\n"
        "    Slide 5: Project Footprint - storage analysis, top projects by size\n"
        "    Slide 6: Code Environments - env count, Python/R version distribution\n"
        "    Slide 7: Code Env Health - health score, unused envs, upgrade paths\n"
        "    Slide 8: Filesystem Health - mount point usage percentages\n"
        "    Slide 9: Memory & JVM - heap settings, system RAM\n"
        "    Slide 10: Connections - connection types, counts\n"
        "    Slide 11: Issues & Risks - disabled features, plugins, risk level\n"
        "    Slide 12: Users & Activity - user counts by role\n"
        "    Slide 13: Log Analysis - error counts, patterns\n\n"
        "  For 'highlights', 'risks', 'warnings', 'upgrade_paths' arrays: "
        "these render as small badge pills. Keep each item UNDER 10 words.\n"
        "  For 'patterns' array: renders in monospace. Keep each under 80 chars.\n\n"
        "SLIDES 14-16 (Recommendations): Each slide shows a 2-column grid of cards.\n"
        "  Each card has: a numbered indicator, a bold TITLE (Spectral serif, ~5 words), "
        "a DESCRIPTION paragraph (Roboto, 1-2 sentences with specific action), "
        "and an IMPACT badge (green pill, ~5-8 words on business value).\n"
        "  Slide 14: Critical (2-3 items) - production stability / data loss risks\n"
        "  Slide 15: Important (3-5 items) - address this quarter to prevent escalation\n"
        "  Slide 16: Nice-to-Have (2-3 items) - efficiency and governance optimizations\n\n"
        "SLIDE 17 (Action Plan): Vertical timeline with numbered steps.\n"
        "  Each step: action text (what to do), timeline (when), effort badge (low/medium/high).\n"
        "  Include 5-7 items ordered by priority. Use concrete timelines: "
        "'next maintenance window', 'within 30 days', 'Q2 2025', NOT 'soon' or 'when possible'.\n\n"
        "SLIDE 18 (Closing): Static - 'Next Steps' with TAM contact prompt. You don't write this.\n\n"
        "=== OUTPUT FORMAT ===\n"
        "Return ONLY valid JSON (no markdown fences, no commentary outside the JSON).\n"
        '{\n'
        '  "slides": {\n'
        '    "executive_summary": {\n'
        '      "findings": [\n'
        '        "One-sentence finding for card 1 (most impactful)",\n'
        '        "One-sentence finding for card 2",\n'
        '        "One-sentence finding for card 3"\n'
        '      ],\n'
        '      "overall_status": "STATUS_LABEL - one sentence summary"\n'
        '    },\n'
        '    "instance_overview": { "narrative": "bullet point text with newlines" },\n'
        '    "projects": { "narrative": "...", "highlights": ["short badge text", "..."] },\n'
        '    "project_footprint": { "narrative": "...", "risks": ["short risk badge", "..."] },\n'
        '    "code_envs": { "narrative": "..." },\n'
        '    "code_env_health": { "narrative": "...", "upgrade_paths": ["short path", "..."] },\n'
        '    "filesystem": { "narrative": "...", "warnings": ["short warning", "..."] },\n'
        '    "memory": { "narrative": "...", "tuning_recs": ["short rec", "..."] },\n'
        '    "connections": { "narrative": "..." },\n'
        '    "issues": { "narrative": "...", "risk_level": "low|medium|high|critical" },\n'
        '    "users": { "narrative": "..." },\n'
        '    "logs": { "narrative": "...", "patterns": ["error pattern < 80 chars", "..."] },\n'
        '    "rec_critical": { "items": [{\n'
        '      "title": "Short Title (3-5 words)",\n'
        '      "description": "Specific action: what to change, where, and why. 1-2 sentences.",\n'
        '      "impact": "Business impact in 5-8 words"\n'
        '    }] },\n'
        '    "rec_important": { "items": [{ "title": "...", "description": "...", "impact": "..." }] },\n'
        '    "rec_nice_to_have": { "items": [{ "title": "...", "description": "...", "impact": "..." }] },\n'
        '    "action_plan": { "priorities": [{\n'
        '      "action": "Specific task an admin can execute",\n'
        '      "timeline": "Concrete timeframe",\n'
        '      "effort": "low|medium|high"\n'
        '    }] }\n'
        '  }\n'
        '}\n\n'
        "STATUS_LABEL must be one of: HEALTHY, GOOD WITH CAVEATS, MODERATE RISK, or NEEDS ATTENTION.\n\n"
        "Remember: ALL narrative fields must use bullet points (\\u2022), not paragraphs. "
        "3-5 bullets per narrative. Each bullet starts with \\u2022 and contains ONE observation with a number."
    )

    def generate():
        if not llm_id:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": "llmId is required"})
            return
        if not diagnostic_data:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": "No diagnostic data provided. Please wait for all data to load."})
            return

        try:
            yield "event: phase\ndata: %s\n\n" % json.dumps({"phase": "Preparing data"})

            client = dataiku.api_client()
            project_key = dataiku.default_project_key()
            project = client.get_project(project_key)

            user_message = "Analyze this DSS instance diagnostic data:\n\n" + json.dumps(diagnostic_data, indent=None, default=str)

            yield "event: phase\ndata: %s\n\n" % json.dumps({"phase": "Analyzing diagnostics"})

            completion = project.get_llm(llm_id).new_completion()
            completion.settings['maxOutputTokens'] = 32768
            # Allow extended thinking for deeper analysis
            try:
                completion.settings['budgetTokens'] = 100000
            except Exception:
                pass  # Not all LLM backends support budgetTokens
            completion.with_message(message=_REPORT_SYSTEM_PROMPT, role='system')
            completion.with_message(message=user_message, role='user')

            # Streamed call — avoids LLM Mesh gateway timeout (~263s)
            report_parts = []
            char_count = 0
            for chunk in completion.execute_streamed():
                if chunk.type == "footer":
                    break
                if chunk.type == "content" and chunk.text:
                    report_parts.append(chunk.text)
                    char_count += len(chunk.text)
                    yield "event: chunk\ndata: %s\n\n" % json.dumps({
                        "text": chunk.text,
                        "totalChars": char_count,
                    })
                elif chunk.type == "event":
                    yield "event: phase\ndata: %s\n\n" % json.dumps({
                        "phase": "Thinking: %s" % (chunk.event_kind or "reasoning"),
                    })

            report_text = ''.join(report_parts)

            # Strip markdown fences if present
            report_text = re.sub(r'^```(?:json)?\s*\n?', '', report_text)
            report_text = re.sub(r'\n?```\s*$', '', report_text).strip()

            yield "event: done\ndata: %s\n\n" % json.dumps({
                "report": report_text,
                "llmId": llm_id,
            })
        except Exception as e:
            yield "event: error\ndata: %s\n\n" % json.dumps({"error": str(e)})

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
