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
