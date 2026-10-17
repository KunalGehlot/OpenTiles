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
import type { MidiSink } from '../audio/midi-out';
import { parseNativeNote, parseNativeSources } from './midi-message';
import type { NativeSource } from './midi-message';
import { pickOutput } from './pick-output';

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

/** Shows Apple's Bluetooth MIDI pairing screen in the iPad app (P6-12). */
export async function pairBluetoothKeyboard(load: CoreMidiLoader = loadCoreMidi): Promise<void> {
  const { CoreMidi } = await load();
  await CoreMidi.pairBluetooth();
}

/** Keeps the iPad app's screen on while the Player plays; outside the app, does nothing. */
export async function keepScreenAwake(
  on: boolean,
  load: CoreMidiLoader = loadCoreMidi,
): Promise<void> {
  if (!nativeMidiAvailable()) return;
  const { CoreMidi } = await load();
  await CoreMidi.keepAwake({ on });
}

interface ListenerHandle {
  remove: () => Promise<void>;
}

export class NativeMidiInput implements MidiKeyboardInput {
  readonly source = 'native-midi' as const;
  onNote: (event: NoteEvent) => void = () => {};
  onRelease: (pitch: number, time: number) => void = () => {};
  onDevicesChanged: (names: string[]) => void = () => {};
  /** The outputs (CoreMIDI destinations) came or went (P6-12). */
  onOutputsChanged: (names: string[]) => void = () => {};
  private plugin: CoreMidiPlugin | null = null;
  private handles: ListenerHandle[] = [];
  private sources: NativeSource[] = [];
  private destinations: NativeSource[] = [];
  /** Messages for the keyboard, sent over the bridge together at the end of the current task. */
  private pending: { destination: number; data: number[]; time?: number }[] = [];
  private sendQueued = false;
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

  get outputNames(): string[] {
    return this.destinations.map((d) => d.name);
  }

  /**
   * The app's notes on a keyboard through CoreMIDI (P6-12). Time stamps on performance.now() are
   * turned into host time with the same clock estimate the keys played use, and CoreMIDI sends
   * each message when it is due. Messages are batched, one bridge call per scheduling tick.
   */
  output(name = ''): MidiSink | null {
    const plugin = this.plugin;
    if (!plugin) return null;
    const pick = pickOutput(this.outputNames, this.deviceNames, name);
    const destination = this.destinations.find((d) => d.name === pick)?.id;
    if (destination === undefined) return null;
    return {
      send: (data, timestamp) => this.enqueue(destination, data, timestamp),
      // CoreMIDI can drop what it has not sent yet, so the session schedules as usual.
      clear: () => {
        this.pending = this.pending.filter((m) => m.destination !== destination);
        void plugin.flush({ destination }).catch(() => {});
      },
    };
  }

  private enqueue(destination: number, data: number[], timestamp?: number): void {
    const time = timestamp === undefined ? null : this.clock.toRemote(timestamp / 1000);
    this.pending.push({ destination, data: [...data], ...(time !== null ? { time } : {}) });
    if (this.sendQueued) return;
    this.sendQueued = true;
    queueMicrotask(() => this.sendPending());
  }

  private sendPending(): void {
    this.sendQueued = false;
    const plugin = this.plugin;
    const pending = this.pending;
    this.pending = [];
    if (!plugin) return;
    const byDestination = new Map<number, { data: number[]; time?: number }[]>();
    for (const { destination, ...message } of pending) {
      byDestination.set(destination, [...(byDestination.get(destination) ?? []), message]);
    }
    for (const [destination, messages] of byDestination) {
      void plugin.send({ destination, messages }).catch(() => {});
    }
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
      CoreMidi.addListener('destinationsChanged', (e) => this.setDestinations(e)),
    ]);
    if (generation !== this.generation) {
      for (const h of handles) void h.remove().catch(() => {});
      return;
    }
    this.handles = handles;

    const [result, outputs] = await Promise.all([
      CoreMidi.start(),
      // An app built before MIDI out (P6-12) has no destinations to list.
      Promise.resolve()
        .then(() => CoreMidi.listDestinations())
        .catch(() => ({ destinations: [] })),
    ]);
    if (generation !== this.generation) return;
    this.setDestinations(outputs);
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

  private setDestinations(payload: unknown): void {
    this.destinations = parseNativeSources(payload, 'destinations');
    this.onOutputsChanged(this.outputNames);
  }
}
