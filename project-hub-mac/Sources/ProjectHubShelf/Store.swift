import AppKit
import Foundation
import SwiftUI

// Read-only representation of Project Hub schema_version:1. Never give the
// desktop accessory an unreviewed write path into the website or its database.
struct HubRecord: Codable, Identifiable {
    var id: String
    var title: String
    var kind: String
    var body: String?
    var summary: String?
    var entry_url: String?
    var current_url: String?
    var status: String?
    var pinned: Bool?
    var starred: Bool?

    var isDraft: Bool { (status ?? "published") == "draft" }
    var isFavorite: Bool { pinned == true || starred == true }
}

struct HubBackup: Codable {
    let schema_version: Int
    let items: [HubRecord]
    var source_app: String?
    var exported_at: String?
}

struct LocalNote: Codable, Identifiable {
    var id: String = UUID().uuidString
    var text: String = ""
    var title: String {
        String(String(text.split(separator: "\n").first ?? "未命名灵感").prefix(40))
    }
}

struct TemporaryClip: Identifiable {
    let id = UUID()
    let text: String?
    let image: NSImage?
    let createdAt = Date()
}

enum ShelfSection: String, CaseIterable, Identifiable {
    case recent, favorites, prompts, projects, ideas
    var id: Self { self }
    var label: String {
        switch self {
        case .recent: return "临时"
        case .favorites: return "常用"
        case .prompts: return "提示词"
        case .projects: return "项目"
        case .ideas: return "灵感"
        }
    }
}

enum ShelfError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let detail): return detail }
    }
}

@MainActor
final class ShelfStore: ObservableObject {
    @Published var records: [HubRecord] = []
    @Published var clips: [TemporaryClip] = []
    @Published var notes: [LocalNote] = []
    @Published var section: ShelfSection = .favorites
    @Published var search = ""
    @Published var message = "⌃⌥V 随时呼出 · 正式词库以 Project Hub 为准"

    private let folder: URL
    private var recordsFile: URL { folder.appendingPathComponent("project-hub-backup.json") }
    private var notesFile: URL { folder.appendingPathComponent("ideas.json") }

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        folder = support.appendingPathComponent("ProjectHubShelf", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        if let data = try? Data(contentsOf: recordsFile),
           let backup = try? Self.decodeBackup(data) {
            records = backup.items
        }
        if let data = try? Data(contentsOf: notesFile),
           let saved = try? JSONDecoder().decode([LocalNote].self, from: data) {
            notes = saved
        }
    }

    private static func decodeBackup(_ data: Data) throws -> HubBackup {
        guard data.count < 15_000_000 else { throw ShelfError.invalid("文件超过 15MB，请分批导出") }
        let backup = try JSONDecoder().decode(HubBackup.self, from: data)
        guard backup.schema_version == 1 else { throw ShelfError.invalid("只支持 Project Hub schema_version:1") }
        guard backup.items.count <= 2_000 else { throw ShelfError.invalid("记录超过 2,000 条") }
        var ids = Set<String>()
        for record in backup.items {
            guard !record.id.isEmpty, record.id.count <= 128, ids.insert(record.id).inserted else {
                throw ShelfError.invalid("存在空白、过长或重复的记录 ID")
            }
            guard ["prompt", "project"].contains(record.kind),
                  ["draft", "published"].contains(record.status ?? "published"),
                  !record.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  record.title.count <= 160,
                  (record.body ?? "").count <= 100_000 else {
                throw ShelfError.invalid("记录字段或类型不符合 Project Hub 约定")
            }
            if record.kind == "project" {
                guard let link = record.entry_url, let url = URL(string: link),
                      ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
                      url.host != nil else {
                    throw ShelfError.invalid("项目入口地址无效")
                }
            }
        }
        return backup
    }

    func importBackup(from url: URL) throws {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let bytes = try Data(contentsOf: url)
        let backup = try Self.decodeBackup(bytes)
        // Replacement happens only after parsing and validating the *whole*
        // backup. A failed import leaves the previously saved cache unchanged.
        try bytes.write(to: recordsFile, options: .atomic)
        records = backup.items
        section = .favorites
        message = "已缓存 \(records.count) 条记录（只读快照，非云同步）"
    }

