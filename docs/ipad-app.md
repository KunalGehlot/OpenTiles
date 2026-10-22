# Installing the iPad app

The OpenTiles iPad app is the web app in a native wrapper that can reach MIDI keyboards over USB and
Bluetooth, which no browser on an iPad can. It is not in the App Store. You install it yourself and
sign it with your own Apple ID: a free one is enough.

> **Status: experimental.** The app builds and installs, but has not yet been tried with a keyboard
> on a real iPad (PLAN.md P3-01). Please report what works and what does not.

## What you need to know first

- **A free Apple ID works.** Apps signed with one run for **7 days**; then the app no longer opens
  until it is signed again ("refreshed"). Your library and progress are kept in between. AltStore
  and SideStore refresh it for you; with Sideloadly or Xcode you install it again. An Apple
  Developer Program membership (paid) makes it last a year.
- **At most three** apps signed with a free Apple ID can be installed on a device at once, and
  AltStore or SideStore counts as one of them.
- **Developer Mode** must be on (iPadOS 16 and later): **Settings → Privacy & Security → Developer
  Mode**, then restart. The switch appears once a signed app has been installed, so you may need to
  install first and then turn it on.
- **Trust your Apple ID once:** **Settings → General → VPN & Device Management**, tap your Apple ID
  under "Developer App" and **Trust**. With AltStore or SideStore you do this once, when you set
  them up; the apps they install after that are trusted already.
- **Keep the same tool and Apple ID.** Signing with another Apple ID or tool installs a second copy
  with an empty library. Before switching, save a backup under **Settings → Backup** and restore it
  in the new copy.
- The tools below are made by other people, not by OpenTiles. They sign in to Apple with your Apple
  ID to make the signing certificate. Read what each one does before you give it your password; a
  separate free Apple ID for signing works just as well.

## Download

Get **`OpenTiles.ipa`** from the
[latest release](https://github.com/KunalGehlot/OpenTiles/releases/latest) (direct link:
<https://github.com/KunalGehlot/OpenTiles/releases/latest/download/OpenTiles.ipa>). The IPA is
unsigned: it is the same for everyone, and your tool signs it for you.

Newer than the latest release: signed in to GitHub, download `OpenTiles-ipa` from a run of the
[iPad app workflow](https://github.com/KunalGehlot/OpenTiles/actions/workflows/ios.yml) and unzip
it, or build it yourself ([option 3](#option-3-building-it-yourself-mac-with-xcode)).

## Option 1: AltStore or SideStore (updates itself)

Best if you want to set it up once. Both refresh the app before the 7 days run out.

1. Install [AltStore](https://altstore.io) (with AltServer on a Mac or PC) or
   [SideStore](https://sidestore.io) (refreshes on the iPad itself after setup), following their
   own instructions.
2. In AltStore or SideStore, open **Sources**, tap **+** and add:

   ```
   https://github.com/KunalGehlot/OpenTiles/releases/latest/download/altstore.json
   ```

3. Open the OpenTiles source and tap **Free** (or **Get**) to install. New releases appear as
   updates there.

You can also open `OpenTiles.ipa` straight from the Files app with AltStore or SideStore, without
adding the source; then you do not get updates.

## Option 2: Sideloadly (Mac or Windows)

1. Install [Sideloadly](https://sideloadly.io) and connect the iPad by USB (unlock it and tap
   **Trust** the first time).
2. Drag `OpenTiles.ipa` into Sideloadly, enter your Apple ID and press **Start**.
3. Trust your Apple ID on the iPad (above) and open OpenTiles.

Repeat step 2 within 7 days to keep the app opening (Sideloadly can also refresh it automatically
while the computer is on; see its settings).

## Option 3: Building it yourself (Mac with Xcode)

You need a Mac with Xcode, the toolchain in the [README](../README.md#run-it-yourself) (Node, pnpm,
Rust) and your Apple ID added in **Xcode → Settings → Accounts**. Note your **team ID** there: ten
letters and digits, shown for your team (for a free Apple ID the team is "Your Name (Personal
Team)").

```sh
pnpm install
TEAM=ABCDE12345 pnpm --filter @opentiles/ios-shell device
```

This builds the web app, signs the iPad app with your team and installs it on the connected iPad.
The app's identifier becomes `org.opentiles.app.<TEAM>`, because a free Apple ID cannot use one that
someone else has registered. With more than one device paired, add `DEVICE="<name or UDID>"`. Run
the same command again to refresh it.

To make your own unsigned IPA for the tools above:

```sh
pnpm --filter @opentiles/ios-shell ipa    # writes apps/ios-shell/build/OpenTiles.ipa
```

## When something goes wrong

| What you see                               | What to do                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| "Untrusted Developer" when opening the app | Trust your Apple ID: Settings → General → VPN & Device Management.                                                    |
| "Unable to Verify App"                     | Connect the iPad to the internet, then Settings → General → VPN & Device Management → your Apple ID → **Verify App**. |
| "Developer Mode required"                  | Settings → Privacy & Security → Developer Mode, then restart.                                                         |
| The app stopped opening after a week       | The 7 days ran out. Refresh it in AltStore or SideStore, or install it again; your library is still there.            |
| "Maximum number of apps" or "app ID limit" | A free Apple ID allows three signed apps at once and ten new app identifiers a week. Remove one or wait.              |
| The keyboard does not appear               | Plug it in (USB-C, or Apple's Lightning to USB Camera Adapter) and press **Connect MIDI keyboard** again.             |
| A Bluetooth keyboard does not appear       | Pair it in the app: Settings → MIDI keyboard → **Pair a Bluetooth MIDI keyboard**, not in the iPad's settings.        |

See also the [user guide](user-guide.md) and the [FAQ](faq.md). How the app is built is described
in [`apps/ios-shell/README.md`](../apps/ios-shell/README.md); why it is shipped this way, in
[ADR 0023](adr/0023-ipad-app-by-self-signing.md).
