import Foundation

/// A note-on or note-off decoded from a MIDI 1.0 channel voice message.
struct MidiNote: Equatable {
    let isOn: Bool
    /// 0–15.
    let channel: UInt8
    /// 0–127.
    let pitch: UInt8
    /// 0–127. Always above 0 for a note-on.
    let velocity: UInt8
}

/// Decodes the Universal MIDI Packets (UMP) that CoreMIDI delivers in a MIDIEventList.
///
/// The input port asks for the MIDI 1.0 protocol, so CoreMIDI hands over every channel voice
/// message as a one-word type 2 packet, whatever the device sends: running status, interleaved
/// real-time bytes (clock, active sensing) and SysEx are already dealt with. Everything that is
/// not a note-on or note-off is skipped by its length.
enum UniversalPacket {
    /// Words in one packet, by message type (the top four bits of its first word).
    static func wordCount(ofType type: UInt32) -> Int {
        switch type {
        case 0x0, 0x1, 0x2, 0x6, 0x7:
            return 1
        case 0x3, 0x4, 0x8, 0x9, 0xA:
            return 2
        case 0xB, 0xC:
            return 3
        default:
            return 4
        }
    }

    /// Calls `body` with each note in a run of UMP words, in order. Allocates nothing, so it is
    /// safe on CoreMIDI's high-priority receive thread.
    static func forEachNote(in words: UnsafeBufferPointer<UInt32>, _ body: (MidiNote) -> Void) {
        var index = 0
        while index < words.count {
            let word = words[index]
            let type = word >> 28
            if type == 0x2, let note = note(fromMidi1Word: word) {
                body(note)
            }
            index += wordCount(ofType: type)
        }
    }

    /// A type 2 word holds type, group, status, channel (four bits each), then two 7-bit data
    /// bytes. A note-on with velocity 0 is a note-off (MIDI 1.0 specification).
    static func note(fromMidi1Word word: UInt32) -> MidiNote? {
        let status = (word >> 20) & 0xF
        let channel = UInt8((word >> 16) & 0xF)
        let pitch = UInt8((word >> 8) & 0x7F)
        let velocity = UInt8(word & 0x7F)
        switch status {
        case 0x9 where velocity > 0:
            return MidiNote(isOn: true, channel: channel, pitch: pitch, velocity: velocity)
        case 0x8, 0x9:
            return MidiNote(isOn: false, channel: channel, pitch: pitch, velocity: velocity)
        default:
            return nil
        }
    }

    /// A MIDI 1.0 channel voice message (note on and off, control change, …) as the one-word type
    /// 2 packet MIDISendEventList takes, on group 0; nil for anything else (P6-12).
    static func midi1Word(_ bytes: [Int]) -> UInt32? {
        guard let status = bytes.first, (0x80...0xEF).contains(status) else { return nil }
        let data1 = bytes.count > 1 ? UInt32(bytes[1] & 0x7F) : 0
        let data2 = bytes.count > 2 ? UInt32(bytes[2] & 0x7F) : 0
        return 0x2000_0000 | UInt32(status) << 16 | data1 << 8 | data2
    }
}

/// CoreMIDI timestamps are host time: mach_absolute_time() ticks since boot. The clock is
/// monotonic (it never jumps when the user changes the time), which is what measuring the gap
/// between a key press and its arrival in the web view needs. Apple counts mach_absolute_time()
/// as a "system boot time" API; PrivacyInfo.xcprivacy declares reason 35F9.1 for it.
enum HostClock {
    private static let secondsPerTick: Double = {
        var timebase = mach_timebase_info_data_t()
        guard mach_timebase_info(&timebase) == KERN_SUCCESS, timebase.denom != 0 else {
            return 1e-9
        }
        return Double(timebase.numer) / Double(timebase.denom) / 1_000_000_000
    }()

    static func seconds(fromHostTime hostTime: UInt64) -> Double {
        Double(hostTime) * secondsPerTick
    }

    static func now() -> Double {
        seconds(fromHostTime: mach_absolute_time())
    }

    /// Host time for a time in seconds on this clock; 0 ("now") for a time not after the present.
    static func hostTime(fromSeconds seconds: Double) -> UInt64 {
        guard seconds.isFinite, seconds > now() else { return 0 }
        return UInt64(seconds / secondsPerTick)
    }
}
