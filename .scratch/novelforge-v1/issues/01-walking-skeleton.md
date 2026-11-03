# 01: Walking skeleton

**What to build:** One Bun-compiled executable serves the REST API. A client can create a Save with a minimal World Brief and PC, play one Turn through a scripted Text Provider, and read that Turn back after restarting the server. This also establishes the test harness that all later tickets use. No UI.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A `.gitattributes` keeps line endings consistent
- [ ] The app compiles to a single executable that starts the server on localhost only
- [ ] A Save can be created through the REST API and exists as one SQLite file in the Saves folder next to the app
- [ ] A Turn played through the REST API stores the player and Narrator Messages
- [ ] Messages survive a server restart
- [ ] The SQLite file uses a rollback journal with full sync, and a Turn is one transaction
- [ ] Tests start the real server and use real Saves in a temp folder, with a scripted, recording Text Provider
