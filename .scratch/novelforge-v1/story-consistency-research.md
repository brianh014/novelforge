# Keeping a long story consistent

Research notes for the Narrator's memory, 2026-11-05. The question: how do we keep a long, player-driven story consistent, and should older Messages fade like human memory?

## Findings

| # | Finding | Source | What it means here |
|---|---|---|---|
| 1 | Consistent systems keep explicit, structured state. They don't rely on prose alone. SCORE tracks key item statuses. ConWriter keeps static requirements apart from evolving memory and state. | [SCORE](https://arxiv.org/abs/2503.23512), [ConWriter](https://arxiv.org/abs/2608.05169) | NovelForge already does this with State, Lore and known facts. Keep going that way. |
| 2 | Open developments are their own kind of memory, separate from world facts and character beliefs. | [NarraWorld](https://arxiv.org/abs/2609.32401) | We keep open questions inside the 500-word summary, where they get dropped. They should be a list. |
| 3 | Layered summaries work. RAPTOR builds a tree of recursive summaries. NarraWorld consolidates events into scenes, plotlines and plots, and keeps each higher level traceable to its source text. | [RAPTOR](https://arxiv.org/abs/2401.18059), [NarraWorld](https://arxiv.org/html/2609.32401v1) | This supports the fading memory idea. Each memory should record which Messages it came from. |
| 4 | Model-written summaries lose details and can invent them, so people should check and correct them. | [SillyTavern Summarize docs](https://docs.sillytavern.app/extensions/summarize/) | Show memories in the Journal and let the player edit them, as with the summary. Summarize as Messages start to leave the prompt, as the same docs advise. |
| 5 | Memory retrieval can score recency, importance and relevance, with all three weighted equally in the original work. Importance is rated by the model. Recency decays exponentially, and it resets when a memory is retrieved. | [Generative Agents](https://ar5iv.labs.arxiv.org/html/2304.03442) | This is the closest match to human memory: being reminded refreshes a memory. It's worth having only if memories stop fitting in the prompt. |
| 6 | Retrieval can mix keyword relevance and embeddings. | [SCORE v1](https://arxiv.org/html/2503.23512v1) | Lore uses keywords only. Rare words should count for more than common names, which needs no embeddings. |
| 7 | Checking new text against the story's state, then repairing it, catches errors before they spread. Re3 edits for factual consistency. ConWriter checks each scene's transitions and repairs locally. | [Re3](https://arxiv.org/abs/2210.06774), [ConWriter](https://arxiv.org/abs/2608.05169) | A check step could catch stale or contradicted details. It needs a second model call on each Turn, and it could also flatten surprises, so test it before trusting it. |
| 8 | Characters' beliefs are kept apart from world facts. | [NarraWorld](https://arxiv.org/abs/2609.32401) | We track what the PC knows, but not what each NPC knows. That matters for who could know a secret. |
| 9 | Detailed outlines improve coherence in fixed stories. | [DOC](https://arxiv.org/abs/2212.10077), [Dramatron](https://arxiv.org/abs/2209.14958) | A fixed outline doesn't suit player-driven play. Plot Threads are our nearest equivalent, and they need to stay editable. |

## Similar projects

NovelForge isn't new as a category. Each project below covers part of it, and these are the memory designs they describe themselves.

| Project | What it is | Memory design | Lesson for us |
|---|---|---|---|
| [Coderain](https://raw.githubusercontent.com/Zwimy/coderain/main/README.md) | Local, AI Dungeon-style story engine | Recent turns, then folded scenes, then a long arc with timeline and facts. Also threads, salience-ranked lorebook activation and optional vector recall, all rebuildable from Markdown | The closest match to our plan. Memory should be rebuildable from the source story |
| [Talemate](https://raw.githubusercontent.com/vegu-ai/talemate/main/README.md) | Multi-agent roleplay tool, [AGPL](https://github.com/vegu-ai/talemate) | Long-term memory, layered history summaries, passage of time, tracked states, and characters who know only the passages they were present for | Supports per-character knowledge. Its layered history page returned 404, so its mechanics are unread |
| [AI Dungeon](https://help.aidungeon.com/faq/the-memory-system) | Commercial story game | A compressed story summary plus a Memory Bank retrieved with embeddings, explained with the same human-memory comparison you made | Compressing a summary is its own risk, as edits don't regenerate it |
| [NovelAI](https://docs.novelai.net/en/text/lorebook) | Commercial writing tool | Key-activated, or always-on, Lorebook entries | Our Lore works the same way, so that part is proven |
| [Qvink MessageSummarize](https://raw.githubusercontent.com/qvink/SillyTavern-MessageSummarize/master/README.md) | SillyTavern extension | One summary per message, attached to that message, with no embeddings | Its case: summaries don't degrade when no model rewrites them, and editing a message affects only its own summary |
| [Summaryception](https://raw.githubusercontent.com/Lodactio/Extension-Summaryception/main/README.md) | SillyTavern extension, [AGPL per a third-party guide](https://www.roborhythms.com/sillytavern-memory/) | Recent turns in full, older ones in recursive summary layers | The clearest version of your idea. It argues that keeping many raw turns degrades attention, which is an unproven claim that challenges our 100-Message window |

## Limits of this research

- Most papers study stories generated in one go, not interactive play. NarraWorld reports a transfer to situated role-playing, but none tests a player-driven story like ours.
- Their results are self-reported on their own measures, so this note doesn't use their percentages.
- ConWriter and NarraWorld are 2026 preprints. I read their abstracts and short passages, not the whole papers.

## Recommended design

The model takes about 1,050,000 tokens, so NovelForge has no need to compress hard, and retrieval can wait.

1. **Open threads list.** Add open questions, promises and unresolved people as a state list. An item leaves only when play resolves it. This directly fixes losses like Renata's, and it follows the known-facts pattern.
2. **Scene memories.** Every 20 Messages, as they leave the 100-Message window, the Narrator writes about 100 words in that Turn, stored in the state with the Message range they came from. Send all of them every Turn. At 5,000 Messages that's about 245 memories, or 33,000 tokens by estimate, which fits comfortably.
3. **Fading.** Merge the oldest scene memories into chapter memories only if the story outgrows the budget, and keep the scene memories underneath so that a merge can be redone from them. Until then, the two levels are the gradient: full text, then scene memories, under the overall summary. No model should rewrite a scene memory, as Qvink's reasoning warns that repeated rewriting is where memories degrade.
4. **Backfill.** A one-off job can write scene memories for Messages already outside the window.
5. **Reminders.** Later, when a rare name returns, send the original Messages from that memory's range. This follows from traceability, and it brings back real detail.
6. **Check step, as an experiment.** Run it on a copy of a Save and compare results before it goes near play.

## Open questions

- Should the player see and edit scene memories in the Journal? Finding 4 says yes.
- Does a scene mean every 20 Messages, or a real change of place or time? Fixed counts are simplest. Scene breaks read better.
- Should the open threads list hold only what the PC knows? It should, as the player reads it and Plot Threads stay hidden.
