// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ProjectHubShelf",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "ProjectHubShelf", targets: ["ProjectHubShelf"])],
    targets: [.executableTarget(name: "ProjectHubShelf")]
)
