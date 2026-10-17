// The JavaScript face of the Swift CoreMIDI plugin (ios/Sources/CoreMidiPlugin). Keep the payload
// shapes in step with CoreMidiPlugin.swift; apps/web validates every payload before using it.
import type { PluginListenerHandle } from '@capacitor/core';

/** A MIDI source (a keyboard, a USB interface port, a paired Bluetooth MIDI device). */
export interface MidiSource {
  /** CoreMIDI's unique ID for the source; stable while the device stays connected. */
  id: number;
  /** Display name, for example "Digital Piano Bluetooth". */
  name: string;
}

/** A note-on or note-off from any connected source. */
export interface MidiNoteEvent {
  /** MIDI note number, 0–127. */
  pitch: number;
  /** 1–127 for note-on. For note-off, the release velocity (often 0 or 64). */
  velocity: number;
  /** MIDI channel, 0–15. */
  channel: number;
  /**
   * When CoreMIDI received the message, in seconds on the device's monotonic clock (host time).
   * Compare it with getTime(), not with Date or performance.now().
   */
  time: number;
}

export interface SourcesResult {
  sources: MidiSource[];
}

/** A MIDI destination: a keyboard's input, where the app's notes go (P6-12). */
export type MidiDestination = MidiSource;

export interface DestinationsResult {
  destinations: MidiDestination[];
}

/** A MIDI 1.0 channel voice message, and when to send it in seconds on getTime()'s clock. */
export interface MidiOutMessage {
  data: number[];
  /** Omitted or in the past: now. */
  time?: number;
}

export interface CoreMidiPlugin {
  /** The sources CoreMIDI can see right now, connected or not. */
  listSources(): Promise<SourcesResult>;
  /**
   * Connects to every online source, and to sources that appear later, and starts emitting
   * 'noteOn' and 'noteOff'. Calling it again is harmless.
   */
  start(): Promise<SourcesResult>;
  /** Disconnects every source. 'devicesChanged' keeps firing. */
  stop(): Promise<void>;
  /** The current time on the clock 'time' fields use, for mapping it onto the web clocks. */
  getTime(): Promise<{ time: number }>;
  /** The destinations CoreMIDI can see right now (P6-12). */
  listDestinations(): Promise<DestinationsResult>;
  /** Sends a batch of messages to one destination, each at its time; `sent` is false if it is gone. */
  send(options: { destination: number; messages: MidiOutMessage[] }): Promise<{ sent: boolean }>;
  /** Drops messages still waiting to be sent, to one destination or to all. */
  flush(options: { destination?: number }): Promise<void>;
  /** Shows Apple's Bluetooth MIDI pairing screen; resolves when it is closed. */
  pairBluetooth(): Promise<void>;
  /** Keeps the screen on, or lets it sleep again. */
  keepAwake(options: { on: boolean }): Promise<void>;
  /** Note-on with velocity above 0. */
  addListener(
    eventName: 'noteOn',
    listener: (event: MidiNoteEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** Note-off, or note-on with velocity 0 (the usual MIDI shorthand for note-off). */
  addListener(
    eventName: 'noteOff',
    listener: (event: MidiNoteEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** A source was plugged in, paired, unplugged or renamed. */
  addListener(
    eventName: 'devicesChanged',
    listener: (event: SourcesResult) => void,
  ): Promise<PluginListenerHandle>;
  /** A destination came or went. */
  addListener(
    eventName: 'destinationsChanged',
    listener: (event: DestinationsResult) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
