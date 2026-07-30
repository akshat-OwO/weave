# Weave core workflow

Weave runs commands inside isolated Lima Linux VMs. Use a short, unique VM name for each task.

## Typical agent workflow

```sh
weave create agent-task --ttl 1h --template node
weave cp agent-task ./task.sh --o /workspace
weave shell agent-task "cd /workspace && chmod +x task.sh && ./task.sh"
weave kill agent-task
```

- Use `--template node` for Node.js through nvm, `--template python` for Python through uv, or omit it for the default environment.
- Use `weave shell <name> "<command>"` for non-interactive work and `weave ssh <name>` only when an interactive terminal is necessary.
- `shell` and `ssh` offer to start a stopped VM before continuing.
- Use `weave ls` to inspect VM status and remaining TTL.
- Use `weave <command> --help` for the exact options supported by the installed version.

Load the relevant detailed section before acting:

```sh
weave skills get create       # provisioning, templates, resources, and mounts
weave skills get copy         # moving host files into a guest
weave skills get lifecycle    # TTL, start, stop, kill, upgrade, and uninstall
weave skills get isolation    # host-mount safety and retrieving task output
weave skills get network      # outbound access and localhost port publishing
```
