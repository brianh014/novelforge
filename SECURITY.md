# Security

## What NovelForge protects

NovelForge holds your text and image API keys and your stories. It is built to:

- Never send a key to the page, and never write one to a log.
- Refuse requests addressed to another site's name when it listens only on this computer, so a web page can't reach it by rebinding its domain to 127.0.0.1.
- Accept only JSON or a binary type no plain form can send, so other websites need a CORS preflight to post to it.
- Check every request body, and every imported Save, before using it.

## What it does not protect

A NovelForge server open to the network (the default for `bun start` and the Server downloads) has **no accounts**. Anyone who can reach it can read and change every story, change Settings, and spend the saved keys. Run it only on a network you trust, or bind it to this computer with `HOST=127.0.0.1`.

## Reporting a problem

Please report a vulnerability privately rather than in a public issue: use the host's private security advisory where it has one (as GitHub does), or else contact the maintainer through their profile on the repository's host. Include what you found, how to reproduce it, and what it lets an attacker do. You should hear back within two weeks.
