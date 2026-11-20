import type { FoliumClientApi, FoliumDisposer, FoliumLabel, FoliumRegistryHandle } from '../types/folium';

// The notebook's self-contained tutorial uses Folium labels and synthetic anchors only.

declare const __MUSIC_NOTES_PONDER_TRADITIONAL__: Readonly<Record<string, string>>;
const chineseLabels = new Set<string>();

const label = (zhCN: string, en: string, indonesian: string, vi: string): FoliumLabel => {
    chineseLabels.add(zhCN);
    return {
        'zh-CN': zhCN,
        'zh-TW': typeof __MUSIC_NOTES_PONDER_TRADITIONAL__ === 'undefined'
            ? zhCN : __MUSIC_NOTES_PONDER_TRADITIONAL__[zhCN] ?? zhCN,
        en, in: indonesian, vi,
    };
};

const title = label('音乐笔记', 'Music notes', 'Catatan musik', 'Ghi chú âm nhạc');

const chapters = [
    {
        id: 'library', title: title, control: label('全部笔记', 'All notes', 'Semua catatan', 'Tất cả ghi chú'),
        rect: { left: 0.04, top: 0.2, width: 0.29, height: 0.68 },
        captions: [label('在正在播放的歌曲上写正文、加标签或记时刻，歌曲就会出现在列表里。编辑会自动保存。',
            'Write a note, add a tag or mark a moment to add the playing song to your list. Edits are saved automatically.',
            'Tulis catatan, tambahkan tag, atau tandai momen untuk menambahkan lagu ke daftar. Perubahan tersimpan otomatis.',
            'Viết ghi chú, thêm nhãn hoặc đánh dấu khoảnh khắc để thêm bài hát vào danh sách. Thay đổi được lưu tự động.')],
    },
    {
        id: 'moments', title: label('时刻', 'Moments', 'Momen', 'Khoảnh khắc'),
        control: label('记下这个时刻', 'Mark this moment', 'Tandai momen ini', 'Đánh dấu khoảnh khắc này'),
        rect: { left: 0.72, top: 0.19, width: 0.18, height: 0.14 },
        captions: [label('点歌曲播放按钮旁带时间的图钉，记下这个时刻。点已记录的时间可从那里播放。',
            'Use the pin next to the playback button to mark the time it shows. Select a saved time to play from there.',
            'Ketuk tombol pin di samping tombol pemutaran untuk menandai waktu yang ditampilkan. Pilih waktunya untuk memutar dari sana.',
            'Bấm nút ghim cạnh nút phát để đánh dấu thời gian đang hiển thị. Chọn mốc đã lưu để phát từ đó.')],
    },
    {
        id: 'backup', title: label('导入与备份', 'Import and backup', 'Impor dan cadangan', 'Nhập và sao lưu'),
        control: label('恢复备份（导入）', 'Restore backup (import)', 'Pulihkan cadangan (impor)', 'Khôi phục bản sao lưu (nhập)'),
        rect: { left: 0.8, top: 0.04, width: 0.15, height: 0.11 },
        captions: [label('用页头的按钮导入歌单或备份笔记。恢复备份时只会补入缺少的歌曲。',
            'Use the header buttons to import a playlist or back up your notes. Restoring a backup adds only missing songs.',
            'Gunakan tombol di bagian atas untuk mengimpor daftar putar atau mencadangkan catatan. Pemulihan hanya menambahkan lagu yang belum ada.',
            'Dùng các nút ở đầu trang để nhập danh sách phát hoặc sao lưu. Khôi phục chỉ thêm bài hát còn thiếu.')],
    },
];

export const musicNotesPonderTarget = {
    id: 'guide',
    titleKey: title,
    summaryKey: label(
        '收藏歌曲，整理标签，记下值得再听一次的理由。',
        'Keep songs, organize tags and remember why they deserve another listen.',
        'Simpan lagu, susun tag, dan ingat alasan untuk mendengarkannya lagi.',
        'Lưu bài hát, sắp xếp nhãn và ghi nhớ lý do để nghe lại.',
    ),
    category: 'browsing',
    hoverSelector: null,
    scenes: chapters.map(chapter => ({
        id: chapter.id,
        titleKey: chapter.title,
        anchors: {
            notebook: {
                kind: 'synthetic', role: 'surface', labelKey: title,
                rect: { left: 0.5, top: 0.12, width: 0.72, height: 0.56, anchorX: 'center' },
            },
            control: { kind: 'relative', from: 'notebook', role: 'control', labelKey: chapter.control, rect: chapter.rect },
        },
        steps: [
            { kind: 'highlight', id: 'show', anchor: 'control', intensity: [0, 0.4], durationMs: 450, keyframe: true },
            ...chapter.captions.map((textKey, index) => ({
                kind: 'caption', id: `explain${index}`, at: 'bottom', textKey,
                pointTo: { anchor: 'control', y: 0.5 }, durationMs: 6200, keyframe: true,
            })),
            { kind: 'pause', id: 'read' },
        ],
    })),
};

type PonderRegistry = { register: (target: typeof musicNotesPonderTarget) => FoliumRegistryHandle };

/** Build input for the same Simplified-to-Traditional conversion used by the host. */
export const ponderChineseLabels: readonly string[] = Object.freeze([...chineseLabels]);

export const registerMusicNotesPonder = (folium: FoliumClientApi): FoliumDisposer => {
    if (folium.env.context !== 'main') return () => {};
    const registry = folium.experimental['ponder.targets'];
    if (!registry || typeof registry !== 'object' || !('register' in registry) || typeof registry.register !== 'function') {
        throw new Error('[MusicNotes] Ponder tutorial registration is unavailable');
    }
    const handle = (registry as PonderRegistry).register(musicNotesPonderTarget);
    return () => handle.unregister();
};
