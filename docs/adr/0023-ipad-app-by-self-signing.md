# 0023 — The iPad app is signed by the people who install it

- **Status:** proposed
- **Date:** 2026-10-22
- **Plan task:** P3-01 (P3-02, the App Store, stays open)

## Context

No browser on an iPad can reach a MIDI keyboard (spec §5), so the iPad app (`apps/ios-shell`,
Capacitor plus a CoreMIDI plugin) is the only way to practise with one there, and the only way the
Player can play on the keyboard's own sound. On 2026-10-22 the maintainer asked for the iPad app
"which can be easily signed by the end user and side loaded into their device", while the website
work continues.

An iOS app runs only when Apple has signed it, directly (App Store, TestFlight) or through a
certificate from an Apple ID. The App Store needs the Apple Developer Program (paid, P3-02) and
review, and its terms add usage rules that the AGPL does not allow (`apps/ios-shell/README.md`,
App Store notes); that question needs legal advice and the contributors' agreement first. Any Apple
ID, including a free one, can sign an app for the owner's own devices: the app runs for 7 days (a
year with a paid membership), at most three such apps at once, ten new app identifiers a week.

## Decision

- **One unsigned IPA for everyone.** `pnpm --filter @opentiles/ios-shell ipa` builds the public web
  app (as deployed: verified catalogue only, no sync server, no source maps), syncs it into the
  Xcode project and makes a Release build with code signing switched off, zipped as
  `OpenTiles.ipa`. People sign it with their own Apple ID using AltStore, SideStore or Sideloadly.
  The app asks for no entitlements, so a free Apple ID can sign it; usage descriptions
  (microphone, Bluetooth) need none.
- **One command for Mac owners.** `TEAM=<team ID> pnpm --filter @opentiles/ios-shell device` builds,
  signs with automatic provisioning and installs on the connected iPad (`xcodebuild
-allowProvisioningUpdates`, `xcrun devicectl`). The bundle identifier becomes
  `org.opentiles.app.<TEAM>`, through `OPENTILES_BUNDLE_SUFFIX`, which only the App target reads, so
  Capacitor's frameworks keep their own identifiers.
- **Releases.** A version tag (`v0.1.0`, equal to `apps/ios-shell/package.json`) runs
  `.github/workflows/ios.yml` on macOS: the IPA, the CoreMIDI plugin's tests on an iPad simulator,
  and an AltStore / SideStore source (`altstore.json`, written from the IPA's own Info.plist) go
  onto a **draft** release that the maintainer reads and publishes by hand. The source's stable URL
  is `…/releases/latest/download/altstore.json`, so AltStore and SideStore offer each new release
  as an update. Pull requests that touch the app build it too.
- **Versions.** `CFBundleShortVersionString` is the shell's package version; `CFBundleVersion` is
  the commit count, so every build is newer than the last.
- **No service worker in the app.** The app carries its files and is updated as a whole, so the web
  app skips worker registration inside it.
- The user-facing steps are in `docs/ipad-app.md`.

## Consequences

- Anyone can run the app on their iPad today without the project paying Apple or passing review,
  and the AGPL question does not block it.
- Free signing is a chore: a refresh every 7 days (automatic with AltStore or SideStore), three apps
  at most, Developer Mode on. The guide says so plainly.
- The tools that sign are third-party and take the user's Apple ID; the guide says so and suggests a
  separate Apple ID. OpenTiles never sees it.
- Each Apple ID or tool gives the app another identifier and so a separate, empty library; the
  encrypted backup moves it.
- The macOS job is slower and only runs for app changes and tags; the website's CI and deploy do not
  wait for it.
- The App Store (P3-02) remains possible later; nothing here closes it.

## Alternatives considered

- **App Store or TestFlight now.** Needs the paid programme, review, and the AGPL / App Store terms
  settled first. TestFlight builds also expire (90 days) and need review for external testers.
- **AltStore PAL (the EU marketplace).** Needs a paid developer account and Apple's notarisation,
  the same blockers as the App Store.
- **Shipping a signed IPA.** A free certificate signs for registered devices only, and an enterprise
  certificate may not be used for the public. Every user would need the maintainer's account.
- **Xcode only.** Works, but asks every user for a Mac, Xcode and the whole toolchain; kept as the
  option for people who have them.
