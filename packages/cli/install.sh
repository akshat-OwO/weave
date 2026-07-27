#!/bin/sh

set -eu
set -f

repository="${WEAVE_REPOSITORY:-akshat-OwO/weave}"
requested_version="${WEAVE_VERSION:-latest}"
uname_s="${WEAVE_UNAME_S:-$(uname -s)}"
uname_m="${WEAVE_UNAME_M:-$(uname -m)}"

fail() {
  printf "weave: %s\n" "$1" >&2
  exit 1
}

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
    fail "unsupported operating system: $uname_s"
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
    fail "unsupported architecture: $uname_m"
    ;;
esac

asset="weave-bun-$os-$arch"
binary_name="weave"

if [ "$os" = "windows" ]; then
  asset="$asset.exe"
  binary_name="weave.exe"
fi

if [ -n "${WEAVE_INSTALL_DIR:-}" ]; then
  install_dir="$WEAVE_INSTALL_DIR"
  install_dir_is_explicit=1
elif [ "$os" = "windows" ]; then
  install_dir="$HOME/.local/bin"
  install_dir_is_explicit=0
else
  install_dir="/usr/local/bin"
  install_dir_is_explicit=0
fi

install_path="$install_dir/$binary_name"
existing_path=""

if [ -f "$install_path" ] && [ -x "$install_path" ]; then
  existing_path="$install_path"
elif [ "$install_dir_is_explicit" -eq 0 ]; then
  path_candidate=""

  if command -v "$binary_name" >/dev/null 2>&1; then
    path_candidate="$(command -v "$binary_name")"
  elif [ "$binary_name" != "weave" ] && command -v weave >/dev/null 2>&1; then
    path_candidate="$(command -v weave)"
  fi

  if [ -n "$path_candidate" ] && [ -f "$path_candidate" ] && [ -x "$path_candidate" ]; then
    existing_path="$path_candidate"
    install_path="$existing_path"
    install_dir="${existing_path%/*}"
  fi
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/weave-install.XXXXXX")"
download_path="$tmp_dir/$binary_name"
release_metadata_path="$tmp_dir/release.json"
stage_path=""
stage_requires_sudo=0

cleanup() {
  if [ -n "$stage_path" ] && [ -e "$stage_path" ]; then
    if [ "$stage_requires_sudo" -eq 1 ]; then
      sudo rm -f "$stage_path" >/dev/null 2>&1 || true
    else
      rm -f "$stage_path" >/dev/null 2>&1 || true
    fi
  fi

  case "$tmp_dir" in
    "${TMPDIR:-/tmp}"/weave-install.*)
      rm -rf "$tmp_dir"
      ;;
  esac
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

download_to() {
  download_source=$1
  download_destination=$2

  if command -v curl >/dev/null 2>&1; then
    curl \
      --fail \
      --location \
      --silent \
      --show-error \
      --output "$download_destination" \
      "$download_source"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet "$download_source" --output-document="$download_destination"
  else
    fail "curl or wget is required to check for and download releases"
  fi
}

validate_version() {
  unvalidated_version=$1

  case "$unvalidated_version" in
    v*)
      unvalidated_version=${unvalidated_version#v}
      ;;
  esac

  version_major=${unvalidated_version%%.*}
  version_remainder=${unvalidated_version#*.}

  if [ "$version_remainder" = "$unvalidated_version" ]; then
    return 1
  fi

  version_minor=${version_remainder%%.*}
  version_patch=${version_remainder#*.}

  if [ "$version_patch" = "$version_remainder" ]; then
    return 1
  fi

  case "$version_patch" in
    *.*)
      return 1
      ;;
  esac

  for version_component in "$version_major" "$version_minor" "$version_patch"; do
    case "$version_component" in
      "" | *[!0-9]* | 0[0-9]*)
        return 1
        ;;
    esac

    if [ "${#version_component}" -gt 9 ]; then
      return 1
    fi
  done

  validated_version="$version_major.$version_minor.$version_patch"
}

