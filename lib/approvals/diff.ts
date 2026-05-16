/**
 * Stable JSON serialization + line-by-line diff for the approval
 * detail view. Deliberately minimal — no `jsdiff`, no LCS / Myers
 * algorithm yet. The audit moderator needs to see "this changed",
 * not a literary edit history.
 *
 * Algorithm:
 *
 *   1. Serialize each payload with sorted keys + 2-space indent so
 *      the comparison is canonical (same data → same string).
 *   2. Split each string by `\n`.
 *   3. Walk the two arrays by index. A position is "different" iff
 *      the strings at that index don't match exactly.
 *
 * This is a structural shortcut: insertions / deletions cascade as
 * diffs from that point onward. That's actually the right behavior
 * for an approval audit — if a JSON key moved, every subsequent line
 * "differs" and the reviewer sees the structural change clearly.
 */

export interface DiffLine {
  readonly text: string;
  readonly diff: boolean;
}

export interface PayloadDiff {
  readonly left: ReadonlyArray<DiffLine>;
  readonly right: ReadonlyArray<DiffLine>;
}

/**
 * `JSON.stringify` with deterministic key ordering. Numbers, strings,
 * booleans, null are output unchanged. Arrays preserve insertion
 * order. Objects sort keys alphabetically before serialising — so
 * `{ b: 1, a: 2 }` and `{ a: 2, b: 1 }` produce identical output.
 */
export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(value, sortKeysReplacer(), indent);
}

function sortKeysReplacer() {
  return function replacer(_key: string, val: unknown): unknown {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(obj).sort()) {
        sorted[k] = obj[k];
      }
      return sorted;
    }
    return val;
  };
}

/**
 * Build a side-by-side diff. `null` left payload renders as a single
 * "(no original — fresh request)" placeholder line which is NOT marked
 * as a diff (the placeholder is informational, not a change). Every
 * proposed line then renders as a change on the right because there's
 * nothing to compare against.
 */
export function buildPayloadDiff(
  original: unknown | null,
  proposed: unknown,
): PayloadDiff {
  const rightLines = stableStringify(proposed).split('\n');

  if (original === null || original === undefined) {
    return {
      left: [{ text: '(sin original — solicitud nueva)', diff: false }],
      right: rightLines.map((text) => ({ text, diff: true })),
    };
  }

  const leftLines = stableStringify(original).split('\n');
  const max = Math.max(leftLines.length, rightLines.length);
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  for (let i = 0; i < max; i++) {
    const l = leftLines[i];
    const r = rightLines[i];
    if (l !== undefined && r !== undefined) {
      const diff = l !== r;
      left.push({ text: l, diff });
      right.push({ text: r, diff });
    } else if (l !== undefined) {
      // Right side exhausted — left content has no counterpart.
      left.push({ text: l, diff: true });
    } else if (r !== undefined) {
      // Left side exhausted — right content has no counterpart.
      right.push({ text: r, diff: true });
    }
  }
  return { left, right };
}
