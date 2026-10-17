// Light or dark chosen in Settings (P5-09), set before anything is drawn so the other theme never
// flashes up. A file of its own, loaded from <head> before the stylesheet applies: the
// Content-Security-Policy allows no inline scripts. It reads the localStorage copy of the settings
// (storage/db.ts); settings/store.ts keeps the attribute up to date from then on.
try {
  var appearance = JSON.parse(localStorage.getItem('opentiles:setting:app') || '{}').appearance;
  if (appearance === 'light' || appearance === 'dark') {
    document.documentElement.setAttribute('data-theme', appearance);
  }
} catch (e) {
  // No storage here: the device's own colours.
}
