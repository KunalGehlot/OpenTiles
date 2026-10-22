import Capacitor
import UIKit
import WebKit

/// The app's one screen: Capacitor's web view, with the status bar following the page. The web app
/// has its own theme setting (light, dark or the system's), so the page's background colour is the
/// one place that knows which is showing. Without this the status bar kept dark text, and iPadOS 26
/// a pale blur strip, over the dark theme.
///
/// Only the status bar follows: overriding the interface style as well would also change the web
/// view's prefers-color-scheme, and a page that follows the system would then never leave the look
/// it started in.
class AppViewController: CAPBridgeViewController {
    private var backgroundObservation: NSKeyValueObservation?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // The page draws its own header under the status bar (env(safe-area-inset-top)), so the
        // system's blur strip there only adds a band in the wrong colour.
        if #available(iOS 26.0, *) {
            webView?.scrollView.topEdgeEffect.isHidden = true
        }
        // WebKit takes underPageBackgroundColor from the page's background (html and body use --bg).
        backgroundObservation = webView?.observe(\.underPageBackgroundColor, options: [.initial, .new]) {
            webView, _ in
            let dark = Self.isDark(webView.underPageBackgroundColor)
            DispatchQueue.main.async { [weak self] in
                self?.setStatusBarStyle(dark ? .lightContent : .darkContent)
            }
        }
    }

    private static func isDark(_ color: UIColor?) -> Bool {
        guard let color else { return false }
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
        guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return false }
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.5
    }
}
