## Install the iPad app

The OpenTiles iPad app reaches MIDI keyboards over USB and Bluetooth, which no iPad browser can. It
is not in the App Store: you sign it with your own Apple ID (a free one works) and install it
yourself. **Experimental:** please report what works and what does not.

- **AltStore or SideStore** (refreshes itself every 7 days): add this source, then install
  OpenTiles from it:
  `https://github.com/KunalGehlot/OpenTiles/releases/latest/download/altstore.json`
- **Sideloadly** (Mac or Windows): download `OpenTiles.ipa` below, drag it into Sideloadly, enter
  your Apple ID, press Start.
- **Mac with Xcode:** `TEAM=<your team ID> pnpm --filter @opentiles/ios-shell device` from a
  checkout of this tag.

With a free Apple ID the app runs for 7 days before it needs signing again (your library is kept),
at most three such apps at once, and Developer Mode must be on (Settings → Privacy & Security). Full
steps and fixes: [Installing the iPad app](https://github.com/KunalGehlot/OpenTiles/blob/main/docs/ipad-app.md).

The web app needs no install: <https://opentiles.site>.
