import AppKit
import Carbon
import SwiftUI

@main
struct ProjectHubShelfApp: App {
    @NSApplicationDelegateAdaptor(ShelfAppDelegate.self) private var delegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

final class ShelfPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class ShelfAppDelegate: NSObject, NSApplicationDelegate {
    static var current: ShelfAppDelegate?
    private let store = ShelfStore()
    private var panel: ShelfPanel?
    private var item: NSStatusItem?
    private var hotKey: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Self.current = self
        NSApp.setActivationPolicy(.accessory)
        makePanel()
        makeMenu()
        registerShortcut()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let hotKeyHandler { RemoveEventHandler(hotKeyHandler) }
    }

    private func makePanel() {
        let window = ShelfPanel(
            contentRect: NSRect(x: 0, y: 0, width: 930, height: 490),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.level = .floating
        // This is intentionally macOS-only. A separate Space, including an
        // ordinary Chrome native full-screen Space, can host this accessory.
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.hidesOnDeactivate = false
        window.contentView = NSHostingView(rootView: ShelfView(
            store: store,
            onClose: { [weak self] in self?.hide() },
            onImport: { [weak self] in self?.importBackup() },
            onExport: { [weak self] in self?.exportNotes() }
        ))
        panel = window
    }

    private func makeMenu() {
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.image = NSImage(systemSymbolName: "paperclip", accessibilityDescription: "Project Hub Shelf")
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "显示 / 隐藏挂架  ⌃⌥V", action: #selector(toggleFromMenu), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "导入 Project Hub JSON 备份…", action: #selector(importFromMenu), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "导出灵感到 Project Hub JSON…", action: #selector(exportFromMenu), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "打开 Project Hub 网页", action: #selector(openHub), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: ""))
        for entry in menu.items { entry.target = self }
        status.menu = menu
        item = status
    }

    private func registerShortcut() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let callback: EventHandlerUPP = { _, _, _ in
            DispatchQueue.main.async { ShelfAppDelegate.current?.toggle() }
            return noErr
        }
        InstallEventHandler(GetApplicationEventTarget(), callback, 1, &eventType, nil, &hotKeyHandler)
        var identifier = EventHotKeyID(signature: OSType(0x50485346), id: 1) // PHSF
        RegisterEventHotKey(
            UInt32(kVK_ANSI_V), UInt32(controlKey) | UInt32(optionKey),
            identifier, GetApplicationEventTarget(), 0, &hotKey
        )
    }

    @objc private func toggleFromMenu() { toggle() }
    @objc private func importFromMenu() { importBackup() }
    @objc private func exportFromMenu() { exportNotes() }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func openHub() {
        if let url = URL(string: "https://jamesboswell796-cyber.github.io/project-hub/") {
            NSWorkspace.shared.open(url)
        }
    }

    func toggle() {
        guard let panel else { return }
        if panel.isVisible { hide(); return }
        let cursor = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(cursor) } ?? NSScreen.main
        let bounds = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1100, height: 800)
        let width = min(CGFloat(930), max(390, bounds.width - 28))
        let height = min(CGFloat(490), max(320, bounds.height - 28))
        let frame = NSRect(
            x: bounds.midX - width / 2,
            y: bounds.maxY - height - 12,
            width: width, height: height
        )
        panel.setFrame(frame, display: true)
        panel.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }

    private func importBackup() {
        let picker = NSOpenPanel()
        picker.allowedContentTypes = [.json]
        picker.allowsMultipleSelection = false
        picker.canChooseDirectories = false
        picker.message = "选择 Project Hub 导出的 JSON 备份。只在本机缓存，不上传。"
        picker.begin { [weak self] response in
            guard response == .OK, let url = picker.url else { return }
            DispatchQueue.main.async {
                do { try self?.store.importBackup(from: url) }
                catch { self?.store.message = "导入失败：\(error.localizedDescription)" }
                self?.panel?.orderFrontRegardless()
            }
        }
    }

    private func exportNotes() {
        let picker = NSSavePanel()
        picker.allowedContentTypes = [.json]
        picker.nameFieldStringValue = "project-hub-mac-drafts.json"
        picker.message = "这是供 Project Hub 网页手动导入的草稿备份，不会自动写入网站。"
        picker.begin { [weak self] response in
            guard response == .OK, let url = picker.url else { return }
            DispatchQueue.main.async {
                do { try self?.store.exportNotes(to: url) }
                catch { self?.store.message = "导出失败：\(error.localizedDescription)" }
                self?.panel?.orderFrontRegardless()
            }
        }
    }
}
