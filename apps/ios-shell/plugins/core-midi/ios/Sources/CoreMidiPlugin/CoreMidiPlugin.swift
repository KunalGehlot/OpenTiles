import Capacitor
import CoreAudioKit
import Foundation
import UIKit

/// MIDI keyboard input for the iPad app (spec §5, PLAN.md P3-01). No iOS or iPadOS browser has
/// Web MIDI, so the shell reads keyboards through CoreMIDI and forwards their notes to the web
/// app, which turns them into the same NoteEvents as Web MIDI (apps/web NativeMidiInput).
///
/// JavaScript API: src/definitions.ts. Events: 'noteOn' and 'noteOff' with
/// { pitch, velocity, channel, time }, 'devicesChanged' with { sources } and
/// 'destinationsChanged' with { destinations }. `time` is seconds on HostClock; getTime() returns
/// the same clock so the web app can map it onto its own. The app's notes go out to a keyboard
/// with send() and flush() (P6-12); pairBluetooth() shows Apple's Bluetooth MIDI pairing screen.
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
        CAPPluginMethod(name: "getTime", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDestinations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pairBluetooth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise)
    ]

    /// Created on first use and kept for the life of the app. Main thread only.
    private var session: MidiSession?
    /// The Bluetooth pairing screen while it shows, and the call to answer when it closes.
    private var pairing: (screen: UIViewController, call: CAPPluginCall)?

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

    @objc func listDestinations(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                let destinations = try self.openSession().destinations()
                call.resolve(["destinations": destinations.map { $0.json }])
            } catch {
                call.reject("MIDI is not available: \(error.localizedDescription)")
            }
        }
    }

    /// { destination, messages: [{ data: [status, data1, data2], time? }] }, one call per batch
    /// of notes so the bridge is crossed once per scheduling tick.
    @objc func send(_ call: CAPPluginCall) {
        guard let destination = call.getInt("destination") else {
            call.reject("No destination given.")
            return
        }
        let messages: [(bytes: [Int], time: Double?)] = (call.getArray("messages") ?? []).compactMap {
            guard let message = $0 as? JSObject,
                  let data = message["data"] as? [Any]
            else { return nil }
            let bytes = data.compactMap { ($0 as? NSNumber)?.intValue }
            return (bytes: bytes, time: (message["time"] as? NSNumber)?.doubleValue)
        }
        DispatchQueue.main.async {
            do {
                let sent = try self.openSession().send(to: Int32(truncatingIfNeeded: destination), messages: messages)
                call.resolve(["sent": sent])
            } catch {
                call.reject("MIDI could not send: \(error.localizedDescription)")
            }
        }
    }

    @objc func flush(_ call: CAPPluginCall) {
        let destination = call.getInt("destination").map { Int32(truncatingIfNeeded: $0) }
        DispatchQueue.main.async {
            self.session?.flush(destination)
            call.resolve()
        }
    }

    /// Shows Apple's Bluetooth MIDI screen, where a keyboard is found and paired; resolves when
    /// the learner closes it. A paired keyboard then appears as a source like a USB one.
    @objc func pairBluetooth(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pairing == nil, let presenter = self.bridge?.viewController else {
                call.reject("The pairing screen cannot be shown now.")
                return
            }
            let central = CABTMIDICentralViewController()
            central.navigationItem.rightBarButtonItem = UIBarButtonItem(
                barButtonSystemItem: .done, target: self, action: #selector(self.closePairing)
            )
            let screen = UINavigationController(rootViewController: central)
            screen.modalPresentationStyle = .formSheet
            self.pairing = (screen: screen, call: call)
            presenter.present(screen, animated: true)
        }
    }

    @objc private func closePairing() {
        guard let pairing = pairing else { return }
        self.pairing = nil
        pairing.screen.dismiss(animated: true) {
            pairing.call.resolve()
        }
    }

    /// Keeps the screen on while the Player plays ({ on: true }), and lets it sleep again.
    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
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
            },
            onDestinations: { [weak self] destinations in
                self?.emit("destinationsChanged", ["destinations": destinations.map { $0.json }])
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