compare_versions() {
  comparison_left=$1
  comparison_right=$2

  comparison_left_major=${comparison_left%%.*}
  comparison_left_remainder=${comparison_left#*.}
  comparison_left_minor=${comparison_left_remainder%%.*}
  comparison_left_patch=${comparison_left_remainder#*.}
  comparison_right_major=${comparison_right%%.*}
  comparison_right_remainder=${comparison_right#*.}
  comparison_right_minor=${comparison_right_remainder%%.*}
  comparison_right_patch=${comparison_right_remainder#*.}

  for comparison_pair in \
    "$comparison_left_major:$comparison_right_major" \
    "$comparison_left_minor:$comparison_right_minor" \
    "$comparison_left_patch:$comparison_right_patch"; do
    comparison_left_component=${comparison_pair%%:*}
    comparison_right_component=${comparison_pair#*:}

    if [ "$comparison_left_component" -gt "$comparison_right_component" ]; then
      version_comparison=1
      return
    fi

    if [ "$comparison_left_component" -lt "$comparison_right_component" ]; then
      version_comparison=-1
      return
    fi
  done

  version_comparison=0
}

read_binary_version() {
  version_binary=$1
  version_description=$2

  if ! binary_version_output=$("$version_binary" --version 2>&1); then
    fail "could not read the $version_description version from $version_binary; the existing installation was not changed"
  fi

  case "$binary_version_output" in
    "weave v"*)
      binary_version=${binary_version_output#"weave v"}
      ;;
    *)
      fail "$version_description at $version_binary reported an unrecognized version ('$binary_version_output'); refusing to replace it automatically"
      ;;
  esac

  if ! validate_version "$binary_version"; then
    fail "$version_description at $version_binary reported a non-release version ('$binary_version_output'); refusing to replace it automatically"
  fi

  binary_validated_version="$validated_version"
}

installed_version=""

if [ -n "$existing_path" ]; then
  read_binary_version "$existing_path" "installed Weave"
  installed_version="$binary_validated_version"
fi

if [ "$requested_version" = "latest" ]; then
  release_api_url="https://api.github.com/repos/$repository/releases/latest"

  if ! download_to "$release_api_url" "$release_metadata_path"; then
    fail "could not resolve the latest Weave release; the existing installation was not changed"
  fi

  release_tag="$(
    sed -n \
      's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$release_metadata_path" |
      sed -n '1p'
  )"

  if [ -z "$release_tag" ]; then
    fail "the latest GitHub release did not include a valid tag; the existing installation was not changed"
  fi
else
  release_tag="$requested_version"
fi

if ! validate_version "$release_tag"; then
  fail "release version '$release_tag' is not a stable semantic version; the existing installation was not changed"
fi

release_version="$validated_version"
release_tag="v$release_version"

if [ -n "$installed_version" ]; then
  compare_versions "$installed_version" "$release_version"

  if [ "$version_comparison" -eq 0 ]; then
    printf "Weave %s is already up to date at %s\n" "$installed_version" "$existing_path"
    exit 0
  fi

  if [ "$version_comparison" -gt 0 ]; then
    printf \
      "Installed Weave %s is newer than release %s; leaving %s unchanged.\n" \
      "$installed_version" \
      "$release_version" \
      "$existing_path"
    exit 0
  fi
fi

if [ -n "${WEAVE_DOWNLOAD_URL:-}" ]; then
  download_url="$WEAVE_DOWNLOAD_URL"
else
  download_url="https://github.com/$repository/releases/download/$release_tag/$asset"
fi

if [ -n "$installed_version" ]; then
  printf "Upgrading Weave from %s to %s for %s/%s...\n" \
    "$installed_version" \
    "$release_version" \
    "$os" \
    "$arch"
else
  printf "Downloading Weave %s for %s/%s...\n" "$release_version" "$os" "$arch"
fi

if ! download_to "$download_url" "$download_path"; then
  fail "failed to download Weave $release_version; the existing installation was not changed"
fi

chmod 755 "$download_path"
read_binary_version "$download_path" "downloaded Weave"

if [ "$binary_validated_version" != "$release_version" ]; then
  fail "downloaded Weave reported version $binary_validated_version instead of $release_version; the existing installation was not changed"
fi

if mkdir -p "$install_dir" 2>/dev/null && [ -w "$install_dir" ]; then
  stage_path="$(mktemp "$install_dir/.weave-install.XXXXXX")"
  install -m 755 "$download_path" "$stage_path"
  mv -f "$stage_path" "$install_path"
  stage_path=""
elif command -v sudo >/dev/null 2>&1; then
  printf "Installing Weave to %s requires administrator access.\n" "$install_dir"
  sudo mkdir -p "$install_dir"
  stage_path="$(sudo mktemp "$install_dir/.weave-install.XXXXXX")"
  stage_requires_sudo=1
  sudo install -m 755 "$download_path" "$stage_path"
  sudo mv -f "$stage_path" "$install_path"
  stage_path=""
else
  fail "cannot write to $install_dir; set WEAVE_INSTALL_DIR to a writable PATH directory"
fi

if [ -n "$installed_version" ]; then
  printf "Weave was upgraded to %s at %s\n" "$release_version" "$install_path"
else
  printf "Weave was installed to %s\n" "$install_path"
fi

case ":$PATH:" in
  *":$install_dir:"*)
    printf "Run 'weave --help' to get started.\n"
    ;;
  *)
    printf "Add %s to your PATH, then run 'weave --help'.\n" "$install_dir"
    ;;
esac
