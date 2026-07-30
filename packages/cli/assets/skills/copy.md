# Copy host files into a Weave VM

```sh
weave cp <name> <file>... [--o <guest-directory>]
```

Examples:

```sh
weave cp agent-task ./package.json ./bun.lock
weave cp agent-task ./package.json ./src/index.ts --o /workspace
```

- Sources must be existing host files or symbolic links. Directories are rejected.
- The destination defaults to the guest user's home directory.
- Missing guest destinations are created. Weave stages files when elevated guest permissions are needed.
- Copying creates independent guest files; later guest edits do not change the host originals.
- `weave cp` copies host-to-guest only. To return artifacts to the host, create or restart the VM with a narrowly scoped writable mount; see `weave skills get isolation`.
