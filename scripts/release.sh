#!/usr/bin/env bash
# Build a signed hive installer and publish it as a GitHub release with the updater feed.
# Usage: scripts/release.sh "<release notes>"
# Needs: gh logged in, the signing key at ~/.tauri/hive.key (never commit it; back it up —
# without it installed copies can no longer be updated).
set -euo pipefail

REPO="reteren/hive"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
NOTES="${1:-}"
KEY="$HOME/.tauri/hive.key"

[ -f "$KEY" ] || { echo "missing signing key $KEY" >&2; exit 1; }
VERSION="$(python -c "import json;print(json.load(open(r'$APP/src-tauri/tauri.conf.json',encoding='utf-8'))['version'])")"
TAG="v$VERSION"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "release $TAG already exists — bump the version first" >&2; exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
(cd "$APP" && npm run tauri build)

BUNDLE="$APP/src-tauri/target/release/bundle/nsis"
EXE="hive_${VERSION}_x64-setup.exe"
[ -f "$BUNDLE/$EXE" ] && [ -f "$BUNDLE/$EXE.sig" ] || { echo "installer or signature missing in $BUNDLE" >&2; exit 1; }

OUT="$(mktemp -d)"
cp "$BUNDLE/$EXE" "$BUNDLE/$EXE.sig" "$OUT/"
# GitHub replaces spaces etc. in asset names; ours are plain, so the download URL is predictable.
python - "$OUT" "$VERSION" "$EXE" "$REPO" "$NOTES" <<'EOF'
import json, sys, datetime, pathlib
out, version, exe, repo, notes = sys.argv[1:6]
sig = pathlib.Path(out, exe + ".sig").read_text(encoding="utf-8").strip()
feed = {
    "version": version,
    "notes": notes,
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {
        "windows-x86_64": {
            "signature": sig,
            "url": f"https://github.com/{repo}/releases/download/v{version}/{exe}",
        }
    },
}
pathlib.Path(out, "latest.json").write_text(json.dumps(feed, indent=2), encoding="utf-8")
EOF

# Not a pre-release: the updater reads releases/latest, which skips pre-releases.
gh release create "$TAG" --repo "$REPO" --title "hive $VERSION (beta)" \
  --notes "${NOTES:-hive $VERSION}" "$OUT/$EXE" "$OUT/$EXE.sig" "$OUT/latest.json"
echo "published $TAG"
