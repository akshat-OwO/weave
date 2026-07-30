# Weave network access and port publishing

Guests retain outbound DNS and internet access. Weave removes directly routable VM networks and denies parent access to guest application ports by default.

## Publish a guest service

```sh
weave port add <name> <parent-port>:<guest-port>
weave port ls <name>
weave port remove <name> <parent-port>
```

Example:

```sh
weave port add agent-task 8080:3000
weave shell agent-task "cd /workspace && nohup bun run dev >/tmp/weave-dev.log 2>&1 &"
curl --fail --retry 10 --retry-connrefused --retry-delay 1 --retry-max-time 20 http://127.0.0.1:8080
weave port remove agent-task 8080
```

- Read mappings as `PARENT_PORT:GUEST_PORT`, matching Docker-style order.
- Published mappings support TCP only and bind to `127.0.0.1` on the parent. They are not exposed on every parent interface.
- Ports must be between 1 and 65535. Guest port 22 is reserved for VM access and cannot be published.
- Add multiple mappings with repeated `port add` commands. A parent port cannot be added twice to the same VM.
- Use `weave port list <name>` as an alias for `port ls`, and `weave port rm <name> <parent-port>` as an alias for `port remove`.
- Mappings persist across VM stops and starts.
- Adding or removing a mapping on a running VM briefly restarts it because Lima cannot reload forwarding rules in place. Weave preserves the existing absolute TTL expiry rather than granting fresh time.
- Configure mappings before starting a long-running guest service when possible so the restart does not interrupt it.
- Only VMs in `Running` or `Stopped` state can have their mappings changed.
