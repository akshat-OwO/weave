---
"@weave/cli": patch
---

Add opt-in directory mounts to `create` and `start`, with read-only access by default, an optional `:w` suffix for writable mounts, and no host mounts when the flag is omitted.
