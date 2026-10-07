import Capacitor
import Foundation

/// MIDI keyboard input for the iPad app (spec §5, PLAN.md P3-01). No iOS or iPadOS browser has
/// Web MIDI, so the shell reads keyboards through CoreMIDI and forwards their notes to the web
/// app, which turns them into the same NoteEvents as Web MIDI (apps/web NativeMidiInput).
///
/// JavaScript API: src/definitions.ts. Events: 'noteOn' and 'noteOff' with
/// { pitch, velocity, channel, time }, and 'devicesChanged' with { sources }. `time` is seconds
/// on HostClock; getTime() returns the same clock so the web app can map it onto its own.
///
/// The Capacitor CLI registers plugin classes by taking the first named @objc attribute in each
/// Swift file of this package (see `packageClassList` in capacitor.config.json). Only the class
/// below may carry one, and no comment above it may spell one out.
@objc(CoreMidiPlugin)
public class CoreMidiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CoreMidiPlugin"
    public let jsName = "CoreMidi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listSources", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTime", returnType: CAPPluginReturnPromise)
    ]

    /// Created on first use and kept for the life of the app. Main thread only.
    private var session: MidiSession?

    @objc func listSources(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                let sources = try self.openSession().sources()
                call.resolve(["sources": sources.map { $0.json }])
            } catch {
                call.reject("MIDI is not available: \(error.localizedDescription)")
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                let session = try self.openSession()
                session.start()
                call.resolve(["sources": session.sources().map { $0.json }])
            } catch {
                call.reject("MIDI could not be started: \(error.localizedDescription)")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.session?.stop()
            call.resolve()
        }
    }

    /// Answered straight from the bridge queue: the shorter the round trip, the more precisely
    /// the web app can line the clocks up.
    @objc func getTime(_ call: CAPPluginCall) {
        call.resolve(["time": HostClock.now()])
    }

    private func openSession() throws -> MidiSession {
        if let session = session {
            return session
        }
        let created = try MidiSession(
            onNote: { [weak self] note, time in
                self?.emit(note.isOn ? "noteOn" : "noteOff", [
                    "pitch": Int(note.pitch),
                    "velocity": Int(note.velocity),
                    "channel": Int(note.channel),
                    "time": time
                ])
            },
            onSources: { [weak self] sources in
                self?.emit("devicesChanged", ["sources": sources.map { $0.json }])
            }
        )
        session = created
        return created
    }

    /// notifyListeners reads the listener table that addListener and removeListener change on the
    /// bridge's queue, so events are posted from that queue rather than from CoreMIDI's thread.
    private func emit(_ event: String, _ data: [String: Any]) {
        let queue = (bridge as? CapacitorBridge)?.dispatchQueue ?? DispatchQueue.main
        queue.async { [weak self] in
            self?.notifyListeners(event, data: data)
        }
    }
}
