import path from "node:path";

import type { Effect } from "effect";

import { withFileLock } from "./file-lock";

const vmLockPath = (configPath: string, name: string): string =>
  path.join(configPath, "locks", `${name}.lock`);

export const withVmLock = <A, E, R>(
  configPath: string,
  name: string,
  effect: Effect.Effect<A, E, R>
) => withFileLock(vmLockPath(configPath, name), effect);
