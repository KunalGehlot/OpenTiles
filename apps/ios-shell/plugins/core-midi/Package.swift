// swift-tools-version: 5.9
import PackageDescription

// The package and product name must be what the Capacitor CLI derives from the npm name
// (@opentiles/capacitor-core-midi -> OpentilesCapacitorCoreMidi): `cap sync` writes exactly that
// into ios/App/CapApp-SPM/Package.swift.
let package = Package(
    name: "OpentilesCapacitorCoreMidi",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "OpentilesCapacitorCoreMidi",
            targets: ["CoreMidiPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CoreMidiPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CoreMidiPlugin",
            resources: [.copy("PrivacyInfo.xcprivacy")]),
        .testTarget(
            name: "CoreMidiPluginTests",
            dependencies: ["CoreMidiPlugin"],
            path: "ios/Tests/CoreMidiPluginTests")
    ]
)
