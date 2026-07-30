# Weave isolation and host data

Weave gives each VM its own virtual disk and disables host-directory mounts by default. Guests retain outbound network access, while parent-to-guest application access requires an explicit port mapping. See `weave skills get network`.

## Choose how the guest sees data

- Prefer `weave cp` for individual inputs that should become independent guest copies.
- Use `--mount <directory>` only when the guest needs a host directory. It is read-only by default.
- Add `:w` only to the smallest directory that must receive guest changes, for example `--mount ./artifacts:w`.
- `create` and `start` replace the VM's complete mount set. Stop a running VM before changing mounts.

## Retrieve output

`weave cp` does not copy guest files back to the host. Plan output retrieval before starting:

```sh
mkdir -p ./artifacts
weave create agent-task --mount ./artifacts:w
weave shell agent-task "write-output-to-the-mounted-artifacts-path"
```

Do not expose a repository or credential directory as writable unless the task explicitly requires it. Use `weave kill <name>` to delete the guest disk after extracting required results.
