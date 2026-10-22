#!/usr/bin/env bash
# Builds the iPad app for people to install themselves (ADR 0023, docs/ipad-app.md).
#
#   build.sh ipa      An unsigned build/OpenTiles.ipa. Anyone signs it with their own Apple ID in
#                     AltStore, SideStore or Sideloadly; the app needs no entitlements, so a free
#                     account can sign it.
#   build.sh device   Builds, signs with your team and installs on a connected iPad. Needs Xcode
#                     signed in to your Apple ID (Settings → Accounts) and TEAM=<your team ID>.
#
# Environment:
#   TEAM          (device) your Apple team ID, ten characters (Xcode → Settings → Accounts).
#   BUNDLE_SUFFIX (device) added to org.opentiles.app; defaults to ".<TEAM>", because a free
#                 account cannot register an identifier someone else already owns.
#   DEVICE        (device) the iPad's name or UDID, when more than one device is paired.
#   BUILD_NUMBER  the build number (CFBundleVersion); defaults to the commit count.
#   SKIP_WEB=1    reuse the web build already copied into the Xcode project.
set -euo pipefail

mode="${1:-}"
if [[ "$mode" != ipa && "$mode" != device ]]; then
  echo "Usage: build.sh ipa|device" >&2
  exit 2
fi

shell_dir="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$shell_dir/../.." && pwd)"
out="$shell_dir/build"
project="$shell_dir/ios/App/App.xcodeproj"
version="$(node -p "require('$shell_dir/package.json').version")"
build_number="${BUILD_NUMBER:-$(git -C "$root" rev-list --count HEAD)}"

fail() {
  echo "error: $*" >&2
  exit 1
}

# The same public build that CI deploys to opentiles.site: verified catalogue pieces only, no sync
# server and so no crash reports. Vite also reads .env files, so refuse one that switches either on.
build_web() {
  unset VITE_SHOW_UNVERIFIED VITE_SYNC_URL
  if grep -sqE '^\s*VITE_(SHOW_UNVERIFIED|SYNC_URL)\s*=' "$root"/apps/web/.env*; then
    fail "apps/web/.env* sets VITE_SHOW_UNVERIFIED or VITE_SYNC_URL; a build for others must not."
  fi
  pnpm --dir "$shell_dir" run ios
  # Source maps stay out of the app, as they stay out of the site (the code is public).
  find "$shell_dir/ios/App/App/public" -name '*.map' -delete
}

# Prints the UDID of the one paired iPad or iPhone, or of $DEVICE.
pick_device() {
  local list="$out/devices.json"
  mkdir -p "$out"
  xcrun devicectl list devices --quiet --json-output "$list" >/dev/null
  node - "$list" "${DEVICE:-}" <<'EOF'
const [file, wanted] = process.argv.slice(2);
const devices = JSON.parse(require('node:fs').readFileSync(file, 'utf8')).result.devices.filter(
  (d) =>
    d.hardwareProperties?.platform === 'iOS' &&
    d.hardwareProperties?.reality === 'physical' &&
    d.connectionProperties?.pairingState === 'paired',
);
const name = (d) => `${d.deviceProperties?.name} (${d.hardwareProperties?.marketingName})`;
let pick = devices;
if (wanted) {
  pick = devices.filter((d) => [d.deviceProperties?.name, d.hardwareProperties?.udid, d.identifier].includes(wanted));
} else if (devices.length > 1) {
  // Prefer the one that is plugged in or reachable now.
  const connected = devices.filter((d) => d.connectionProperties?.tunnelState === 'connected');
  if (connected.length > 0) pick = connected;
}
if (pick.length !== 1) {
  const known = devices.map((d) => `  ${name(d)}: ${d.hardwareProperties?.udid}`).join('\n');
  console.error(
    pick.length === 0
      ? `No paired iPad or iPhone${wanted ? ` called ${wanted}` : ''}. Connect it by USB, unlock it and tap Trust.`
      : 'More than one device is paired; choose one with DEVICE=<name or UDID>.',
  );
  if (known) console.error(`Paired devices:\n${known}`);
  process.exit(1);
}
const d = pick[0];
if (d.deviceProperties?.developerModeStatus === 'disabled') {
  console.error(
    `${name(d)}: turn on Developer Mode first (Settings → Privacy & Security → Developer Mode), then restart it.`,
  );
  process.exit(1);
}
console.error(`Installing on ${name(d)}.`);
console.log(d.hardwareProperties.udid);
EOF
}

xcode_build() {
  # MARKETING_VERSION and CURRENT_PROJECT_VERSION apply to every target, which is harmless; the
  # bundle identifier is changed through OPENTILES_BUNDLE_SUFFIX instead, which only the App target
  # reads, so Capacitor's frameworks keep their own identifiers.
  xcodebuild -project "$project" -scheme App -configuration Release -quiet \
    MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build_number" "$@" build
}

case "$mode" in
  ipa)
    [[ "${SKIP_WEB:-}" == 1 ]] || build_web
    xcode_build -destination 'generic/platform=iOS' -derivedDataPath "$out/dd" \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=
    app="$out/dd/Build/Products/Release-iphoneos/App.app"
    # An IPA is a zip with the app in Payload/.
    rm -rf "$out/ipa" "$out/OpenTiles.ipa"
    mkdir -p "$out/ipa/Payload"
    ditto "$app" "$out/ipa/Payload/App.app"
    (cd "$out/ipa" && zip -qrX "$out/OpenTiles.ipa" Payload)
    rm -rf "$out/ipa"
    echo "OpenTiles $version ($build_number): $out/OpenTiles.ipa"
    shasum -a 256 "$out/OpenTiles.ipa"
    ;;
  device)
    [[ "${TEAM:-}" =~ ^[A-Z0-9]{10}$ ]] ||
      fail "set TEAM to your ten-character Apple team ID (Xcode → Settings → Accounts → your team)."
    udid="$(pick_device)"
    [[ "${SKIP_WEB:-}" == 1 ]] || build_web
    xcode_build -destination "id=$udid" -derivedDataPath "$out/dd-device" \
      -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
      DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
      OPENTILES_BUNDLE_SUFFIX="${BUNDLE_SUFFIX-.$TEAM}"
    xcrun devicectl device install app --device "$udid" \
      "$out/dd-device/Build/Products/Release-iphoneos/App.app"
    echo "Installed OpenTiles $version ($build_number). On the iPad, trust your Apple ID once:"
    echo "Settings → General → VPN & Device Management → your Apple ID → Trust."
    ;;
esac
