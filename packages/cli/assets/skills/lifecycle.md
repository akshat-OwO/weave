# Weave VM and CLI lifecycle

```sh
weave ls
weave start <name> [--ttl <duration>] [--mount <directory>...]
weave stop <name>
weave kill <name>
```

- `ls` (alias: `list`) shows VM status and remaining TTL.
- TTL expiry powers off the VM but does not delete its disk.
- `start` starts an existing stopped VM, assigns a new TTL (10 minutes by default), and replaces its host mounts.
- `stop` powers off a VM while retaining its disk and guest data.
- `kill` permanently deletes the VM and its guest disk. Retrieve required results first.
- `create` can also restart an existing stopped VM for backward compatibility.

CLI maintenance:

```sh
weave upgrade
weave uninstall
```

- `upgrade` atomically installs the latest stable release and does not downgrade newer installations.
- `uninstall` stops managed VMs and removes only the CLI executable. It retains the runtime, configuration, VM disks, and guest data.
