# 41: LAN access

**What to build:** The app can be opened from other devices on the same network.

**Status:** done

- [x] The app listens on the LAN as well as localhost by default
- [x] `HOST` overrides that, and test servers stay on loopback
- [x] Startup prints an address to use from other devices
- [x] Opened from another device

## Comments

- **User decision (2026-11-04):** the server should be reachable on the LAN. This reverses the spec's rule of binding to localhost.
- There are no accounts, so anyone on the network can play, delete Saves, change Settings and spend the saved keys, though the API never returns a key.
- A first-time Windows Firewall rule for Bun may be needed, which the user has to allow.
