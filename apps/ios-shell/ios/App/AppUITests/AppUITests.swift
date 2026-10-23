import XCTest

/// Starts the app on a simulator and walks through the web app inside it (PLAN.md P3-10). The app
/// is the web build in a WKWebView, so these find the page's own headings, links and texts through
/// accessibility, the way VoiceOver does. A change that breaks the app's WebView (a script that
/// fails to load from capacitor://, a missing file, a blank page) fails here, in CI, instead of on
/// the maintainer's iPad.
final class AppUITests: XCTestCase {
    /// Generous: the first launch on a fresh CI simulator also compiles the WebAssembly engine and
    /// Verovio.
    private let timeout: TimeInterval = 60

    override func setUp() {
        continueAfterFailure = false
    }

    func testHomeOpensACataloguePieceInWaitMode() {
        let web = launch()
        let piece = link(in: web, containing: "Ode to Joy (theme)")
        tap(piece, in: web, until: text(in: web, containing: "Step 1/"))
        attachScreenshot(named: "Practice")
    }

    func testAChordDrillStartsFromTheDrillsPage() {
        let web = launch()
        let chords = link(in: web, containing: "Chords")
        let start = web.links["Start chords"].firstMatch
        tap(web.links["Drills"].firstMatch, in: web, until: chords)
        tap(chords, in: web, until: start)
        tap(start, in: web, until: text(in: web, containing: "Chord 1/"))
        attachScreenshot(named: "Chord drill")
    }

    // MARK: - Helpers

    /// Launches the app and waits for the Home page's heading.
    private func launch() -> XCUIElement {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: timeout), "No web view")
        expectText(in: web, containing: "Free piano practice")
        return web
    }

    /// A link whose text contains `label`: a card's link reads its title and the lines under it.
    private func link(in web: XCUIElement, containing label: String) -> XCUIElement {
        web.links.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
    }

    private func text(in web: XCUIElement, containing text: String) -> XCUIElement {
        web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// Waits for `element`, scrolls the page until it can be tapped (a card may start below the
    /// fold in portrait), taps it and waits for `next`, the sign that the tap was taken. WebKit
    /// takes a tap for a hover when the page changes under the finger, which a page still loading
    /// does (seen on CI's slower simulator: "Drills" lit up and nothing happened), so it taps again
    /// as a person would.
    private func tap(
        _ element: XCUIElement, in web: XCUIElement, until next: XCUIElement,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        guard element.waitForExistence(timeout: timeout) else {
            attachScreenshot(named: "Missing element")
            XCTFail("Not found: \(element)", file: file, line: line)
            return
        }
        for _ in 0..<6 where !element.isHittable {
            web.swipeUp()
        }
        for attempt in 1...3 {
            if attempt > 1 && !element.exists { break }
            element.tap()
            if next.waitForExistence(timeout: attempt < 3 ? 10 : timeout) { return }
        }
        attachScreenshot(named: "Tap not taken")
        XCTFail("Tapped \(element), but \(next) did not appear", file: file, line: line)
    }

    private func expectText(
        in web: XCUIElement, containing text: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        if !self.text(in: web, containing: text).waitForExistence(timeout: timeout) {
            attachScreenshot(named: "Missing text")
            XCTFail("No text containing “\(text)”", file: file, line: line)
        }
    }

    private func attachScreenshot(named name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
