/**
 * @file Read custom-property declarations out of CSS text.
 *
 * Two separate modules need the same three questions answered about a theme's
 * CSS: which custom properties does it declare, which does it declare with no
 * value, and what does it declare once comments are removed. The Mermaid
 * styling module asked them first, for `--mermaid-*`; page geometry then asked
 * them again for `--page-*`, and importing the answer from the Mermaid module
 * would have made page layout depend on diagram styling for a string utility.
 * So the questions live here, parameterised by prefix, and both modules read
 * their own answers without knowing about each other.
 *
 * **An empty declaration is a missing one.** `--x: ;` resolves to the empty
 * string in `var()`, so the declaration is dropped and the reader falls back.
 * A theme that looks like it says something says nothing, which is why a
 * hollow property counts as absent everywhere below.
 *
 * **Comments are not declarations.** Both modules' stylesheets mention their
 * variables in prose to explain what they own, so every read here strips
 * comments first. A check that could not tell a comment from a declaration
 * would forbid the explanation.
 */

/**
 * Remove CSS comments.
 *
 * @param {string} css
 * @returns {string}
 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Every custom property declared in comment-stripped CSS, and their values.
 *
 * The value is everything up to the next `;`, `{` or `}`, so a value wrapped
 * across lines is read as one value rather than mistaken for an empty
 * declaration followed by stray text. A declaration whose value is only
 * whitespace maps to the empty string.
 *
 * @param {string} withoutComments  CSS text with comments already removed.
 * @param {string} [prefix]  Restrict to properties starting with this, e.g. `--page-`.
 * @returns {Map<string, string>} Property name to trimmed value, in source order.
 */
function declaredProperties(withoutComments, prefix) {
  const declarations = new Map();

  for (const match of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*)/g)) {
    const [, name, rawValue] = match;
    if (prefix && !name.startsWith(prefix)) continue;

    // Last declaration wins, as it does in the cascade.
    declarations.set(name, rawValue.trim());
  }

  return declarations;
}

/**
 * Custom properties a stylesheet declares, and the subset left without a value.
 *
 * Returned as sets rather than booleans so a caller can test membership in the
 * order it prefers and report every offending name at once.
 *
 * @param {string} css  A stylesheet's CSS text; comments may be present.
 * @param {string} [prefix]  Restrict to properties starting with this.
 * @returns {{declared: Set<string>, empty: Set<string>}}
 */
export function declarations(css, prefix) {
  const properties = declaredProperties(stripComments(css), prefix);
  const empty = new Set();

  for (const [name, value] of properties) {
    if (value === '') empty.add(name);
  }

  return { declared: new Set(properties.keys()), empty };
}
