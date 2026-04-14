# LLM Model Audit User Megaprompt

Build an easy new feature for the admin toolkit webapp that audits LLM model usage across all projects in a Dataiku instance.

Use the existing Python script `in-progress/litellm_model_upgrade_audit.py` as a source of useful logic, but do not assume all of that script must be reused. Pull in only the parts needed for the webapp feature.

The feature should scan all projects in the Dataiku instance and identify LLM models that are:

- obsolete
- overpriced
- ripoffs compared with newer or better-priced replacement models

The report should look good and feel native to the existing webapp. Reuse existing assets, UI conventions, and table patterns already present in the app. The preferred visual references are the Code Env Insights and Project Insights tables.

The default audit should run before the Projects page is opened. It should start during the normal live diagnostics loading flow, not wait until the Projects page mounts or until the user clicks into the page.

The default audit should be lightweight enough to run automatically. It can use cached project lists and any already-discovered model references where available.

Add additional user-triggered scan modes for broader coverage:

- `Aggressive Metadata Scan`
- `Deep File Scan`

Clarification about caching and scan depth:

- The aggressive scan should be able to reuse cached project lists.
- It should be able to reuse any already-found model references.
- If the goal is to find model strings that are not exposed through normal metadata or already-known model fields, then yes, the system would need to scan a bunch of project files to find model-looking strings.
- File scanning should be treated as deeper, slower, and noisier than the default audit.

The report should make it clear which findings came from actual/known usage versus available models, metadata, or file-string matches.

The report should expose enough detail for a user to understand:

- which model was found
- whether it is current, obsolete, overpriced/ripoff, or unknown
- what the recommended/current model is when known
- which project references the model
- where the reference came from
- whether a match is high-confidence or lower-confidence

The UI should include controls for:

- refreshing the default audit
- running the aggressive metadata scan
- running the deep file scan
- filtering by status
- searching models and project references
- expanding rows to see project/source/context details

The feature should be debuggable from the existing debug panel. Add a lot of debug visibility around this feature before deploying another version. The debug panel should make it clear when the audit:

- starts
- loads or reuses project/catalog data
- starts scanning
- reaches progress milestones
- reaches 100% scan progress
- starts building/finalizing the report
- sends or receives the final report
- fails
- gets stuck waiting after scan progress reaches 100%

If the scan says 100%, the report should not stay blank and the buttons should not remain unavailable. If the backend or stream fails after 100%, the UI should surface that in the debug panel and recover the controls.

Deploy completed versions using the Makefile to both:

- `akaos`
- `tam-global`

Write down the implementation plan in a `codex-something.md` file.

Also write this user-request megaprompt as a separate file, containing the user's requests and clarifications only, without implementation architecture.
