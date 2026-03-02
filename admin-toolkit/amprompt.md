# Claude Code Prompt for Implementing `am.md` with Multi-Cycle Verification

Use the following prompt in Claude Code (Opus 4.6) to implement the plan in `am.md` while forcing repeated coding/verification iterations.

```text
You are implementing the plan in `am.md` in this repo. Treat `am.md` as the source of truth.

Your job is to code AND verify repeatedly, not just write code once.

Mandatory behavior:
1. Implement in small slices.
2. After every slice, run verification, inspect results, patch, and re-verify.
3. Complete at least 5 verification cycles total before finalizing (even if early tests pass).
4. Do not claim success without listing exact commands run and outcomes.
5. If a command cannot run (missing deps/tests/permissions), report the exact blocker and run the best alternative checks.
6. Prefer root-cause fixes over superficial patches.
7. Keep changes scoped to the plan in `am.md`.

Plan-specific requirements from `am.md` (must be implemented and verified):
- Coverage-gated auto-resolution using `run_sections` and campaign dependency mapping.
- Scenario issue identity at scenario granularity (`entity_type='scenario'`, `entity_key='project_key:scenario_id'`).
- Exact email-to-issue linkage using preview-provided `linkedIssueIds` (no fuzzy recipient+campaign lookup at send time).

Execution workflow (mandatory):
Cycle N:
- Pick the smallest next slice from `am.md`
- Implement code changes
- Run targeted verification for that slice
- Inspect failures/warnings
- Patch code/tests/docs as needed
- Re-run verification
- Log results

Minimum cycle structure:
- Cycle 1: schema/storage changes + migration/DDL wiring
- Cycle 2: run ingestion + `run_sections` persistence + `coverage_status`
- Cycle 3: coverage-gated auto-resolution logic
- Cycle 4: scenario identity changes in finding/issue keys + regression checks
- Cycle 5: preview/send exact linkage (`linkedIssueIds`) + regression checks
- Final cycle: broader regression (tests + lint/typecheck/build as applicable)

Verification rules (each cycle):
- Run targeted tests for changed modules if they exist.
- Run at least one broader regression check after targeted tests pass.
- If there are no tests for a changed behavior, add targeted tests first, then run them.
- If integration tests are hard, create a minimal reproducible script/test case for the behavior.

Specific verification cases you must cover before finalizing:
1. Partial/failed section run does NOT auto-resolve affected campaign issues.
2. Complete coverage run DOES auto-resolve missing issues and sets resolution reason.
3. Scenario campaigns create distinct issues for `P1:S1` and `P1:S2`.
4. Email preview returns `linkedIssueIds` per item.
5. Email send persists exact links from `linkedIssueIds` and does not do fuzzy open-issue lookup.
6. Existing non-scenario campaigns still ingest and resolve correctly.

Important constraints:
- Do not stop after the first green test.
- After the first green result, intentionally broaden verification scope.
- If you discover plan ambiguity, choose the safer behavior (avoid false “resolved”) and note it.

Output format (final response):
1. What changed (files + behavior)
2. Coverage of `am.md` sections implemented
3. Iteration log (Cycle 1..N)
4. Verification evidence (commands + pass/fail summary)
5. Remaining risks / follow-ups

Start now by reading `am.md`, mapping plan sections to code files, then begin Cycle 1.
```

Optional stricter add-on (append to the prompt):

```text
Be strict about verification. I want multiple code/verify/patch loops, not one-shot coding. If a cycle passes immediately, still run an additional verification pass with broader scope before moving on.
```
