import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect("copies multiple host files into a guest directory", () =>
  Effect.gen(function* cpTest() {
    const harness = makeCliHarness({
      limaOutputs: [{ stderr: "", stdout: "protected" }],
    });

    yield* harness.run([
      "cp",
      "dev",
      "./package.json",
      "./src/index.ts",
      "--o",
      "/dev",
    ]);

    const stagingDirectory = harness.calls[1]?.args.at(-1);
    expect(stagingDirectory).toMatch(/^\/tmp\/weave-cp-[0-9a-f-]{36}$/u);
    expect(harness.calls).toEqual([
      {
        args: [
          "shell",
          "dev",
          "--",
          "sh",
          "-c",
          'if mkdir -p -- "$1" 2>/dev/null && [ -w "$1" ]; then printf writable; else printf protected; fi',
          "weave-cp",
          "/dev",
        ],
        captured: true,
      },
      {
        acceptableExitCodes: undefined,
        args: ["shell", "dev", "--", "mkdir", "-p", stagingDirectory],
      },
      {
        acceptableExitCodes: undefined,
        args: [
          "copy",
          "./package.json",
          "./src/index.ts",
          `dev:${stagingDirectory}/`,
        ],
      },
      {
        acceptableExitCodes: undefined,
        args: [
          "shell",
          "dev",
          "--",
          "sh",
          "-c",
          'destination=$1; if [ ! -d "$destination" ]; then sudo mkdir -p -- "$destination" && sudo chown "$(id -u):$(id -g)" -- "$destination" || exit; fi; sudo cp -a -- "$2"/. "$destination"/',
          "weave-cp",
          "/dev",
          stagingDirectory,
        ],
      },
      {
        acceptableExitCodes: undefined,
        args: ["shell", "dev", "--", "rm", "-rf", stagingDirectory],
      },
    ]);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toEqual([]);
  })
);

it.effect("defaults the guest destination to the guest home", () =>
  Effect.gen(function* defaultDestinationTest() {
    const harness = makeCliHarness({
      limaOutputs: [
        { stderr: "", stdout: "/home/test.guest" },
        { stderr: "", stdout: "writable" },
      ],
    });

    yield* harness.run(["cp", "dev", "./package.json"]);

    expect(harness.calls).toEqual([
      {
        args: ["shell", "dev", "--", "sh", "-c", 'printf "%s" "$HOME"'],
        captured: true,
      },
      {
        args: [
          "shell",
          "dev",
          "--",
          "sh",
          "-c",
          'if mkdir -p -- "$1" 2>/dev/null && [ -w "$1" ]; then printf writable; else printf protected; fi',
          "weave-cp",
          "/home/test.guest",
        ],
        captured: true,
      },
      {
        acceptableExitCodes: undefined,
        args: ["copy", "./package.json", "dev:/home/test.guest/"],
      },
    ]);
  })
);
