// Registers the native CoreMIDI plugin with Capacitor. Only the iPad app loads this module (apps/web
// imports it lazily once it has detected the native shell); there is no web implementation.
//
// The value registerPlugin() returns is a Proxy that answers every property, including `then`.
// Never resolve a promise with it (for example by returning it from an async function): the
// promise would treat it as a thenable and never settle. Pass the module namespace around instead.
import { registerPlugin } from '@capacitor/core';
import type { CoreMidiPlugin } from './definitions';

export const CoreMidi = registerPlugin<CoreMidiPlugin>('CoreMidi');

export type { CoreMidiPlugin, MidiNoteEvent, MidiSource, SourcesResult } from './definitions';
