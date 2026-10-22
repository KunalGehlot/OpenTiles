// Writes the AltStore / SideStore source for a release (ADR 0023): one JSON file, attached to the
// GitHub release next to OpenTiles.ipa, that those apps read to install and update OpenTiles.
// The version, build and permissions are read from the IPA itself, because AltStore refuses an app
// whose Info.plist disagrees with its source.
//
//   node scripts/altstore-source.mjs <OpenTiles.ipa> <download URL> > altstore.json
//
// macOS only (unzip and plutil), like the rest of the iOS build.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const [ipa, downloadURL] = process.argv.slice(2);
if (!ipa || !downloadURL) {
  console.error('Usage: node scripts/altstore-source.mjs <OpenTiles.ipa> <download URL>');
  process.exit(2);
}

const plistXml = execFileSync('unzip', ['-p', ipa, 'Payload/App.app/Info.plist']);
const info = JSON.parse(
  execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plistXml }).toString(),
);

// Every usage description the app declares; AltStore shows them before installing.
const privacy = Object.fromEntries(
  Object.entries(info).filter(([key]) => /^NS\w+UsageDescription$/.test(key)),
);

const site = 'https://opentiles.site';
const repo = 'https://github.com/KunalGehlot/OpenTiles';
const description =
  'A free, open-source piano trainer. Learn a piece with falling notes or sheet music, play it on ' +
  'a MIDI keyboard (USB or Bluetooth), an acoustic piano or the on-screen keys, and get instant ' +
  'feedback. No account, no tracking, no payment.';

const source = {
  name: 'OpenTiles',
  identifier: 'org.opentiles.source',
  subtitle: 'Free piano trainer',
  description,
  website: site,
  iconURL: `${site}/pwa-512x512.png`,
  sourceURL: `${repo}/releases/latest/download/altstore.json`,
  apps: [
    {
      name: 'OpenTiles',
      bundleIdentifier: info.CFBundleIdentifier,
      developerName: 'OpenTiles contributors',
      subtitle: 'Free piano trainer',
      localizedDescription: description,
      iconURL: `${site}/pwa-512x512.png`,
      category: 'other',
      versions: [
        {
          version: info.CFBundleShortVersionString,
          buildVersion: info.CFBundleVersion,
          date: new Date().toISOString().slice(0, 10),
          localizedDescription: `Release notes: ${repo}/releases`,
          downloadURL,
          size: statSync(ipa).size,
          minOSVersion: info.MinimumOSVersion,
        },
      ],
      appPermissions: { entitlements: [], privacy },
    },
  ],
  news: [],
};

process.stdout.write(`${JSON.stringify(source, null, 2)}\n`);
