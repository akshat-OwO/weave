import path from "node:path";

import type { PlatformError } from "effect";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Match,
  Ref,
  Stream,
  Terminal,
} from "effect";

import { withProgress } from "../lib/progress";
import { RuntimeArtifactError } from "../schemas/errors/runtime-artifact.schema";
import { UserConfig } from "./user-config";

const FIRECRACKER_VERSION = "1.15.1";
const FIRECRACKER_CI_VERSION = "v1.15";
const GUEST_KERNEL_VERSION = "6.1.155";
const UBUNTU_VERSION = "24.04";

interface RuntimeRelease {
  readonly architecture: "aarch64" | "x86_64";
  readonly kernelMd5: string;
  readonly rootfsMd5: string;
  readonly sha256: string;
}

const runtimeRelease = Match.value(process.arch).pipe(
  Match.when(
    "arm64",
    () =>
      ({
        architecture: "aarch64",
        kernelMd5: "897ce0aad7285f83e218bc788c1ab042",
        rootfsMd5: "0f0a859802552329950af6aa5a1891fa",
        sha256:
          "00654ac1e702a22744121ea9f10a4f792ebd7c3a744cba587dfac9fcb79b41a5",
      }) satisfies RuntimeRelease
  ),
  Match.when(
    "x64",
    () =>
      ({
        architecture: "x86_64",
        kernelMd5: "44d1aea84475e5bed0dd4f27ddfca550",
        rootfsMd5: "0dc0850cb4f55566ac47ce94cd7703b2",
        sha256:
          "d4a32ab2322d887ca1bc4a4e7afa9cc35393e6362dfc2b3becb389d362e4275a",
      }) satisfies RuntimeRelease
  ),
  Match.orElse(() => void 0)
);

export interface FirecrackerArtifactPaths {
  readonly archive: string;
  readonly firecracker: string;
  readonly jailer: string;
  readonly kernel: string;
  readonly rootfsSquashfs: string;
  readonly sshPrivateKey: string;
  readonly sshPublicKey: string;
}

export const FirecrackerArtifacts = Context.Service<{
  readonly ensure: () => Effect.Effect<
    FirecrackerArtifactPaths,
    RuntimeArtifactError | PlatformError.PlatformError,
    never
  >;
}>("weave/services/firecrackerArtifacts");

const MEBIBYTES = 1024 ** 2;

const formatDownloadProgress = (
  artifact: string,
  downloadedBytes: number,
  contentLength?: number
): string => {
  const downloadedMiB = (downloadedBytes / MEBIBYTES).toFixed(1);
  if (
    contentLength === undefined ||
    !Number.isFinite(contentLength) ||
    contentLength <= 0
  ) {
    return `Downloading ${artifact}… ${downloadedMiB} MiB`;
  }

  const totalMiB = (contentLength / MEBIBYTES).toFixed(1);
  const percentage = Math.min(
    100,
    Math.floor((downloadedBytes / contentLength) * 100)
  );
  return `Downloading ${artifact}… ${downloadedMiB}/${totalMiB} MiB (${percentage}%)`;
};

