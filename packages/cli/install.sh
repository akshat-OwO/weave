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
else
  install_dir="$HOME/.local/bin"
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

if [ -n "$existing_path" ] && [ -L "$existing_path" ]; then
  fail "existing Weave at $existing_path is a symbolic link; upgrade it with the tool that manages the link or set WEAVE_INSTALL_DIR to a non-symlink location"
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/weave-install.XXXXXX")"
download_path="$tmp_dir/$binary_name"
release_metadata_path="$tmp_dir/release.json"
stage_log="$tmp_dir/stage.log"
stage_path=""
stage_requires_sudo=0
active_pid=""
progress_active=0
interactive_output=0

if [ -t 1 ] && [ -t 2 ] && [ "${TERM:-dumb}" != "dumb" ] && [ -z "${CI:-}" ]; then
  interactive_output=1
fi

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

clear_progress() {
  if [ "$progress_active" -eq 1 ]; then
    printf "\r\033[2K"
    progress_active=0
  fi
}

handle_signal() {
  signal_name=$1
  signal_status=$2
  trap '' HUP INT TERM

  if [ -n "$active_pid" ]; then
    kill -TERM "$active_pid" 2>/dev/null || true
    wait "$active_pid" 2>/dev/null || true
    active_pid=""
  fi

  clear_progress
  printf "weave: installation interrupted by %s\n" "$signal_name" >&2
  trap - 0 HUP INT TERM
  cleanup
  exit "$signal_status"
}

trap cleanup 0
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

run_stage() {
  stage_message=$1
  success_message=$2
  failure_message=$3
  shift 3

  : >"$stage_log"

  if [ "$interactive_output" -eq 0 ]; then
    printf "%s...\n" "$stage_message"
  fi

  "$@" >"$stage_log" 2>&1 &
  active_pid=$!

  if [ "$interactive_output" -eq 1 ]; then
    spinner_index=1

    while kill -0 "$active_pid" 2>/dev/null; do
      case "$spinner_index" in
        1) spinner_frame='-' ;;
        2) spinner_frame='\' ;;
        3) spinner_frame='|' ;;
        *) spinner_frame='/' ;;
      esac
      printf "\r\033[2K%s %s" "$spinner_frame" "$stage_message"
      progress_active=1
      spinner_index=$((spinner_index % 4 + 1))
      sleep 0.1
    done
  fi

  stage_status=0
  wait "$active_pid" || stage_status=$?
  active_pid=""
  clear_progress

  if [ "$stage_status" -ne 0 ]; then
    printf "weave: %s\n" "$failure_message" >&2
    if [ -s "$stage_log" ]; then
      cat "$stage_log" >&2
    fi
    return 1
  fi

  printf "%s\n" "$success_message"
}

run_download_stage() {
  download_stage_message=$1
  download_success_message=$2
  download_failure_message=$3
  download_source=$4
  download_destination=$5

  if command -v curl >/dev/null 2>&1; then
    run_stage \
      "$download_stage_message" \
      "$download_success_message" \
      "$download_failure_message" \
      curl \
      --fail \
      --location \
      --silent \
      --show-error \
      --output "$download_destination" \
      "$download_source"
  elif command -v wget >/dev/null 2>&1; then
    run_stage \
      "$download_stage_message" \
      "$download_success_message" \
      "$download_failure_message" \
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

prepare_downloaded_binary() {
  chmod 755 "$download_path"
  read_binary_version "$download_path" "downloaded Weave"

  if [ "$binary_validated_version" != "$release_version" ]; then
    fail "downloaded Weave reported version $binary_validated_version instead of $release_version; the existing installation was not changed"
  fi
}

installed_version=""

if [ -n "$existing_path" ]; then
  read_binary_version "$existing_path" "installed Weave"
  installed_version="$binary_validated_version"
fi

if [ "$requested_version" = "latest" ]; then
  release_api_url="https://api.github.com/repos/$repository/releases/latest"

  run_download_stage \
    "Checking the latest Weave release" \
    "Checked the latest Weave release." \
    "could not resolve the latest Weave release; the existing installation was not changed" \
    "$release_api_url" \
    "$release_metadata_path"

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
  asset_stage_message="Upgrading Weave from $installed_version to $release_version for $os/$arch"
  asset_success_message="Downloaded the Weave $release_version upgrade."
else
  asset_stage_message="Downloading Weave $release_version for $os/$arch"
  asset_success_message="Downloaded Weave $release_version for $os/$arch."
fi

run_download_stage \
  "$asset_stage_message" \
  "$asset_success_message" \
  "failed to download Weave $release_version; the existing installation was not changed" \
  "$download_url" \
  "$download_path"

run_stage \
  "Validating the downloaded Weave binary" \
  "Validated the downloaded Weave binary." \
  "failed to validate Weave $release_version; the existing installation was not changed" \
  prepare_downloaded_binary

if mkdir -p "$install_dir" 2>/dev/null && [ -w "$install_dir" ]; then
  use_sudo=0
  stage_path="$(mktemp "$install_dir/.weave-install.XXXXXX")"
elif command -v sudo >/dev/null 2>&1; then
  printf "Installing Weave to %s requires administrator access.\n" "$install_dir"
  if ! sudo -v; then
    fail "failed to obtain administrator access for $install_dir; the existing installation was not changed"
  fi
  run_stage \
    "Preparing privileged install directory $install_dir" \
    "Prepared privileged install directory $install_dir." \
    "failed to prepare install directory $install_dir; the existing installation was not changed" \
    sudo mkdir -p "$install_dir"
  use_sudo=1
  stage_path="$(sudo mktemp "$install_dir/.weave-install.XXXXXX")"
  stage_requires_sudo=1
else
  fail "cannot write to $install_dir; set WEAVE_INSTALL_DIR to a writable PATH directory"
fi

if [ -n "$installed_version" ]; then
  install_success_message="Weave was upgraded to $release_version at $install_path"
else
  install_success_message="Weave was installed to $install_path"
fi

if [ "$use_sudo" -eq 1 ]; then
  run_stage \
    "Staging Weave in $install_dir" \
    "Staged Weave in $install_dir." \
    "failed to stage Weave in $install_dir; the existing installation was not changed" \
    sudo install -m 755 "$download_path" "$stage_path"
  run_stage \
    "Atomically installing Weave to $install_path" \
    "$install_success_message" \
    "failed to atomically install Weave to $install_path; the existing installation was not changed" \
    sudo mv -f "$stage_path" "$install_path"
else
  run_stage \
    "Staging Weave in $install_dir" \
    "Staged Weave in $install_dir." \
    "failed to stage Weave in $install_dir; the existing installation was not changed" \
    install -m 755 "$download_path" "$stage_path"
  run_stage \
    "Atomically installing Weave to $install_path" \
    "$install_success_message" \
    "failed to atomically install Weave to $install_path; the existing installation was not changed" \
    mv -f "$stage_path" "$install_path"
fi
stage_path=""

case ":$PATH:" in
  *":$install_dir:"*)
    printf "Run 'weave --help' to get started.\n"
    ;;
  *)
    printf "Add %s to your PATH, then run 'weave --help'.\n" "$install_dir"
    ;;
esac
