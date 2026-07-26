# Weave

Weave is a CLI for creating disposable, sandboxed Linux environments with [Firecracker](https://firecracker-microvm.github.io/).

Every user environment is a Firecracker microVM. On Linux hosts with usable KVM, Weave runs Firecracker natively. On Apple M3-or-later machines with macOS 15 or later, Weave creates one Lima instance named `weave-lima-vm` and runs all Firecracker microVMs inside that Linux host.

## Architecture

```text
Linux + /dev/kvm
└── Firecracker: dev, test, build

macOS 15+ on Apple M3+
└── Lima: weave-lima-vm
    └── Firecracker: dev, test, build
```

`weave-lima-vm` is infrastructure and never appears as a user VM in `weave ls`. CPU, memory and TTL flags always configure the Firecracker VM.

## Features

- Firecracker microVMs with configurable vCPU, memory and TTL
- Native KVM execution on supported Linux machines
- One persistent Lima host for supported macOS machines
- Aggregate CPU and memory admission control
- Firecracker jailer, per-VM users and cgroup resource limits
- Per-VM TAP networking with private/link-local egress filtering
- Persistent VM disks across stop and restart
- Built-in Node.js and Python provisioning
- Interactive SSH and one-off command execution
- Pinned and integrity-checked runtime, kernel and rootfs artifacts

## Requirements

To work on or run Weave from source, install [Bun 1.3.14 or later](https://bun.sh/).

### Native Linux

The host must:

- Run `x86_64` or `aarch64` Linux.
- Expose `/dev/kvm` read/write to the current user.
- Provide `curl`, `ip`, `iptables`, `mkfs.ext4`, `pkill`, `ssh`, `ssh-keygen`, `sudo` and `unsquashfs`.
- Allow `sudo` for TAP, firewall, jailer, cgroup and rootfs setup.

The first create downloads Firecracker 1.15.1, a pinned Linux 6.1 guest kernel and an Ubuntu 24.04 rootfs from the official Firecracker release and CI locations.

### Lima fallback

The supported fallback currently requires:

- Apple M3 or later.
- macOS 15 or later.
- Lima's VZ nested virtualization support.

Weave bundles Lima 2.2.0 and installs it lazily only when the fallback is selected. The outer `weave-lima-vm` receives approximately 75% of host CPUs, two-thirds of host memory and a 100 GiB disk. Firecracker VM admission is based on aggregate running memory and vCPUs, not the largest individual VM. Weave reserves one outer-host CPU, at least 1 GiB for the outer Linux system and 128 MiB of process overhead per running microVM.

Apple M1/M2, Intel Macs, Windows and Linux machines without usable KVM do not currently have a supported Firecracker execution path.

## Run from source

```sh
bun install
bun packages/cli/src/index.ts --help
```

Build standalone executables with:

```sh
bun run --cwd packages/cli build
```

## Usage

Create a VM with the default 10-minute TTL:

```sh
weave create dev
```

Set Firecracker vCPUs, memory in GiB and TTL:

```sh
weave create dev --cpus 4 --memory 8 --ttl 1h
```

TTL values are a positive integer followed by `s`, `m`, `h`, or `d`. Expiry reboots the guest, which terminates its Firecracker process without deleting the writable rootfs. Running `weave create` again restarts the stopped VM, applies new CPU and memory values and assigns a new TTL.

### Templates

Provision Node.js:

```sh
weave create node-dev --template node
```

Provision Python through uv:

```sh
weave create py-dev --template python
```

The previous custom Lima YAML template format is intentionally unsupported because Firecracker cannot consume Lima templates. A future custom template format will be owned by Weave and describe rootfs/provisioning behavior.

### Commands

| Command | Description |
| --- | --- |
| `weave create <name> [--cpus <count>] [--memory <GiB>] [--ttl <duration>] [--template node\|python]` | Create or restart a Firecracker VM |
| `weave ls` | List VMs, backend, resources and remaining TTL (`list` is an alias) |
| `weave ssh <name>` | Open an interactive shell |
| `weave shell <name> "<command>"` | Run a command |
| `weave stop <name>` | Stop a VM and retain its disk |
| `weave kill <name>` | Permanently delete a VM and its disk |

## State and isolation

On macOS and Linux, Weave stores local artifacts and VM metadata under `~/weave`. On Windows it uses `%APPDATA%\weave`.

Native Firecracker disks and jails are stored under `/var/lib/weave/<uid>`. In fallback mode, they live inside `weave-lima-vm` under `/var/lib/weave`. Backend-neutral metadata and downloaded artifacts remain in the local Weave directory.

VM lifecycle mutations are serialized with a filesystem lock so concurrent creates cannot overbook capacity or allocate the same network slot.

The Firecracker jailer runs each VM under a dedicated UID/GID. Cgroups bound memory and CPU, and TAP-specific firewall rules reject access to private and link-local destinations before allowing internet egress.

## Development

The repository is a Bun workspace managed with Turborepo. The CLI is implemented in TypeScript with Effect.

```sh
bun run fix
bun run lint
bunx turbo check-types
bunx turbo test
```

The regular test suite does not start real VMs. The opt-in integration test requires a supported host and performs the initial runtime/rootfs download:

```sh
bun run --cwd packages/cli test:integration
```
