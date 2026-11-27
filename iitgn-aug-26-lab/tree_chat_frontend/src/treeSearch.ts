// Search in the tree view (T21). Pure, tested in tests/panel_logic.test.js.
//
//   - Looks in the question and the reply. Case and accents are ignored.
//   - Several words must ALL appear (in the question and reply together), in any order.
//   - Under MIN_QUERY characters nothing is searched (one letter would match the whole tree).
//   - Results: matches in the question first, then those found only in the reply; each group in
//     the tree's reading order (main branch first, oldest first).
import type { TreeNode } from "./types";

export const MIN_QUERY = 2;
export const LIST_MAX = 30; // results listed; past this the list asks for another word

export type SearchHit = {
  id: string;
  /** Where all the words were found: in the question, or only with the reply's help. */
  field: "question" | "reply";
  snippet: string;
};

/** Lower case, accents removed, spaces collapsed (same length rules for text and query). */
export function normalize(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function queryWords(query: string): string[] {
  const q = normalize(query);
  if (q.replace(/ /g, "").length < MIN_QUERY) return [];
  return [...new Set(q.split(" ").filter(Boolean))];
}

// A short piece of the text around the first word found (the whole text if it is short).
function snippetOf(text: string, words: string[], width = 90): string {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  const low = normalize(flat);
  let at = -1;
  for (const w of words) {
    const i = low.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return flat.slice(0, width - 1) + "…";
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}

/**
 * nodes: the tree's messages. order: their reading order (ids); messages not in it go last.
 * Returns every hit (the caller lists the first LIST_MAX).
 */
export function searchTree(nodes: TreeNode[], query: string, order: string[] = []): SearchHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const rank = new Map(order.map((id, i) => [id, i]));
  const pos = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const question: Array<[number, SearchHit]> = [];
  const reply: Array<[number, SearchHit]> = [];
  for (const n of nodes) {
    const q = normalize(n.prompt);
    const r = normalize(n.response);
    if (!words.every((w) => q.includes(w) || r.includes(w))) continue;
    if (words.every((w) => q.includes(w))) question.push([pos(n.id), { id: n.id, field: "question", snippet: snippetOf(n.prompt, words) }]);
    else reply.push([pos(n.id), { id: n.id, field: "reply", snippet: snippetOf(n.response, words) }]);
  }
  const sorted = (list: Array<[number, SearchHit]>) => list.sort((a, b) => a[0] - b[0]).map(([, h]) => h);
  return [...sorted(question), ...sorted(reply)];
}

/** Splits text into plain and matched pieces, for showing the query words in bold. */
export function highlightParts(text: string, words: string[]): Array<{ text: string; hit: boolean }> {
  if (!words.length || !text) return [{ text, hit: false }];
  // match on the text with accents removed, piece by piece (NFD keeps one char per base letter
  // for the Latin text this is used on; other scripts simply get no bold)
  const base = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (base.length !== text.length) return [{ text, hit: false }];
  const low = base.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) for (let k = i; k < i + w.length; k++) marks[k] = true;
  }
  const out: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else out.push({ text: text[i], hit: marks[i] });
  }
  return out;
}
