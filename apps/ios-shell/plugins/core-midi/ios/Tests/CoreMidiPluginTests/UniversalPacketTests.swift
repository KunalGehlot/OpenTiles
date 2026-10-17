import XCTest
@testable import CoreMidiPlugin

final class UniversalPacketTests: XCTestCase {
    private func notes(_ words: [UInt32]) -> [MidiNote] {
        var notes: [MidiNote] = []
        words.withUnsafeBufferPointer { buffer in
            UniversalPacket.forEachNote(in: buffer) { notes.append($0) }
        }
        return notes
    }

    func testNoteOn() {
        // Type 2, group 0, note-on (0x9) on channel 0: C4 (60) at velocity 100.
        XCTAssertEqual(
            notes([0x2090_3C64]),
            [MidiNote(isOn: true, channel: 0, pitch: 60, velocity: 100)]
        )
    }

    func testNoteOff() {
        XCTAssertEqual(
            notes([0x2085_3C40]),
            [MidiNote(isOn: false, channel: 5, pitch: 60, velocity: 64)]
        )
    }

    func testNoteOnWithVelocityZeroIsNoteOff() {
        XCTAssertEqual(
            notes([0x2093_4000]),
            [MidiNote(isOn: false, channel: 3, pitch: 64, velocity: 0)]
        )
    }

    func testSkipsOtherMessagesByTheirLength() {
        // The payload words of the longer packets look like note-ons; a parser that lost its
        // place would report them.
        let words: [UInt32] = [
            0x20B0_4000, // control change, one word
            0x3016_7E7F, 0x2090_3C64, // SysEx 7, two words
            0xF000_0000, 0x2090_3C64, 0x2090_3C64, 0x2090_3C64, // stream message, four words
            0x10F8_0000, // timing clock, one word
            0x2091_4850 // note-on, channel 1, pitch 72, velocity 80
        ]
        XCTAssertEqual(notes(words), [MidiNote(isOn: true, channel: 1, pitch: 72, velocity: 80)])
    }

    func testKeepsOrderWithinAPacket() {
        XCTAssertEqual(
            notes([0x2090_3C64, 0x2080_3C00, 0x2090_4050]).map { $0.isOn },
            [true, false, true]
        )
    }

    func testWordCounts() {
        XCTAssertEqual(UniversalPacket.wordCount(ofType: 0x2), 1)
        XCTAssertEqual(UniversalPacket.wordCount(ofType: 0x4), 2)
        XCTAssertEqual(UniversalPacket.wordCount(ofType: 0xB), 3)
        XCTAssertEqual(UniversalPacket.wordCount(ofType: 0x5), 4)
        XCTAssertEqual(UniversalPacket.wordCount(ofType: 0xF), 4)
    }

    func testHostClockIsInSecondsAndMonotonic() {
        XCTAssertEqual(HostClock.seconds(fromHostTime: 0), 0)
        let first = HostClock.now()
        let second = HostClock.now()
        XCTAssertGreaterThan(first, 0)
        XCTAssertGreaterThanOrEqual(second, first)
    }
}

final class OutgoingPacketTests: XCTestCase {
    func testChannelVoiceMessagesBecomeType2Words() {
        // Note-on C4 velocity 100 on channel 0, the same word the parser reads back.
        XCTAssertEqual(UniversalPacket.midi1Word([0x90, 60, 100]), 0x2090_3C64)
        XCTAssertEqual(UniversalPacket.midi1Word([0xB0, 64, 127]), 0x20B0_407F)
        // Program change has one data byte.
        XCTAssertEqual(UniversalPacket.midi1Word([0xC2, 5]), 0x20C2_0500)
        var parsed: [MidiNote] = []
        [UInt32(0x2090_3C64)].withUnsafeBufferPointer { buffer in
            UniversalPacket.forEachNote(in: buffer) { parsed.append($0) }
        }
        XCTAssertEqual(parsed, [MidiNote(isOn: true, channel: 0, pitch: 60, velocity: 100)])
    }

    func testOnlyChannelVoiceMessagesAreSent() {
        XCTAssertNil(UniversalPacket.midi1Word([0xF0, 1, 2]))
        XCTAssertNil(UniversalPacket.midi1Word([0x40]))
        XCTAssertNil(UniversalPacket.midi1Word([]))
    }

    func testHostTimeRoundTripsAndThePastIsNow() {
        let later = HostClock.now() + 0.25
        let ticks = HostClock.hostTime(fromSeconds: later)
        XCTAssertEqual(HostClock.seconds(fromHostTime: ticks), later, accuracy: 1e-6)
        XCTAssertEqual(HostClock.hostTime(fromSeconds: HostClock.now() - 1), 0)
    }
}
