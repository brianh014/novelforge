# 11: Inventory and status

**What to build:** A player can see what the PC is wearing and carrying, click an item to act with it, and read the PC's status in words.

**Blocked by:** 09

**Status:** ready-for-agent

- [x] Inventory is shown as two lists: wearing and carrying
- [x] Clicking an item opens an input asking what the PC does with it
- [x] That action appears in the chat as a normal Turn, and the world reacts
- [x] The Narrator is guided to keep inventory realistic for the world
- [x] Status shows health, injuries and conditions in words, with no numbers
- [x] Inventory and status match the Snapshot after every Turn and Revert

## Comments

- Status is Narrator free text. The server refuses numeric characters in `set_health` and `add_status`, but spelled-out numbers ("seventy percent") are stopped only by the prompt. A refusal retries and can then fail the Turn.
- Items are Narrator free text too, so as with the summary, only the prompt keeps secrets out of them. The marker test proves the routes, not the model.
- `remove_item` takes from carrying first, so with the same name in both lists it can remove the wrong one. That operation is unchanged here.
- An item's action reaches the chat as `item: text`, so the Narrator knows which item "it" means. The Turn path takes only text.
- Leaving a Turn cut short, then sending an item action that also fails, replaces the restored text in the box with the action.
