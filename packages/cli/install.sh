#!/bin/sh

set -eu

repository="${WEAVE_REPOSITORY:-akshat-OwO/weave}"
version="${WEAVE_VERSION:-latest}"
uname_s="${WEAVE_UNAME_S:-$(uname -s)}"
uname_m="${WEAVE_UNAME_M:-$(uname -m)}"

case "$uname_s" in
  Darwin)
    os="darwin"
    ;;
  Linux)
    os="linux"
    ;;
  CYGWIN* | MINGW* | MSYS*)
    os="windows"
    ;;
  *)
    printf "weave: unsupported operating system: %s\n" "$uname_s" >&2
    exit 1
    ;;
esac

case "$uname_m" in
  aarch64 | arm64)
    arch="arm64"
    ;;
  amd64 | x86_64)
    arch="x64"
    ;;
  *)
    printf "weave: unsupported architecture: %s\n" "$uname_m" >&2
    exit 1
    ;;
esac

asset="weave-bun-$os-$arch"
binary_name="weave"

if [ "$os" = "windows" ]; then
  asset="$asset.exe"
  binary_name="weave.exe"
fi

if [ -n "${WEAVE_DOWNLOAD_URL:-}" ]; then
  download_url="$WEAVE_DOWNLOAD_URL"
elif [ "$version" = "latest" ]; then
  download_url="https://github.com/$repository/releases/latest/download/$asset"
else
  download_url="https://github.com/$repository/releases/download/$version/$asset"
fi

if [ -n "${WEAVE_INSTALL_DIR:-}" ]; then
  install_dir="$WEAVE_INSTALL_DIR"
elif [ "$os" = "windows" ]; then
  install_dir="$HOME/.local/bin"
else
  install_dir="/usr/local/bin"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/weave-install.XXXXXX")"
download_path="$tmp_dir/$binary_name"

cleanup() {
  case "$tmp_dir" in
    "${TMPDIR:-/tmp}"/weave-install.*)
      rm -rf -- "$tmp_dir"
      ;;
  esac
}
trap cleanup EXIT HUP INT TERM

printf "Downloading Weave for %s/%s...\n" "$os" "$arch"

if command -v curl >/dev/null 2>&1; then
  curl --fail --location --silent --show-error "$download_url" --output "$download_path"
elif command -v wget >/dev/null 2>&1; then
  wget --quiet "$download_url" --output-document="$download_path"
else
  printf "weave: curl or wget is required to download the binary\n" >&2
  exit 1
fi

chmod 755 "$download_path"

if mkdir -p "$install_dir" 2>/dev/null && [ -w "$install_dir" ]; then
  install -m 755 "$download_path" "$install_dir/$binary_name"
elif command -v sudo >/dev/null 2>&1; then
  printf "Installing Weave to %s requires administrator access.\n" "$install_dir"
  sudo mkdir -p "$install_dir"
  sudo install -m 755 "$download_path" "$install_dir/$binary_name"
else
  printf "weave: cannot write to %s; set WEAVE_INSTALL_DIR to a writable PATH directory\n" "$install_dir" >&2
  exit 1
fi

printf "Weave was installed to %s/%s\n" "$install_dir" "$binary_name"

case ":$PATH:" in
  *":$install_dir:"*)
    printf "Run 'weave --help' to get started.\n"
    ;;
  *)
    printf "Add %s to your PATH, then run 'weave --help'.\n" "$install_dir"
    ;;
esac
