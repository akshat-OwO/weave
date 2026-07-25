# Weave

Weave allows users to create sandboxed environments.

## Engineering principles

- Prefer performance, reliability, and scalability over workarounds.
- Use Effect everywhere.
- Use Bun APIs.
- Never rely on memory when checking Effect behavior or APIs. Always inspect the installed Effect source in `node_modules`.

## Required validation

After every change, run all of the following:

```sh
bun run fix
bun run lint
bunx turbo check-types
bunx turbo test
```

Run Ultracite's auto-fix first, then its read-only quality check. Type-check through Turbo so every project runs its own `check-types` script. Do not consider a change complete until the fix has been applied and both Ultracite's check and all project-specific TypeScript type checks pass. Run tests through Turbo so every project runs its own `test` script. Do not consider a change complete until all tests pass.
