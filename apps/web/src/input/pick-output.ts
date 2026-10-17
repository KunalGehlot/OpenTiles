// Which MIDI output the app's notes go to (P4-19). Its own module, so the Web MIDI and the iPad
// app's inputs can both use it.

/**
 * The output to play on: the one asked for by name, else the one named like a connected keyboard
 * (a keyboard's input and output share its name), else the only one there is.
 */
export function pickOutput(
  outputs: readonly string[],
  inputs: readonly string[],
  name = '',
): string | null {
  if (name && outputs.includes(name)) return name;
  const same = outputs.find((o) => inputs.includes(o));
  if (same) return same;
  return outputs.length === 1 ? (outputs[0] ?? null) : null;
}
