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
- **Extend the documentation guard when you add a checkable doc claim.** `test/readme.test.js` and `test/agent-instructions.test.js` fail on line-number anchors, unresolvable paths and renamed heading fragments.

### Architecture and domain discipline

- **Use the [glossary](GLOSSARY.md) words and no synonyms** — in identifiers, test names, commit messages and issues.
- **Preserve each single owner.** One module owns the value; callers read it rather than recomputing or respelling it:
  - **Page geometry** — `pageGeometry()` in `src/core/page-geometry.js` owns the `@page` rule and `PAGE_GEOMETRY_VARIABLES`. A theme supplies variables and never declares `@page`.
  - **Readiness protocol** — `READINESS_FLAGS` in `src/core/readiness-protocol.js` owns every flag name. Never write a flag as a bare string literal in a bootstrap or the renderer.
  - **Document options** — `createDocumentOptions()` in `src/core/document-options.js` owns the option set, its defaults, and the accepted and rejected flag tables. A new flag is declared there before it is wired anywhere.
  - **Print stylesheets** — `stylesheetPayload()` in `src/core/print-styles/print-styles.js` owns the layer list and its order. A theme is not a print stylesheet: it is injected last, above them.
  - **Mermaid styling** — `MERMAID_VARIABLES` in `src/core/mermaid-styles/mermaid-styles.js` owns the theme variable contract and the shared selector block. A theme supplies variables, not selectors.
- **Add depth behind the existing seam.** When two modules need the same fact, one of them owns it; do not thread a parameter through the pipeline to avoid deciding which.
- **The module map is the README's** — [File Overview](README.md#file-overview). Do not grow a second copy in this file.

### Visual verification (mandatory)

**Any change that can affect rendered output requires a real rendered PDF to be opened and looked at.** A green suite proves the Markdown became HTML; it proves nothing about what Chromium painted. This covers `src/core/build-html.js`, both bootstraps, every print stylesheet, every theme, and any change to `pageGeometry()`.

Render a fixture — `*.pdf` is gitignored, so the output never lands in a commit:

```bash
node convert.js documents/test-math.md test-math.pdf --style ./styles/style.css
node convert.js documents/test-math.md test-math-oled.pdf --style ./styles/oled-style.css
node convert.js documents/test-fixtures.md test-fixtures.pdf --style ./styles/style.css
```

Exit 0 and roughly 80–100 KB per fixture is the healthy baseline; see [Manual render check](README.md#manual-render-check). Then look at the output.

**GUI desktop**

- Open the PDF in a viewer and read every page. Check that math typesets, diagram labels are legible and unclipped, no raw LaTeX or Mermaid source appears as visible text, and the footer reads `Page 1`, `Page 2`, … A light theme alone is not enough: render one dark theme, since a tinted sheet is where unreadable footer ink hides.

**CLI / headless**

1. **Confirm the browser launches before blaming the document.** The renderer already passes `--no-sandbox`. If the CLI exits non-zero with `Failed to launch the browser process`, the environment is at fault, not the Markdown — read the `stderr` block it prints.
2. **Point Puppeteer at a browser you already have** with `PUPPETEER_EXECUTABLE_PATH=<path to chrome>`, rather than installing another. A distro Chrome or Chromium, or a previous Puppeteer download, works.
3. **Missing OS shared libraries** — `error while loading shared libraries: libatk-1.0.so.0` and siblings — mean the host lacks Chromium's runtime dependency set. Install the distro packages for that set (Puppeteer's troubleshooting page lists it per distro), or, when the `.so` files already exist somewhere on the host, put that directory on `LD_LIBRARY_PATH` for the render command only. Never commit one machine's library directory or a scratch extraction step.
4. **Rasterise and inspect.** Render the fixtures as above, then turn pages into images and look at them: `pdftoppm -r 110 -png test-math.pdf page` (poppler-utils), `mutool draw -o page-%d.png -r 110 test-math.pdf`, or a Python binding such as PyMuPDF. Inspect the page images with whatever vision tool the environment provides.
5. **If no viewer and no image inspection is available, stop and escalate.** Name the fixture and the pages a human must look at, and do not report a rendering change as verified.
