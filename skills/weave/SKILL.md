---
name: weave
description: Run commands and development tasks in isolated, disposable Linux virtual machines with the Weave CLI. Use when an agent should sandbox untrusted code, test software away from the host, create a temporary Node.js or Python environment, execute commands in a Lima VM, selectively mount host directories, copy files into a guest, publish a guest service on parent localhost, reason about VM network access, or manage Weave VM lifecycle and TTL.
---

# Weave

Use Weave to execute work in sandboxed Linux VMs with host mounts disabled by default.

## Installation check

Verify that the CLI is available before invoking it:

```sh
weave --version
```

If it is unavailable, ask the user before installing system software. Installation instructions are at `https://weave.4kshat.dev/docs/installation`.

## Start here

This file is a discovery stub. Before running task commands, load the workflow that matches the installed CLI:

```sh
weave skills get core
```

The CLI serves instructions that match its installed version. Use `weave skills get core` before the first Weave operation, then load specialized guidance as needed.

## Specialized guidance

```sh
weave skills get create       # provisioning, templates, resources, and mounts
weave skills get copy         # copying host files into a guest
weave skills get lifecycle    # TTL, start, stop, deletion, upgrade, and uninstall
weave skills get isolation    # mount safety, data boundaries, and output retrieval
weave skills get network      # outbound access and localhost TCP port publishing
weave skills list             # every section in this installed version
```

Run `weave <command> --help` when exact flags or arguments are needed.
