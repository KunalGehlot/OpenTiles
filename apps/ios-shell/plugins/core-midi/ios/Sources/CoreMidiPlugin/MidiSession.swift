import CoreMIDI
import Foundation

/// A MIDI source or destination as the web app sees it.
struct MidiSourceInfo: Equatable {
    let id: Int32
    let name: String

    var json: [String: Any] {
        ["id": Int(id), "name": name]
    }
}

enum MidiSessionError: LocalizedError {
    case coreMidi(String, OSStatus)

    var errorDescription: String? {
        switch self {
        case let .coreMidi(call, status):
            return "\(call) failed (OSStatus \(status))."
        }
    }
}

/// Owns the CoreMIDI client, the input port, kept connected to every online source while
/// listening (including sources plugged in or paired later), and the output port the app's notes
/// go out through (P6-12).
///
/// Create it, and call everything on it, on the main thread: CoreMIDI posts setup notifications
/// to the run loop of the thread that created the client. Only the receive block runs elsewhere,
/// and it touches nothing but its own arguments and the immutable `onNote` handler.
final class MidiSession {
    /// A note and its arrival time in seconds on HostClock. Runs on CoreMIDI's receive thread.
    typealias NoteHandler = (MidiNote, Double) -> Void
    /// The online sources after any change. Runs on the main thread.
    typealias SourcesHandler = ([MidiSourceInfo]) -> Void

    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var outPort = MIDIPortRef()
    private var connected = Set<MIDIEndpointRef>()
    private var listening = false
    private var refreshPending = false
    private var lastDestinations: [MidiSourceInfo] = []
    private let onSources: SourcesHandler
    private let onDestinations: SourcesHandler

    init(
        onNote: @escaping NoteHandler,
        onSources: @escaping SourcesHandler,
        onDestinations: @escaping SourcesHandler
    ) throws {
        assert(Thread.isMainThread, "MidiSession must be created on the main thread")
        self.onSources = onSources
        self.onDestinations = onDestinations

        var newClient = MIDIClientRef()
        let clientStatus = MIDIClientCreateWithBlock("OpenTiles" as CFString, &newClient) {
            [weak self] notification in
            switch notification.pointee.messageID {
            case .msgSetupChanged, .msgObjectAdded, .msgObjectRemoved, .msgPropertyChanged:
                DispatchQueue.main.async { self?.scheduleRefresh() }
            default:
                break
            }
        }
        guard clientStatus == noErr else {
            throw MidiSessionError.coreMidi("MIDIClientCreateWithBlock", clientStatus)
        }

        var newPort = MIDIPortRef()
        let portStatus = MIDIInputPortCreateWithProtocol(
            newClient, "OpenTiles input" as CFString, ._1_0, &newPort
        ) { eventList, _ in
            MidiSession.receive(eventList, onNote)
        }
        guard portStatus == noErr else {
            MIDIClientDispose(newClient)
            throw MidiSessionError.coreMidi("MIDIInputPortCreateWithProtocol", portStatus)
        }

        var newOutPort = MIDIPortRef()
        let outStatus = MIDIOutputPortCreate(newClient, "OpenTiles output" as CFString, &newOutPort)
        guard outStatus == noErr else {
            MIDIPortDispose(newPort)
            MIDIClientDispose(newClient)
            throw MidiSessionError.coreMidi("MIDIOutputPortCreate", outStatus)
        }

        client = newClient
        port = newPort
        outPort = newOutPort
        lastDestinations = destinations()
    }

    deinit {
        MIDIPortDispose(outPort)
        MIDIPortDispose(port)
        MIDIClientDispose(client)
    }

    // MARK: - Output (P6-12)

    func destinations() -> [MidiSourceInfo] {
        MidiSession.onlineDestinations().map { $0.info }
    }

    /// Sends MIDI 1.0 channel voice messages to the destination with `id`, each at its time in
    /// seconds on HostClock (nil or the past: now). Returns false when that destination is gone.
    /// CoreMIDI schedules stamped messages itself, so they leave on time whatever the web view does.
    func send(to id: Int32, messages: [(bytes: [Int], time: Double?)]) -> Bool {
        guard let endpoint = MidiSession.destination(id) else { return false }
        for message in messages {
            guard var word = UniversalPacket.midi1Word(message.bytes) else { continue }
            let stamp = message.time.map { HostClock.hostTime(fromSeconds: $0) } ?? 0
            var list = MIDIEventList()
            withUnsafeMutablePointer(to: &list) { listPointer in
                let packet = MIDIEventListInit(listPointer, ._1_0)
                _ = MIDIEventListAdd(
                    listPointer, MemoryLayout<MIDIEventList>.size, packet, stamp, 1, &word
                )
                _ = MIDISendEventList(outPort, endpoint, listPointer)
            }
        }
        return true
    }

