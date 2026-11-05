# One SQLite file per Save

Each Save is a single SQLite file holding its Messages, Snapshots and images, because a Turn or Revert must apply atomically and a Save must be easy to duplicate and share. It uses a rollback journal with full sync instead of WAL, which can leave sidecar files beside the Save, and Turns take seconds so the sync cost does not matter. Snapshots stay logically complete and immutable, but their sections are stored only when changed and shared between Messages, which reduced Snapshot data about tenfold in a simulated 1,000-Turn story.

## Considered Options

JSON files matched SQLite on speed in that simulation, but needed thousands of files per Save and custom crash recovery.