const download = Effect.fn("weave/services/firecrackerArtifacts/download")(
  function* downloadHandler(
    fs: FileSystem.FileSystem,
    terminal: Terminal.Terminal,
    artifact: string,
    url: string,
    destination: string,
    expectedDigest?: {
      readonly algorithm: "md5" | "sha256";
      readonly value: string;
    }
  ) {
    if (yield* fs.exists(destination)) {
      return;
    }

    const temporaryDestination = `${destination}.download`;
    yield* fs.remove(temporaryDestination, { force: true });
    yield* withProgress(
      terminal,
      `Downloading ${artifact}…`,
      ({ setMessage }) =>
        Effect.gen(function* downloadStreamHandler() {
          const response = yield* Effect.tryPromise({
            catch: (cause) =>
              new RuntimeArtifactError({
                artifact,
                reason: `download failed: ${String(cause)}`,
              }),
            try: (signal) => fetch(url, { signal }),
          });
          if (!response.ok) {
            return yield* new RuntimeArtifactError({
              artifact,
              reason: `download returned HTTP ${response.status}`,
            });
          }
          if (response.body === null) {
            return yield* new RuntimeArtifactError({
              artifact,
              reason: "download returned an empty response body",
            });
          }

          const contentLengthHeader = response.headers.get("content-length");
          const contentLength =
            contentLengthHeader === null
              ? undefined
              : Number(contentLengthHeader);
          const downloadedBytes = yield* Ref.make(0);
          const hasher =
            expectedDigest === undefined
              ? undefined
              : new Bun.CryptoHasher(expectedDigest.algorithm);
          yield* Stream.fromReadableStream({
            evaluate: () => response.body as ReadableStream<Uint8Array>,
            onError: (cause) =>
              new RuntimeArtifactError({
                artifact,
                reason: `download stream failed: ${String(cause)}`,
              }),
          }).pipe(
            Stream.tap((chunk) =>
              Effect.gen(function* trackDownloadHandler() {
                hasher?.update(chunk);
                const totalDownloaded = yield* Ref.updateAndGet(
                  downloadedBytes,
                  (total) => total + chunk.byteLength
                );
                yield* setMessage(
                  formatDownloadProgress(
                    artifact,
                    totalDownloaded,
                    contentLength
                  )
                );
              })
            ),
            Stream.run(fs.sink(temporaryDestination))
          );

          if (
            expectedDigest !== undefined &&
            hasher?.digest("hex") !== expectedDigest.value
          ) {
            return yield* new RuntimeArtifactError({
              artifact,
              reason: `${expectedDigest.algorithm.toUpperCase()} checksum did not match the pinned artifact`,
            });
          }
          yield* fs.rename(temporaryDestination, destination);
        }).pipe(
          Effect.onError(() =>
            fs.remove(temporaryDestination, { force: true }).pipe(Effect.ignore)
          )
        )
    );
  }
);

const extractReleaseArchive = Effect.fn(
  "weave/services/firecrackerArtifacts/extractReleaseArchive"
)(function* extractReleaseArchiveHandler(archive: string, destination: string) {
  yield* Effect.tryPromise({
    catch: (cause) =>
      new RuntimeArtifactError({
        artifact: "Firecracker runtime",
        reason: `archive extraction failed: ${String(cause)}`,
      }),
    try: async () => {
      const compressedBytes = await Bun.file(archive).bytes();
      const tarBytes = Bun.gunzipSync(compressedBytes);
      await new Bun.Archive(tarBytes).extract(destination);
    },
  });
});

