# @weave/cli

## 0.0.3

### Patch Changes

- [#16](https://github.com/akshat-OwO/weave/pull/16) [`5ad63fc`](https://github.com/akshat-OwO/weave/commit/5ad63fc067403f2c017c6f37b35a419eb198d0ca) Thanks [@akshat-OwO](https://github.com/akshat-OwO)! - Install Weave under the user-owned `~/.local/bin` directory by default and avoid interactive sudo password prompts when upgrade or uninstall runs without a terminal.

## 0.0.2

### Patch Changes

- [#10](https://github.com/akshat-OwO/weave/pull/10) [`8bfdd7c`](https://github.com/akshat-OwO/weave/commit/8bfdd7cd2c866e40e65fbe9e2b9b8b032c341772) Thanks [@akshat-OwO](https://github.com/akshat-OwO)! - Show clean progress loaders across install and upgrade stages, with stable status lines in redirected output.

- [#9](https://github.com/akshat-OwO/weave/pull/9) [`bcf49f3`](https://github.com/akshat-OwO/weave/commit/bcf49f3a6aff33c038c1402085158833e58dffe9) Thanks [@akshat-OwO](https://github.com/akshat-OwO)! - Add `weave start` for restarting stopped VMs with a fresh TTL.

- [#12](https://github.com/akshat-OwO/weave/pull/12) [`cf673f6`](https://github.com/akshat-OwO/weave/commit/cf673f6505bb0cd1f7b988ccb742e86f8685da13) Thanks [@akshat-OwO](https://github.com/akshat-OwO)! - Add safe `weave upgrade` and `weave uninstall` lifecycle commands.

- [#8](https://github.com/akshat-OwO/weave/pull/8) [`b6bf660`](https://github.com/akshat-OwO/weave/commit/b6bf660b515828d8435198f408a14c57898549c8) Thanks [@akshat-OwO](https://github.com/akshat-OwO)! - Keep Lima informational logs inside Weave's progress output when restarting or updating stopped VMs.

- [#11](https://github.com/akshat-OwO/weave/pull/11) [`f9e662b`](https://github.com/akshat-OwO/weave/commit/f9e662b666952669db8f1963ae9da150edfb0b65) Thanks [@akshat-OwO](https://github.com/akshat-OwO)! - Detect existing Weave installations and safely upgrade them when the installer is rerun.

## 0.0.1

### Patch Changes

- [`f3c63d6`](https://github.com/akshat-OwO/weave/commit/f3c63d688e6fef959f0d41fe2ea1ca0bf8399dbe) Thanks [@akshat-OwO](https://github.com/akshat-OwO)! - Add a platform-aware binary installer and automated GitHub release pipeline.
