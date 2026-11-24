# Visual Verification

A green suite proves the Markdown became HTML. It proves nothing about what Chromium painted, so
any change that can affect rendered output needs a real PDF opened and looked at. `AGENTS.md`
states the rule; this file is the procedure.

Output is gitignored (`*.pdf`), and the README examples render to `/tmp` so generated files stay outside the working tree and never land in a commit. The fixture commands and the healthy baseline live in the README:
[Manual render check](../../README.md#manual-render-check).

## GUI desktop

Open the PDF in a viewer and read every page. Check that:

- math typesets, and no raw LaTeX or Mermaid source appears as visible text;
- diagram labels are legible and unclipped;
- the footer reads `Page 1`, `Page 2`, …

Render one dark theme as well as a light one. A tinted or black sheet is where unreadable footer
ink hides, and a light theme alone will not show it.

## CLI / headless

1. **Confirm the browser launches before blaming the document.** The renderer already passes
   `--no-sandbox`. If the CLI exits non-zero with `Failed to launch the browser process`, the
   environment is at fault, not the Markdown — read the `stderr` block it prints.

2. **Point Puppeteer at a browser you already have** with `PUPPETEER_EXECUTABLE_PATH`, rather than
   installing another. A distro Chrome or Chromium, or a previous Puppeteer download, works.

3. **Missing OS shared libraries** — `error while loading shared libraries: libatk-1.0.so.0` and
   its siblings — mean the host lacks Chromium's runtime dependency set. Install the distro
   packages for that set (Puppeteer's troubleshooting page lists it per distro) or, when the `.so`
   files already exist somewhere on the host, put that directory on `LD_LIBRARY_PATH` for the
   render command only. Never commit one machine's library directory or a scratch extraction step.

4. **Rasterise the pages and look at them.** No rasteriser is universally installed, so use the one
   the host has:

   | Tool | Command | Package |
   |---|---|---|
   | poppler | `pdftoppm -r 110 -png out.pdf page` | `poppler-utils` |
   | MuPDF | `mutool draw -o page-%d.png -r 110 out.pdf` | `mupdf-tools` |
   | PyMuPDF | see below | `pymupdf` |

   ```bash
   python3 -c 'import sys, pymupdf; [p.get_pixmap(dpi=110).save(f"page-{i+1}.png") for i, p in enumerate(pymupdf.open(sys.argv[1]))]' out.pdf
   ```

   Inspect the images with whatever vision capability the environment provides. Note that the
   `python3` first on `PATH` is not always the one with the binding installed.

5. **If no viewer and no image inspection are available, stop and escalate.** Name the fixture and
   the pages a human has to look at, and do not report a rendering change as verified.
