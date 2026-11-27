"""Condense long branches so the model's input stays manageable.

When the context for a new message goes over ``SUMMARIZE_TOKENS`` we keep the
last ``KEEP_RECENT_TURNS`` turns verbatim and replace everything before them
with a summary. Summaries are cached on the node they end at
(``Node.context_summary``), so later messages on the same branch reuse them and
only summarize the turns added since.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from openai import OpenAI, OpenAIError

from tree_chat_backend.context import context_tokens, estimate_tokens


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


WARN_TOKENS = _env_int("CONTEXT_WARN_TOKENS", 6000)
SUMMARIZE_TOKENS = _env_int("CONTEXT_SUMMARIZE_TOKENS", 12000)
KEEP_RECENT_TURNS = _env_int("KEEP_RECENT_TURNS", 4)
MAX_TURN_CHARS = 6000  # per-side cap on what we feed the summarizer

SUMMARY_PROMPT = (
    "You condense conversations so they can be continued later. Write a concise "
    "summary (at most ~400 words) of the conversation below. Preserve the user's "
    "goals, key facts, decisions, constraints, names, numbers and any code or "
    "formulas that later turns may rely on. Use short bullet points. Do not add "
    "commentary or answer any question yourself."
)


@dataclass
class Compacted:
    summary: str | None
    recent: list
    summarized: bool
    trimmed: bool
    from_tokens: int
    to_tokens: int


def _clip(text: str) -> str:
    if len(text) <= MAX_TURN_CHARS:
        return text
    return text[:MAX_TURN_CHARS] + " …[truncated]"


def _summarize(
    client: OpenAI, model: str, previous: str | None, turns: Sequence
) -> str:
    parts: list[str] = []
    if previous:
        parts.append(f"Summary so far:\n{previous}\n")
    for i, n in enumerate(turns, 1):
        parts.append(f"--- Turn {i} ---\nUser: {_clip(n.prompt)}\nAssistant: {_clip(n.response)}")
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SUMMARY_PROMPT},
            {"role": "user", "content": "\n\n".join(parts)},
        ],
    )
    text = (completion.choices[0].message.content or "").strip()
    if not text:
        raise ValueError("Summarizer returned an empty response.")
    return text


def compact_context(
    nodes: Sequence,
    new_prompt: str,
    client: OpenAI,
    model: str,
    prefix_is_cacheable: Callable[[int], bool],
    save_summary: Callable[[object, str], None],
) -> Compacted:
    """Return the context to send, summarizing older turns if it is too long.

    ``prefix_is_cacheable(i)`` says whether ``nodes[: i + 1]`` is exactly what
    ``nodes[i]`` itself saw — only then is a summary cached on ``nodes[i]``
    valid for this chain. ``save_summary(node, text)`` persists a new summary.
    """
    nodes = list(nodes)
    total = context_tokens(nodes, new_prompt)
    if total <= SUMMARIZE_TOKENS or len(nodes) <= KEEP_RECENT_TURNS:
        return Compacted(None, nodes, False, False, total, total)

    older = nodes[:-KEEP_RECENT_TURNS]
    recent = nodes[-KEEP_RECENT_TURNS:]
    cut = len(older) - 1

    # Newest older node holding a summary that is valid for this chain.
    start = -1
    for i in range(cut, -1, -1):
        if getattr(older[i], "context_summary", None) and prefix_is_cacheable(i):
            start = i
            break

    summary: str | None
    trimmed = False
    if start == cut:
        summary = older[cut].context_summary
    else:
        previous = older[start].context_summary if start >= 0 else None
        try:
            summary = _summarize(client, model, previous, older[start + 1 :])
            if prefix_is_cacheable(cut):
                save_summary(older[cut], summary)
        except (OpenAIError, ValueError, IndexError, AttributeError):
            # Fall back to dropping the oldest turns until we fit.
            summary = None
            trimmed = True
            kept = list(nodes)
            while len(kept) > 1 and context_tokens(kept, new_prompt) > SUMMARIZE_TOKENS:
                kept.pop(0)
            recent = kept

    after = context_tokens(recent, new_prompt) + (estimate_tokens(summary) if summary else 0)
    return Compacted(summary, recent, summary is not None, trimmed, total, after)
