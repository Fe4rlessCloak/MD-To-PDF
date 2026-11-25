# Glossary

One line per term. Specs, reviews, commit messages and code identifiers use these
words and no synonyms.

## Architecture vocabulary

| Term | Meaning |
|---|---|
| **Module** | Anything with an interface and an implementation — deliberately scale-agnostic. Not "component", "service" or "unit". |
| **Interface** | Everything a caller must know to use a module correctly: signature, invariants, ordering constraints, error modes, configuration. Not just the type surface. |
| **Implementation** | The body of code behind an interface. Reach for "adapter" instead when the seam is the topic. |
| **Depth** | Behaviour available per unit of interface a caller must learn. |
| **Deep** | Large behaviour behind a small interface — the shape to aim for. |
| **Shallow** | An interface nearly as complex as its implementation — a pass-through. |
| **Seam** | A place where behaviour can be altered without editing there; where an interface lives. Not "boundary". |
| **Adapter** | A concrete thing that satisfies an interface at a seam; a role, not a substance. |
| **Leverage** | What callers get from depth: more capability per unit of interface learned. |
| **Locality** | What maintainers get from depth: change, bugs and verification concentrate in one place. |

## Domain vocabulary

| Term | Meaning |
|---|---|
| **Document** | One Markdown input rendered into one PDF. |
| **Document options** | The whole set of choices that shape a document — title, input, output, style — collected once and consumed by assembly. |
| **Page geometry** | Page margins, page rule and the browser's print preference: one owned value, not per-theme copies. |
| **Readiness protocol** | The contract by which the injected browser program publishes flags and the renderer polls them: flag names live in `src/core/readiness-protocol.js`. |
| **Readiness flag** | One named `window` property in that protocol, e.g. a render-done flag or an error-report array. |
| **Bootstrap** | The browser-side program injected into the document that loads a CDN runtime (Mermaid, KaTeX) and drives the DOM. |
| **Print stylesheet** | CSS written for paginated output rather than screen: base defaults, Mermaid containment, KaTeX integration. |
| **Theme** | A bundled stylesheet supplying palette and typography for a document. The five live in `styles/`. |
| **Fixture document** | A Markdown file under `documents/` that pins rendering behaviour for tests and manual render checks. |
| **Surface** | The composited colour actually painted behind a label's centre, in paint order, over the page canvas. What a label is legible *on*. |
| **Canvas** | The page surface a diagram sits on: the `@page` sheet colour composited with any element background, over paper. The surface when no painted geometry covers the point. |
| **Ink** | A label's painted text colour — SVG `fill`, or `color` inside a `foreignObject`. One of two candidates the contrast rule chooses between. |
| **Painted geometry** | An SVG primitive that fills area (`rect`, `path`, `polygon`, `circle`, `ellipse`) with a non-transparent fill and positive opacity. A `<g>` wrapper is not painted geometry. |
| **Normaliser** | The render-time pass that measures each label's surface and re-inks the label only where its existing ink fails WCAG AA; opted in per theme by `--mermaid-normalize`. |