    /// Drops every message still waiting to be sent to the destination (all of them when nil).
    func flush(_ id: Int32?) {
        if let id = id {
            if let endpoint = MidiSession.destination(id) {
                MIDIFlushOutput(endpoint)
            }
        } else {
            MIDIFlushOutput(0)
        }
    }

    private static func destination(_ id: Int32) -> MIDIEndpointRef? {
        onlineDestinations().first { $0.info.id == id }?.endpoint
    }

    /// Connects every online source now and every new one as it appears.
    func start() {
        listening = true
        refresh()
    }

    /// Disconnects every source. Setup changes are still reported.
    func stop() {
        listening = false
        for endpoint in connected {
            MIDIPortDisconnectSource(port, endpoint)
        }
        connected.removeAll()
    }

    func sources() -> [MidiSourceInfo] {
        MidiSession.onlineSources().map { $0.info }
    }

    // MARK: - Setup changes

    /// One device change produces several notifications; refresh once for all of them.
    private func scheduleRefresh() {
        guard !refreshPending else { return }
        refreshPending = true
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.refreshPending = false
            self.refresh()
        }
    }

    private func refresh() {
        let sources = MidiSession.onlineSources()
        if listening {
            let wanted = Set(sources.map { $0.endpoint })
            for endpoint in connected.subtracting(wanted) {
                MIDIPortDisconnectSource(port, endpoint)
                connected.remove(endpoint)
            }
            for endpoint in wanted.subtracting(connected) {
                if MIDIPortConnectSource(port, endpoint, nil) == noErr {
                    connected.insert(endpoint)
                }
            }
        }
        onSources(sources.map { $0.info })
        let destinations = self.destinations()
        if destinations != lastDestinations {
            lastDestinations = destinations
            onDestinations(destinations)
        }
    }

    private static func onlineSources() -> [(endpoint: MIDIEndpointRef, info: MidiSourceInfo)] {
        online(count: MIDIGetNumberOfSources(), at: MIDIGetSource)
    }

    private static func onlineDestinations() -> [(endpoint: MIDIEndpointRef, info: MidiSourceInfo)] {
        online(count: MIDIGetNumberOfDestinations(), at: MIDIGetDestination)
    }

    private static func online(
        count: Int, at endpointAt: (Int) -> MIDIEndpointRef
    ) -> [(endpoint: MIDIEndpointRef, info: MidiSourceInfo)] {
        var result: [(endpoint: MIDIEndpointRef, info: MidiSourceInfo)] = []
        for index in 0..<count {
            let endpoint = endpointAt(index)
            let offline = (integerProperty(endpoint, kMIDIPropertyOffline) ?? 0) != 0
            if endpoint == 0 || offline {
                continue
            }
            let info = MidiSourceInfo(
                id: integerProperty(endpoint, kMIDIPropertyUniqueID) ?? Int32(bitPattern: endpoint),
                name: displayName(of: endpoint)
            )
            result.append((endpoint: endpoint, info: info))
        }
        return result
    }

    private static func integerProperty(_ object: MIDIObjectRef, _ property: CFString) -> Int32? {
        var value: Int32 = 0
        return MIDIObjectGetIntegerProperty(object, property, &value) == noErr ? value : nil
    }

    private static func displayName(of endpoint: MIDIEndpointRef) -> String {
        var name: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &name) == noErr,
              let value = name?.takeRetainedValue()
        else {
            return "MIDI device"
        }
        return value as String
    }

    // MARK: - Receiving

    /// Byte offsets of MIDIEventList.packet and MIDIEventPacket.words. Both structs are packed to
    /// four bytes in MIDIServices.h, which gives 8 and 12.
    private static let firstPacketOffset =
        MemoryLayout<MIDIEventList>.offset(of: \MIDIEventList.packet) ?? 8
    private static let wordsOffset =
        MemoryLayout<MIDIEventPacket>.offset(of: \MIDIEventPacket.words) ?? 12

    /// Walks the packets the way MIDIEventPacketNext() does: a packet is a header followed by
    /// `wordCount` words, and the next packet starts straight after them. Reading through raw
    /// pointers avoids copying the fixed 64-word `words` tuple, which can run past the end of
    /// the list for short packets.
    private static func receive(_ list: UnsafePointer<MIDIEventList>, _ onNote: NoteHandler) {
        var packet = UnsafeRawPointer(list) + firstPacketOffset
        for _ in 0..<list.pointee.numPackets {
            let header = packet.assumingMemoryBound(to: MIDIEventPacket.self)
            let wordCount = Int(header.pointee.wordCount)
            let stamp = header.pointee.timeStamp
            // A zero timestamp means "now".
            let time = HostClock.seconds(fromHostTime: stamp != 0 ? stamp : mach_absolute_time())
            let words = UnsafeBufferPointer(
                start: (packet + wordsOffset).assumingMemoryBound(to: UInt32.self),
                count: min(wordCount, 64)
            )
            UniversalPacket.forEachNote(in: words) { note in
                onNote(note, time)
            }
            packet += wordsOffset + 4 * wordCount
        }
    }
}
