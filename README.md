# Weave

Weave is a small CLI for creating disposable, sandboxed Linux virtual machines. It wraps [Lima](https://lima-vm.io/) with secure defaults, automatic expiry, and a focused command set.

Each VM starts with host-directory mounts disabled, so commands run inside the guest instead of against files on the host. Weave bundles its own Lima 2.2.0 runtime and keeps its VM state separate from any system Lima installation.

## Features

- Disposable VMs with a configurable time to live (TTL)
- No host directories mounted into guests
- Built-in Node.js and Python templates
- Support for custom Lima YAML templates
- Interactive access and one-off command execution
- Native executables for macOS, Linux, and Windows on x64 and ARM64

## Requirements

To work on or run Weave from source, install [Bun 1.3.14 or later](https://bun.sh/).

The host must also support the virtualization backend used by Lima:

- macOS uses Virtualization.framework (`vz`).
- Linux uses QEMU.
- Windows uses QEMU and requires the matching `qemu-system-*` executable on `PATH`. It can instead be set with `QEMU_SYSTEM_X86_64` or `QEMU_SYSTEM_AARCH64`.

On Apple silicon, nested virtualization is enabled when running on an Apple M3 or later with macOS 15 or later.

## Run from source

Clone the repository, install dependencies, and invoke the CLI entry point:

```sh
bun install
bun packages/cli/src/index.ts --help
```

For example, create a VM named `dev`, open a shell in it, and delete it when finished:

```sh
bun packages/cli/src/index.ts create dev
bun packages/cli/src/index.ts ssh dev
bun packages/cli/src/index.ts kill dev
```

To use the shorter `weave` commands shown below, build a standalone executable and place the executable for your platform from `packages/cli/out` on your `PATH`:

```sh
bun run --cwd packages/cli build
```

The build produces executables for all supported platform and architecture combinations.

For fresh installations, the release installer places `weave` under the user-owned `~/.local/bin` directory by default, so installation, upgrades, and uninstallation do not require administrator access.

## Usage

Create a VM with the default 10-minute TTL:

```sh
weave create dev
```

Customize its CPU count, integer memory in GiB, and TTL:

```sh
weave create dev --cpus 4 --memory 8 --ttl 1h
```

TTL values are a positive integer followed by `s`, `m`, `h`, or `d`. When the TTL expires, the guest shuts down but is not deleted. Restart it without changing its configuration or disk:

```sh
weave start dev
```

Starting assigns a new 10-minute TTL by default. Use `weave start dev --ttl 1h` to choose another duration. For backward compatibility, `weave create` with the same name also continues to restart a stopped VM, and its resource flags can update the existing configuration.

### Templates

Create a VM with the built-in Node.js template:

```sh
weave create node-dev --template node
```

The `node` template installs the current Node.js LTS release through nvm. The `python` template installs Python through uv:

```sh
weave create py-dev --template python
```

You can also provide a custom Lima YAML file:

```sh
weave create custom-dev --template ./templates/custom.yaml
```

A template can only be supplied when creating a new VM, not when restarting an existing one.

### Commands

| Command | Description |
| --- | --- |
| `weave create <name> [--cpus <count>] [--memory <GiB>] [--ttl <duration>] [--template <name-or-path>]` | Create a new VM or restart a stopped one |
| `weave start <name> [--ttl <duration>]` | Start a stopped VM without changing its configuration or disk |
| `weave ls` | List VMs, their status, and remaining TTL (`list` is an alias) |
| `weave ssh <name>` | Open an interactive shell in a running VM |
| `weave shell <name> "<command>"` | Run a command in a running VM |
| `weave stop <name>` | Stop a VM without deleting it |
| `weave kill <name>` | Permanently delete a VM |
| `weave upgrade` | Atomically upgrade to the latest stable release |
| `weave uninstall` | Stop managed VMs and remove only the CLI binary |

Run `weave <command> --help` for command-specific examples and options.

## Data and isolation

On macOS and Linux, Weave stores its bundled runtime, templates, and VM state under `~/weave`. On Windows, it uses `%APPDATA%\weave`.

Weave passes `--mount-none` when it creates or starts a VM. `weave start` first verifies that the persisted Lima configuration has no host-directory mounts and refuses to start an externally modified VM until `weave create <name>` safely removes them. CPU, memory, and disk configuration remain unchanged. VMs retain their own virtual disk when stopped and continue to have network access. Use `weave kill <name>` when the disk and its data are no longer needed.

`weave uninstall` discovers and stops every running VM in Weave's dedicated Lima state before removing the CLI. It retains the bundled runtime, configuration, VM disks, and guest user data. If VM discovery, shutdown, or binary removal fails, it reports the recovery action and does not silently delete persistent data. Remove the Weave data directory manually only after confirming that none of its VMs or data are needed.

## Development

The repository is a Bun workspace managed with Turborepo. The CLI lives in `packages/cli` and is implemented in TypeScript with Effect.

```sh
# Apply formatting and safe lint fixes
bun run fix

# Check formatting and lint rules
bun run lint

# Type-check every package
bunx turbo check-types

# Test every package
bunx turbo test

# Build standalone executables
bunx turbo build
```

The regular test suite uses Vitest and does not start real VMs. Run the opt-in TTL integration test on a host with working virtualization:

```sh
bun run --cwd packages/cli test:integration
```

The integration test creates a uniquely named VM, verifies that it remains running before its TTL, waits for it to stop after expiry, and deletes it during cleanup.
