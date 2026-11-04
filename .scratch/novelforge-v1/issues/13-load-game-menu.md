# 13: Load Game menu

**What to build:** A player can manage their Saves from the Load Game menu: load, duplicate, delete, import and export. Old Saves keep working after updates.

**Blocked by:** 09

**Status:** ready-for-agent

- [x] The menu lists Saves and can load one
- [x] A player can duplicate a Save
- [x] Delete requires confirmation
- [x] A player can export a Save as one file
- [x] Import validates the file and rejects anything that isn't a valid Save without affecting existing Saves
- [x] Old Saves are migrated when opened, with a test covering an older format

## Comments

- **Schema version.** It lives in `PRAGMA user_version`. `MIGRATIONS[n]` takes a Save from version n to n + 1, inside one transaction with the version bump. A future column is one new step, and `SCHEMA` stays frozen at version 1. Version 0 means an empty file or any Save from before versions existed, so `toVersion1` checks for each change in turn. New Saves take the same steps from an empty file, so they can't drift from old ones.
- **Snapshots and migration.** `toVersion1` adds the sections a stored Snapshot lacks, at their opening values, because nothing could write to them yet. This is the one change ever made to a stored Snapshot.
- **Import.** The whole path runs in memory, so nothing reaches the Saves folder until the file is valid. The bytes open read-only to check the version, integrity and that the file holds only Save tables, as a trigger or view would otherwise act during migration. A writable in-memory copy migrates. A read-only copy of that result is then validated at the current version only, so old files need no rules of their own. Last, the rows are copied into a new Save built from the game's own schema, so the file's table definitions and id sequence stay behind: review showed a crafted `CHECK`, a missing primary key or an exhausted sequence could otherwise pass and fail every later Turn. Message ids restart from the highest kept id on import, which is safe as an imported Save has no Turn in flight.
- **Export.** `VACUUM INTO` writes one file with no deleted rows. A Save uses a rollback journal (ADR 0003), but `connect` also turns any WAL file back to that mode, so a WAL left by a crash is read in first. A test covers that. A file still flagged as WAL is refused on import, as SQLite can't open one in memory.
- The import size limit is 64 MiB, under Bun's 128 MiB body limit, which resets the connection on anything larger. A `shortcut:` comment records raising it for Scene Images in ticket 17.
- `POST /saves/import` requires `Content-Type: application/octet-stream`, which no form can send, so another website needs a CORS preflight to post there, like the JSON routes.
- Routes: `GET /saves`, `DELETE /saves/:id`, `GET /saves/:id/export` and `POST /saves/import`. Bad files answer 422. A Save id that isn't a uuid answers 404 before any path is built.
- The list opens every Save, so it migrates them. A file that can't be opened still appears as an unreadable Save with only Delete, so it isn't hidden and can be removed.
- The list says "Last changed", as it shows the file's modified time. Notes, Reverts, duplicates and migration all move it, so it isn't strictly the last play.
- A migration on a Save left in WAL mode switches its journal before the migration transaction. If that migration then failed, the data would be whole but the file's bytes would differ. The game never writes WAL, so this is left as it is.
- “Duplicate from here” is still only offered in the Revert confirmation, as ticket 09 noted. This ticket doesn't ask for more.
- Checked in headless Chrome against the compiled executable and a local fake OpenAI-compatible server, at 390 and 1280 wide in light and dark: list, load (including an old-format Save), duplicate and delete by keyboard, Escape keeping a Save, focus after delete, a real download for export, and import of that file and of junk. No horizontal scroll and no page exceptions.