export const FirecrackerArtifactsLive = Layer.effect(
  FirecrackerArtifacts,
  Effect.gen(function* firecrackerArtifactsHandler() {
    const fs = yield* FileSystem.FileSystem;
    const terminal = yield* Terminal.Terminal;
    const userConfig = yield* UserConfig;

    return FirecrackerArtifacts.of({
      ensure: () =>
        Effect.gen(function* ensureHandler() {
          if (runtimeRelease === undefined) {
            return yield* new RuntimeArtifactError({
              artifact: "Firecracker runtime",
              reason: `unsupported CPU architecture "${process.arch}"`,
            });
          }

          const artifactsDirectory = path.join(
            userConfig.configPath,
            "artifacts",
            runtimeRelease.architecture,
            `firecracker-v${FIRECRACKER_VERSION}`
          );
          const archive = path.join(
            artifactsDirectory,
            `firecracker-v${FIRECRACKER_VERSION}.tgz`
          );
          const extractedDirectory = path.join(
            artifactsDirectory,
            `release-v${FIRECRACKER_VERSION}-${runtimeRelease.architecture}`
          );
          const firecracker = path.join(artifactsDirectory, "firecracker");
          const jailer = path.join(artifactsDirectory, "jailer");
          const kernel = path.join(
            artifactsDirectory,
            `vmlinux-${GUEST_KERNEL_VERSION}`
          );
          const rootfsSquashfs = path.join(
            artifactsDirectory,
            `ubuntu-${UBUNTU_VERSION}.squashfs`
          );
          const sshPrivateKey = path.join(artifactsDirectory, "id_ed25519");
          const sshPublicKey = `${sshPrivateKey}.pub`;
          const releaseBase =
            "https://github.com/firecracker-microvm/firecracker/releases/download";
          const ciBase =
            "https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci";

          yield* fs.makeDirectory(artifactsDirectory, { recursive: true });
          if (!(yield* fs.exists(sshPrivateKey))) {
            const result = yield* Effect.tryPromise({
              catch: (cause) =>
                new RuntimeArtifactError({
                  artifact: "Firecracker SSH key",
                  reason: `key generation failed: ${String(cause)}`,
                }),
              try: async (signal) => {
                const process = Bun.spawn({
                  cmd: [
                    "ssh-keygen",
                    "-q",
                    "-t",
                    "ed25519",
                    "-N",
                    "",
                    "-f",
                    sshPrivateKey,
                  ],
                  signal,
                  stderr: "pipe",
                  stdout: "ignore",
                });
                const [exitCode, stderr] = await Promise.all([
                  process.exited,
                  process.stderr.text(),
                ]);
                return { exitCode, stderr };
              },
            });
            if (result.exitCode !== 0) {
              return yield* new RuntimeArtifactError({
                artifact: "Firecracker SSH key",
                reason:
                  result.stderr.trim() || "ssh-keygen exited unsuccessfully",
              });
            }
          }
          if (!(yield* fs.exists(sshPublicKey))) {
            const result = yield* Effect.tryPromise({
              catch: (cause) =>
                new RuntimeArtifactError({
                  artifact: "Firecracker SSH public key",
                  reason: `public-key recovery failed: ${String(cause)}`,
                }),
              try: async (signal) => {
                const process = Bun.spawn({
                  cmd: ["ssh-keygen", "-y", "-f", sshPrivateKey],
                  signal,
                  stderr: "pipe",
                  stdout: "pipe",
                });
                const [exitCode, stderr, stdout] = await Promise.all([
                  process.exited,
                  process.stderr.text(),
                  process.stdout.text(),
                ]);
                return { exitCode, stderr, stdout };
              },
            });
            if (result.exitCode !== 0) {
              return yield* new RuntimeArtifactError({
                artifact: "Firecracker SSH public key",
                reason:
                  result.stderr.trim() || "ssh-keygen exited unsuccessfully",
              });
            }
            yield* fs.writeFileString(sshPublicKey, result.stdout);
          }
          yield* fs.chmod(sshPrivateKey, 0o600);
          yield* download(
            fs,
            terminal,
            "Firecracker runtime",
            `${releaseBase}/v${FIRECRACKER_VERSION}/firecracker-v${FIRECRACKER_VERSION}-${runtimeRelease.architecture}.tgz`,
            archive,
            {
              algorithm: "sha256",
              value: runtimeRelease.sha256,
            }
          );
          if (!(yield* fs.exists(firecracker)) || !(yield* fs.exists(jailer))) {
            yield* extractReleaseArchive(archive, artifactsDirectory);
            yield* fs.copyFile(
              path.join(
                extractedDirectory,
                `firecracker-v${FIRECRACKER_VERSION}-${runtimeRelease.architecture}`
              ),
              firecracker
            );
            yield* fs.copyFile(
              path.join(
                extractedDirectory,
                `jailer-v${FIRECRACKER_VERSION}-${runtimeRelease.architecture}`
              ),
              jailer
            );
          }
          yield* fs.chmod(firecracker, 0o755);
          yield* fs.chmod(jailer, 0o755);
          yield* download(
            fs,
            terminal,
            "Firecracker guest kernel",
            `${ciBase}/${FIRECRACKER_CI_VERSION}/${runtimeRelease.architecture}/vmlinux-${GUEST_KERNEL_VERSION}`,
            kernel,
            {
              algorithm: "md5",
              value: runtimeRelease.kernelMd5,
            }
          );
          yield* download(
            fs,
            terminal,
            "Firecracker Ubuntu rootfs",
            `${ciBase}/${FIRECRACKER_CI_VERSION}/${runtimeRelease.architecture}/ubuntu-${UBUNTU_VERSION}.squashfs`,
            rootfsSquashfs,
            {
              algorithm: "md5",
              value: runtimeRelease.rootfsMd5,
            }
          );

          return {
            archive,
            firecracker,
            jailer,
            kernel,
            rootfsSquashfs,
            sshPrivateKey,
            sshPublicKey,
          };
        }),
    });
  })
);
