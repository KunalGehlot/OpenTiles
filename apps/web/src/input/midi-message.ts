// Pure MIDI message decoding shared by the Web MIDI input and the iPad app's CoreMIDI input.

export interface MidiNoteMessage {
  /** False for note-off, including note-on with velocity 0 (the usual MIDI shorthand). */
  on: boolean;
  pitch: number;
  velocity: number;
}

/** Decodes a complete MIDI 1.0 message as Web MIDI delivers it; anything but a note is null. */
export function parseMidiMessage(
  data: ArrayLike<number> | null | undefined,
): MidiNoteMessage | null {
  if (!data || data.length < 3) return null;
  const status = (data[0] ?? 0) & 0xf0;
  const pitch = data[1] ?? 0;
  const velocity = data[2] ?? 0;
  if (status === 0x90 && velocity > 0) return { on: true, pitch, velocity };
  if (status === 0x80 || status === 0x90) return { on: false, pitch, velocity };
  return null;
}

export interface NativeNote {
  pitch: number;
  velocity: number;
  /** Seconds on the native host clock (CoreMidiPlugin's HostClock). */
  time: number;
}

const isMidiByte = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 127;

/**
 * Validates a 'noteOn' / 'noteOff' payload from the CoreMIDI plugin. The bridge hands over plain
 * JSON, so nothing about its shape is guaranteed; a malformed payload is dropped, not thrown.
 */
export function parseNativeNote(payload: unknown): NativeNote | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { pitch, velocity, time } = payload as Record<string, unknown>;
  if (!isMidiByte(pitch)) return null;
  if (typeof time !== 'number' || !Number.isFinite(time)) return null;
  return { pitch, velocity: isMidiByte(velocity) ? velocity : 0, time };
}

export interface NativeSource {
  id: number;
  name: string;
}

/** Validates the source list in a plugin result or 'devicesChanged' payload. */
export function parseNativeSources(
  payload: unknown,
  key: 'sources' | 'destinations' = 'sources',
): NativeSource[] {
  const sources: unknown =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)[key]
      : undefined;
  if (!Array.isArray(sources)) return [];
  const result: NativeSource[] = [];
  for (const s of sources as unknown[]) {
    if (typeof s !== 'object' || s === null) continue;
    const { id, name } = s as Record<string, unknown>;
    result.push({
      id: typeof id === 'number' ? id : result.length,
      name: typeof name === 'string' && name.trim() ? name : 'MIDI device',
    });
  }
  return result;
}
