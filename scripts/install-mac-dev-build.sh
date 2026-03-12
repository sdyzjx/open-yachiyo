#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
APP_NAME="${APP_NAME:-Open Yachiyo.app}"
INSTALL_PARENT="${INSTALL_PARENT:-/Applications}"
INSTALL_PATH="${INSTALL_PARENT}/${APP_NAME}"

find_source_app() {
  local candidate
  local -a candidates=(
    "${DIST_DIR}/mac-arm64/${APP_NAME}"
    "${DIST_DIR}/mac/${APP_NAME}"
    "${DIST_DIR}/mac-universal/${APP_NAME}"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -d "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

SOURCE_APP="$(find_source_app || true)"
if [[ -z "${SOURCE_APP}" ]]; then
  echo "No built macOS app bundle found under ${DIST_DIR}." >&2
  echo "Run 'npm run desktop:dir:mac' first." >&2
  exit 1
fi

mkdir -p "${INSTALL_PARENT}"

echo "Installing dev build:"
echo "  source: ${SOURCE_APP}"
echo "  target: ${INSTALL_PATH}"

rsync -a --delete "${SOURCE_APP}/" "${INSTALL_PATH}/"

echo "Installed ${APP_NAME} to ${INSTALL_PATH}"
