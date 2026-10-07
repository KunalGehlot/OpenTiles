// MIDI keyboard input inside the iPad app (spec §5, PLAN.md P3-01). No iOS or iPadOS browser has
// Web MIDI, so apps/ios-shell reads keyboards through CoreMIDI and forwards their notes over the
// Capacitor bridge. The plugin module, and @capacitor/core with it, is imported lazily once the
// shell has been detected, so browsers never download it.
import type { CoreMidiPlugin } from '@opentiles/capacitor-core-midi';
import type { NoteEvent } from '@opentiles/practice';
import { now } from '../audio/context';
import { hasNativePlugin } from '../lib/native-shell';
import { audioTimeOf, ClockSync } from './clock-sync';
import type { MidiKeyboardInput } from './midi-input';
import { parseNativeNote, parseNativeSources } from './midi-message';
import type { NativeSource } from './midi-message';

/** The plugin's JavaScript name (jsName in CoreMidiPlugin.swift). */
const PLUGIN_NAME = 'CoreMidi';
/** Clock round trips measured on start, before the first note can arrive. */
const INITIAL_CLOCK_SAMPLES = 3;
/** How often the clock offset is measured again while listening. */
const CLOCK_RESYNC_MS = 5000;

/** True inside the iPad app when it ships the CoreMIDI plugin. */
export function nativeMidiAvailable(): boolean {
  return hasNativePlugin(PLUGIN_NAME);
}

/**
 * Loads the plugin module. It must resolve to the module namespace, never to the plugin object:
 * Capacitor's plugin is a Proxy that answers `then`, so a promise resolved with it never settles.
 */
export type CoreMidiLoader = () => Promise<{ CoreMidi: CoreMidiPlugin }>;

const loadCoreMidi: CoreMidiLoader = () => import('@opentiles/capacitor-core-midi');

interface ListenerHandle {
  remove: () => Promise<void>;
}

export class NativeMidiInput implements MidiKeyboardInput {
  readonly source = 'native-midi' as const;
  onNote: (event: NoteEvent) => void = () => {};
  onRelease: (pitch: number, time: number) => void = () => {};
  onDevicesChanged: (names: string[]) => void = () => {};
  private plugin: CoreMidiPlugin | null = null;
  private handles: ListenerHandle[] = [];
  private sources: NativeSource[] = [];
  private readonly clock = new ClockSync();
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Bumped by start() and stop(), so a start() still awaiting the bridge knows it is stale. */
  private generation = 0;

  constructor(
    private readonly load: CoreMidiLoader = loadCoreMidi,
    /** Seconds on the clock CoreMIDI times are mapped through (performance.now()). */
    private readonly localNow: () => number = () => performance.now() / 1000,
    /** Seconds on the practice clock (the AudioContext clock once audio has started). */
    private readonly audioNow: () => number = now,
  ) {}

  get deviceNames(): string[] {
    return this.sources.map((s) => s.name);
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    this.detach();
    try {
      await this.connect(generation);
    } catch (e) {
      // Leave nothing listening behind a failed start; the caller drops this input.
      if (generation === this.generation) this.detach();
      throw e;
    }
  }

  private async connect(generation: number): Promise<void> {
    const { CoreMidi } = await this.load();
    if (generation !== this.generation) return;
    this.plugin = CoreMidi;
    this.clock.reset();
    for (let i = 0; i < INITIAL_CLOCK_SAMPLES; i++) await this.measureClock();
    if (generation !== this.generation) return;

    const handles = await Promise.all([
      CoreMidi.addListener('noteOn', (e) => this.receive(e, true)),
      CoreMidi.addListener('noteOff', (e) => this.receive(e, false)),
      CoreMidi.addListener('devicesChanged', (e) => this.setSources(e)),
    ]);
    if (generation !== this.generation) {
      for (const h of handles) void h.remove().catch(() => {});
      return;
    }
    this.handles = handles;

    const result = await CoreMidi.start();
    if (generation !== this.generation) return;
    this.setSources(result);
    this.timer = setInterval(() => void this.measureClock(), CLOCK_RESYNC_MS);
  }

  stop(): void {
    this.generation++;
    this.detach();
    void this.plugin?.stop().catch(() => {});
  }

  private detach(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const h of this.handles) void h.remove().catch(() => {});
    this.handles = [];
  }

  private async measureClock(): Promise<void> {
    const plugin = this.plugin;
    if (!plugin) return;
    try {
      const localBefore = this.localNow();
      const { time } = await plugin.getTime();
      this.clock.add({ localBefore, remote: time, localAfter: this.localNow() });
    } catch {
      // Keep the previous estimate; notes fall back to "arrived just now" until there is one.
    }
  }

  private receive(payload: unknown, on: boolean): void {
    const note = parseNativeNote(payload);
    if (!note) return;
    const localNow = this.localNow();
    const eventLocal = this.clock.toLocal(note.time) ?? localNow;
    const time = audioTimeOf(eventLocal, localNow, this.audioNow());
    if (on) {
      const velocity = note.velocity > 0 ? note.velocity : undefined;
      this.onNote({ pitch: note.pitch, time, velocity, confidence: 1, source: 'native-midi' });
    } else {
      this.onRelease(note.pitch, time);
    }
  }

  private setSources(payload: unknown): void {
    this.sources = parseNativeSources(payload);
    this.onDevicesChanged(this.deviceNames);
  }
}
