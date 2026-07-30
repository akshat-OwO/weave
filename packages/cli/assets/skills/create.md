# Create and configure Weave VMs

```sh
weave create <name> [--cpus <count>] [--memory <GiB>] [--ttl <duration>] [--template <name-or-path>] [--fresh] [--mount <directory>...]
```

Examples:

```sh
weave create agent-task
weave create agent-task --cpus 4 --memory 8 --ttl 1h
weave create node-task --template node
weave create py-task --template python
weave create custom-task --template ./custom.yaml --fresh
weave create repo-task --mount ./repo
weave create repo-task --mount ./repo:w
```

- New VMs default to 10% of host CPUs, 2 GiB of memory, and a 10-minute TTL.
- TTL values are positive integers followed by `s`, `m`, `h`, or `d`.
- Built-in templates are `node` and `python`; a custom Lima YAML path is also accepted.
- Weave caches compatible default, Node.js, and Python bases for faster later creates. `--fresh` bypasses that cache for one new VM.
- With no `--mount`, no host directories are exposed. A mount is read-only unless its path ends in `:w`.
- Calling `create` for an existing stopped VM restarts it and may update CPU, memory, TTL, and mounts. Templates and `--fresh` apply only to new VMs.
