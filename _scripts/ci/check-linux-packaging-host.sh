#!/usr/bin/env bash
# Checks that this Linux host can run electron-builder's Linux targets
# (deb, rpm, pacman, AppImage, zip, 7z) for both x64 and arm64.
#
# electron-builder downloads its own fpm, AppImage tools and 7-Zip, with
# arm64-hosted builds of each, so the self-hosted arm64 runner needs only
# two system packages on top of that. Both need root to install, which the
# workflow does not have, so this script reports what is missing and how to
# provision it once instead of trying to install anything:
#
#   rpmbuild   fpm shells out to it for the rpm target   (apt: rpm)
#   bsdtar     fpm uses it for the pacman target         (apt: libarchive-tools)

set -euo pipefail

missing=()
command -v rpmbuild >/dev/null 2>&1 || missing+=(rpm)
command -v bsdtar >/dev/null 2>&1 || missing+=(libarchive-tools)

if [ "${#missing[@]}" -gt 0 ]; then
  echo "ERROR: this runner cannot build every Linux package target." >&2
  echo "Provision it once with:" >&2
  echo "    sudo apt install ${missing[*]}" >&2
  exit 1
fi

echo "Linux packaging host OK ($(uname -m)): rpmbuild and bsdtar present"