    var shownRecords: [HubRecord] {
        guard [.favorites, .prompts, .projects].contains(section) else { return [] }
        let filtered = records.filter { row in
            if row.isDraft { return false }
            switch section {
            case .favorites: return row.isFavorite
            case .prompts: return row.kind == "prompt"
            case .projects: return row.kind == "project"
            default: return false
            }
        }
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return filtered.filter {
            query.isEmpty || [$0.title, $0.summary ?? "", $0.body ?? ""]
                .contains(where: { $0.localizedStandardContains(query) })
        }.sorted {
            if $0.pinned != $1.pinned { return $0.pinned == true }
            if $0.starred != $1.starred { return $0.starred == true }
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
    }

    func captureClipboard() {
        // Opt-in only. Never run a background clipboard observer; passwords,
        // student information and unrelated copied text must not leak to cloud.
        let pasteboard = NSPasteboard.general
        if let image = pasteboard.readObjects(forClasses: [NSImage.self])?.first as? NSImage {
            clips.insert(TemporaryClip(text: nil, image: image), at: 0)
        } else if let text = pasteboard.string(forType: .string), !text.isEmpty {
            clips.insert(TemporaryClip(text: text, image: nil), at: 0)
        } else {
            message = "剪贴板没有可暂存的图片或文字"
            return
        }
        if clips.count > 30 { clips.removeLast(clips.count - 30) }
        section = .recent
        message = "已临时挂起；退出应用后不保留剪贴内容"
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        message = "已复制 · 请在目标窗口手动粘贴"
    }

    func copy(_ clip: TemporaryClip) {
        let board = NSPasteboard.general
        board.clearContents()
        if let image = clip.image { board.writeObjects([image]) }
        else if let text = clip.text { board.setString(text, forType: .string) }
        message = "已复制临时内容"
    }

    func copyRecord(_ record: HubRecord) {
        guard !record.isDraft else { return }
        if record.kind != "project" {
            copy(record.body ?? "")
            return
        }
        // Same distinction as Project Hub: default action is temporary
        // reference, NOT an instruction to take over the project's Current.
        let text = [
            "请临时参考项目「\(record.title)」处理我接下来提出的一次任务。",
            "项目入口：\(record.entry_url ?? "")",
            "只按需读取入口和本次任务必要的规范。默认不正式接手原 Worker，不推进其持续队列，不修改项目 Current 或控制状态。",
            "如任务需要保存成果，先核对原项目规则、当前状态及我已给出的授权。请先等待我说明具体任务。",
            (record.body ?? "").isEmpty ? "" : "调用补充说明：\(record.body ?? "")"
        ].filter { !$0.isEmpty }.joined(separator: "\n")
        copy(text)
    }

    func addNote() {
        let note = LocalNote()
        notes.insert(note, at: 0)
        saveNotes()
        section = .ideas
    }

    func noteText(id: String) -> String { notes.first(where: { $0.id == id })?.text ?? "" }

    func updateNote(id: String, text: String) {
        guard let i = notes.firstIndex(where: { $0.id == id }) else { return }
        notes[i].text = String(text.prefix(100_000))
        saveNotes()
    }

    func removeNote(id: String) {
        notes.removeAll { $0.id == id }
        saveNotes()
    }

    private func saveNotes() {
        do {
            let data = try JSONEncoder().encode(notes)
            try data.write(to: notesFile, options: .atomic)
        } catch {
            message = "灵感本地保存失败：\(error.localizedDescription)"
        }
    }

    func exportNotes(to url: URL) throws {
        guard !notes.isEmpty else { throw ShelfError.invalid("没有可导出的灵感") }
        let items = notes.map { note in
            HubRecord(
                id: note.id, title: note.title.isEmpty ? "未命名草稿" : note.title,
                kind: "prompt", body: note.text, summary: "",
                entry_url: "", current_url: "", status: "draft",
                pinned: false, starred: false
            )
        }
        let timestamp = ISO8601DateFormatter().string(from: Date())
        let backup = HubBackup(
            schema_version: 1, items: items,
            source_app: "project-hub-mac-shelf", exported_at: timestamp
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(backup).write(to: url, options: .atomic)
        message = "已导出 \(items.count) 条草稿，请到 Project Hub 网站人工预览并确认导入"
    }

    func clearClips() {
        clips = []
        message = "已清除本次临时挂架"
    }

    func openWebsite() {
        if let url = URL(string: "https://jamesboswell796-cyber.github.io/project-hub/") {
            NSWorkspace.shared.open(url)
        }
    }
}
