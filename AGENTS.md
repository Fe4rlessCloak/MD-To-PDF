## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `Fe4rlessCloak/MD-To-PDF` via the `gh` CLI. See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Uses the five default triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See [docs/agents/triage-labels.md](docs/agents/triage-labels.md).

### Domain docs

Single-context layout (`GLOSSARY.md` and `docs/adr/` at the repo root). See [docs/agents/domain.md](docs/agents/domain.md).

## Development & verification workflow

Module inventory, usage and the theme table live in the [README](README.md); vocabulary lives in the [glossary](GLOSSARY.md). Link to them, do not restate them here.

### Automated checks

- **Run `npm test` before every commit.** It is browser-free and takes seconds, so a red suite is never a scheduling problem.
- **Write the test with the change, at the seam the change lives behind.** Assert observable behaviour — a rendered structure, a resolved value, a raised error — not internal calls. A test that has to change during a refactor of unchanged behaviour is testing the wrong thing.
- **Keep fixture documents aligned with the rendering edge cases you touch.** [`documents/test-fixtures.md`](documents/test-fixtures.md) pins Mermaid wide, tall, small and long-label cases; [`documents/test-math.md`](documents/test-math.md) pins mixed math and diagrams, the combination that historically broke. A new edge case gets a line in a fixture and an assertion, not a code comment.
- **Extend the documentation guard when you add a checkable doc claim.** `test/readme.test.js` guards the README and `test/agent-instructions.test.js` guards this file and [docs/agents/visual-verification.md](docs/agents/visual-verification.md): both fail on line-number anchors, unresolvable paths, and heading fragments that name no real heading, and the agent-instructions guard also fails on host-specific absolute paths.

### Architecture and domain discipline

- **Use the [glossary](GLOSSARY.md) words and no synonyms** — in identifiers, test names, commit messages and issues.
- **Preserve each single owner.** One module owns the value; callers read it rather than recomputing or respelling it:
  - **Page geometry** — `src/core/page-geometry.js` owns the `@page` rule and the theme geometry variables it names. A theme supplies variables and never declares `@page`.
  - **Readiness protocol** — `READINESS_FLAGS` in `src/core/readiness-protocol.js` owns every flag name. Never write a flag as a bare string literal in a bootstrap or the renderer.
  - **Document options** — `createDocumentOptions()` in `src/core/document-options.js` owns the option set, its defaults, and the accepted and rejected flag tables. A new flag is declared there before it is wired anywhere.
  - **Print stylesheets** — `stylesheetPayload()` in `src/core/print-styles/print-styles.js` owns the print layers and their relative order. Assembly splices the Mermaid block in after the base defaults and appends page geometry last; that emission order lives in `build-html.js`, and this module guarantees only the order within what it returns.
  - **Mermaid styling** — `src/core/mermaid-styles/` owns the shared selector block in `mermaid.css` and the `MERMAID_VARIABLES` contract that parameterises it. A theme supplies variables, not selectors.
- **Add depth behind the existing seam.** When two modules need the same fact, one of them owns it; do not thread a parameter through the pipeline to avoid deciding which.
- **The module map is the README's** — [File Overview](README.md#file-overview). Do not grow a second copy in this file.

### Visual verification (mandatory)

**Any change that can affect rendered output needs a real rendered PDF opened and looked at.** A green suite proves the Markdown became HTML; it proves nothing about what Chromium painted. This covers `src/core/build-html.js`, both bootstraps, every print stylesheet, every theme, and any change to `pageGeometry()`.

Render a fixture and inspect the output — commands, the healthy baseline and the procedure for both GUI and headless setups are in [Visual verification](docs/agents/visual-verification.md) and the [Manual render check](README.md#manual-render-check), so they are written once. Headless setups get the same standard, not a lower one: if you cannot look at the output, say so and escalate rather than reporting the change verified.
