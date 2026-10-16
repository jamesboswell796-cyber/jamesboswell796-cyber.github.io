import SwiftUI

struct ShelfView: View {
    @ObservedObject var store: ShelfStore
    let onClose: () -> Void
    let onImport: () -> Void
    let onExport: () -> Void
    @State private var editingNoteID: String?

    private let ink = Color(red: 0.19, green: 0.20, blue: 0.27)
    private let backgrounds: [Color] = [
        Color(red: 0.80, green: 0.93, blue: 0.88),
        Color(red: 0.96, green: 0.83, blue: 0.83),
        Color(red: 0.98, green: 0.91, blue: 0.68),
        Color(red: 0.84, green: 0.88, blue: 0.98)
    ]

    var body: some View {
        VStack(spacing: 0) {
            topBar
            HStack(spacing: 8) {
                ForEach(ShelfSection.allCases) { section in
                    Button {
                        editingNoteID = nil
                        store.section = section
                    } label: {
                        Text(section.label)
                            .font(.system(size: 12, weight: .semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(store.section == section ?
                                Color(red: 0.81, green: 0.75, blue: 0.98) : Color.white.opacity(0.60),
                                in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                TextField("搜索已导入的提示词…", text: $store.search)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 230)
                    .accessibilityLabel("搜索提示词")
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 12)

            ropeView
                .frame(height: 25)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 15) {
                    switch store.section {
                    case .recent:
                        ForEach(store.clips) { clip in
                            clipCard(clip)
                        }
                        if store.clips.isEmpty { emptyCard("暂时没有内容", "点击「挂上剪贴板」手动添加") }
                    case .ideas:
                        ForEach(store.notes) { note in
                            noteCard(note)
                        }
                        if store.notes.isEmpty { emptyCard("还没有灵感", "点击「新建灵感」写下一句话") }
                    default:
                        ForEach(Array(store.shownRecords.enumerated()), id: \.element.id) { index, record in
                            recordCard(record, color: backgrounds[index % backgrounds.count])
                        }
                        if store.shownRecords.isEmpty {
                            emptyCard("没有匹配的卡片", "从 Project Hub 导入 JSON 备份后查看")
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 2)
                .padding(.bottom, 12)
            }
            .frame(height: editingNoteID == nil ? 210 : 148)

            if let editingNoteID, store.notes.contains(where: { $0.id == editingNoteID }) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("编辑本地灵感").font(.system(size: 12, weight: .semibold))
                        Spacer()
                        Button("收起编辑") { self.editingNoteID = nil }
                            .font(.system(size: 11))
                    }
                    TextEditor(text: Binding(
                        get: { store.noteText(id: editingNoteID) },
                        set: { store.updateNote(id: editingNoteID, text: $0) }
                    ))
                    .font(.system(size: 13))
                    .frame(height: 82)
                    .scrollContentBackground(.hidden)
                    .padding(5)
                    .background(.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
                }
                .padding(.horizontal, 24)
            }
            Spacer(minLength: 4)
            Divider().opacity(0.4)
            bottomBar
        }
        .foregroundStyle(ink)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 19)
                .fill(Color(red: 0.94, green: 0.91, blue: 0.99).opacity(0.98))
                .overlay(RoundedRectangle(cornerRadius: 19)
                    .stroke(Color.white.opacity(0.85), lineWidth: 1))
        )
        .clipShape(RoundedRectangle(cornerRadius: 19))
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "paperclip")
                .font(.system(size: 23, weight: .medium))
                .foregroundStyle(Color(red: 0.57, green: 0.38, blue: 0.69))
            VStack(alignment: .leading, spacing: 2) {
                Text("Project Hub").font(.system(size: 17, weight: .bold))
                Text("ClipLine 风格挂架 · Mac 原生预览")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("导入词库") { onImport() }
                .buttonStyle(.bordered)
            Button("打开网页") { store.openWebsite() }
                .buttonStyle(.bordered)
            Button { onClose() } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("关闭挂架")
        }
        .padding(.horizontal, 22)
        .padding(.top, 19)
        .padding(.bottom, 5)
    }

    private var ropeView: some View {
        GeometryReader { geometry in
            Path { path in
                path.move(to: CGPoint(x: 10, y: 5))
                path.addQuadCurve(
                    to: CGPoint(x: geometry.size.width - 10, y: 5),
                    control: CGPoint(x: geometry.size.width / 2, y: 40)
                )
            }
            .stroke(Color(red: 0.72, green: 0.56, blue: 0.40), lineWidth: 2)
        }
    }

    private func peg() -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color(red: 0.79, green: 0.67, blue: 0.54))
            .frame(width: 14, height: 25)
            .rotationEffect(.degrees(3))
            .shadow(color: .black.opacity(0.14), radius: 2, y: 2)
            .offset(y: -10)
    }

    private func recordCard(_ record: HubRecord, color: Color) -> some View {
        VStack(spacing: -13) {
            peg().zIndex(1)
            Button {
                store.copyRecord(record)
            } label: {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Image(systemName: record.kind == "project" ? "folder" : "text.alignleft")
                        Spacer()
                        if record.isFavorite { Image(systemName: "pin.fill") }
                    }
                    .font(.system(size: 12))
                    Text(record.title).font(.system(size: 14, weight: .bold)).lineLimit(2)
                    Text(record.summary?.isEmpty == false ? record.summary! : (record.body ?? ""))
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(4)
                    Spacer()
                    Text("点击复制 · \(record.kind == "project" ? "临时调用" : "提示词")")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .padding(13)
                .frame(width: 190, height: 174, alignment: .topLeading)
                .background(color, in: RoundedRectangle(cornerRadius: 11))
                .overlay(RoundedRectangle(cornerRadius: 11)
                    .stroke(Color.white.opacity(0.85), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .help("从 Project Hub JSON 只读缓存。点击只复制，不自动发送或修改原项目。")
        }
    }

    private func clipCard(_ clip: TemporaryClip) -> some View {
        VStack(spacing: -13) {
            peg().zIndex(1)
            Button { store.copy(clip) } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: clip.image == nil ? "doc.text" : "photo")
                        Text("临时剪贴板")
                        Spacer()
                    }
                    .font(.system(size: 11, weight: .semibold))
                    if let image = clip.image {
                        Image(nsImage: image).resizable().scaledToFit()
                            .frame(width: 161, height: 118)
                    } else {
                        Text(clip.text ?? "").font(.system(size: 12)).lineLimit(6)
                        Spacer()
                    }
                }
                .padding(12)
                .frame(width: 190, height: 174, alignment: .topLeading)
                .background(Color(red: 0.87, green: 0.93, blue: 0.98),
                            in: RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(.plain)
            .help("点击复制回剪贴板；此内容不会上传或持久保存")
        }
    }

    private func noteCard(_ note: LocalNote) -> some View {
        VStack(spacing: -13) {
            peg().zIndex(1)
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Image(systemName: "lightbulb")
                    Text("灵感")
                    Spacer()
                    Button {
                        store.removeNote(id: note.id)
                        if editingNoteID == note.id { editingNoteID = nil }
                    } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain)
                        .help("删除本地灵感")
                }
                .font(.system(size: 11))
                Text(note.text.isEmpty ? "点击编辑，写下想法…" : note.text)
                    .font(.system(size: 12))
                    .lineLimit(5)
                Spacer(minLength: 0)
                HStack {
                    Button("编辑") { editingNoteID = note.id }
                    Spacer()
                    Button("复制") { store.copy(note.text) }
                        .disabled(note.text.isEmpty)
                }
                .font(.system(size: 11, weight: .medium))
                .buttonStyle(.borderless)
            }
            .padding(12)
            .frame(width: 190, height: 174, alignment: .topLeading)
            .background(Color(red: 0.99, green: 0.94, blue: 0.72),
                        in: RoundedRectangle(cornerRadius: 11))
        }
    }

    private func emptyCard(_ title: String, _ subtitle: String) -> some View {
        VStack(spacing: 9) {
            Image(systemName: "tray").font(.system(size: 25))
            Text(title).font(.system(size: 14, weight: .semibold))
            Text(subtitle).font(.system(size: 12)).multilineTextAlignment(.center)
        }
        .foregroundStyle(.secondary)
        .frame(width: 230, height: 173)
        .background(Color.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 12))
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            Button {
                store.captureClipboard()
                editingNoteID = nil
            } label: { Label("挂上剪贴板", systemImage: "doc.on.clipboard") }
            Button {
                store.addNote()
                editingNoteID = store.notes.first?.id
            } label: { Label("新建灵感", systemImage: "plus") }
            Button("导出灵感") { onExport() }
                .disabled(store.notes.isEmpty)
            if store.section == .recent && !store.clips.isEmpty {
                Button("清空临时") { store.clearClips() }
            }
            Spacer(minLength: 8)
        }
        .buttonStyle(.bordered)
        .font(.system(size: 12))
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .overlay(alignment: .bottomLeading) {
            Text(store.message)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.horizontal, 22)
                .offset(y: 24)
        }
        .padding(.bottom, 35)
    }
}
