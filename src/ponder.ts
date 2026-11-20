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
        id: 'library',
        title: label('私人收藏', 'Private collection', 'Koleksi pribadi', 'Bộ sưu tập riêng'),
        control: label('歌曲列表', 'Songs', 'Daftar lagu', 'Danh sách bài hát'),
        rect: { left: 0.04, top: 0.2, width: 0.29, height: 0.68 },
        captions: [
            label(
                '从首页的音乐笔记页签进入。收下正在播放的歌曲，或从歌单导入，再选一首歌写笔记。',
                'Open Music notes from the home tabs. Add the playing song or import a playlist, then select a song to write about.',
                'Buka Catatan musik dari tab beranda. Tambahkan lagu yang diputar atau impor daftar putar, lalu pilih lagu untuk dicatat.',
                'Mở Ghi chú âm nhạc từ các thẻ trang chủ. Thêm bài đang phát hoặc nhập danh sách phát, rồi chọn bài để ghi chú.',
            ),
            label(
                '这里的收藏、标签和备注保存在本机，不会修改音乐平台上的收藏。',
                'This collection, its tags and its notes stay on this device. They do not change your music service favorites.',
                'Koleksi, tag, dan catatan ini tersimpan di perangkat ini. Favorit di layanan musik tidak berubah.',
                'Bộ sưu tập, nhãn và ghi chú được lưu trên thiết bị này. Mục yêu thích trên dịch vụ âm nhạc không thay đổi.',
            ),
        ],
    },
    {
        id: 'import',
        title: label('导入歌单', 'Import playlists', 'Impor daftar putar', 'Nhập danh sách phát'),
        control: label('歌单导入', 'Playlist import', 'Impor daftar putar', 'Nhập danh sách phát'),
        rect: { left: 0.04, top: 0.05, width: 0.4, height: 0.11 },
        captions: [
            label(
                '先在 Folia 登录网易云音乐或 QQ 音乐，再打开导入页，选择账号和自己的歌单。',
                'Sign in to NetEase Cloud Music or QQ Music through Folia, then open Import and choose your account and playlist.',
                'Masuk ke NetEase Cloud Music atau QQ Music melalui Folia, lalu buka Impor dan pilih akun serta daftar putar Anda.',
                'Đăng nhập NetEase Cloud Music hoặc QQ Music qua Folia, rồi mở Nhập và chọn tài khoản cùng danh sách phát của bạn.',
            ),
            label(
                '导入只补充歌曲。重复导入会保留已有标签和备注，也不会改动平台上的歌单。',
                'Importing adds songs. Importing again keeps existing tags and notes and leaves the original playlist unchanged.',
                'Impor menambahkan lagu. Mengimpor ulang mempertahankan tag dan catatan yang ada tanpa mengubah daftar putar asli.',
                'Thao tác nhập bổ sung bài hát. Nhập lại vẫn giữ nhãn và ghi chú hiện có, không thay đổi danh sách phát gốc.',
            ),
        ],
    },
    {
        id: 'tags',
        title: label('标签与搜索', 'Tags and search', 'Tag dan pencarian', 'Nhãn và tìm kiếm'),
        control: label('标签', 'Tags', 'Tag', 'Nhãn'),
        rect: { left: 0.38, top: 0.18, width: 0.55, height: 0.13 },
        captions: [
            label(
                '按心情、场景或收藏理由给歌曲加标签。用逗号分隔多个标签，再保存。',
                'Tag songs by mood, occasion or why you kept them. Separate multiple tags with commas, then save.',
                'Beri tag menurut suasana hati, kegiatan, atau alasan menyimpan lagu. Pisahkan beberapa tag dengan koma, lalu simpan.',
                'Gắn nhãn theo tâm trạng, hoàn cảnh hoặc lý do bạn lưu bài hát. Phân cách các nhãn bằng dấu phẩy, rồi lưu.',
            ),
            label(
                '用标签筛选收藏，或搜索歌名、歌手、专辑和备注，找回当时的线索。',
                'Filter by a tag, or search titles, artists, albums and notes to find what you remember.',
                'Saring menurut tag, atau cari judul, artis, album, dan catatan untuk menemukan petunjuk yang Anda ingat.',
                'Lọc theo nhãn hoặc tìm tên bài, nghệ sĩ, album và ghi chú để tìm lại điều bạn nhớ.',
            ),
        ],
    },
    {
        id: 'notes',
        title: label('写私人备注', 'Write private notes', 'Tulis catatan pribadi', 'Viết ghi chú riêng'),
        control: label('备注', 'Note', 'Catatan', 'Ghi chú'),
        rect: { left: 0.38, top: 0.36, width: 0.55, height: 0.3 },
        captions: [
            label(
                '选中一首歌，记下为什么收藏、第一次听到的场景，或想留住的一句歌词。',
                'Select a song and write why you saved it, where you first heard it, or a lyric you want to remember.',
                'Pilih lagu dan catat alasan menyimpannya, tempat pertama kali mendengarnya, atau lirik yang ingin diingat.',
                'Chọn một bài rồi ghi lý do bạn lưu, nơi lần đầu nghe bài đó hoặc câu hát bạn muốn nhớ.',
            ),
            label(
                '编辑中的内容是草稿。写完后保存；切换歌曲或离开页面前，先处理尚未保存的修改。',
                'Edits are drafts until you save. Save when finished, and resolve unsaved changes before switching songs or leaving the page.',
                'Perubahan masih berupa draf sampai disimpan. Simpan setelah selesai, dan tangani perubahan yang belum disimpan sebelum beralih lagu atau keluar.',
                'Nội dung chỉnh sửa là bản nháp cho đến khi lưu. Hãy lưu khi viết xong và xử lý thay đổi chưa lưu trước khi đổi bài hoặc rời trang.',
            ),
        ],
    },
    {
        id: 'moments',
        title: label('记下时间点', 'Remember a moment', 'Tandai momen', 'Ghi lại một khoảnh khắc'),
        control: label('时间点', 'Moments', 'Momen', 'Mốc thời gian'),
        rect: { left: 0.38, top: 0.72, width: 0.55, height: 0.17 },
        captions: [
            label(
                '收藏的正是当前播放的这首歌时，可以记下播放位置，给喜欢的片段留一句话。',
                'When the selected song is the one playing, capture its position and add a note about that passage.',
                'Saat lagu yang dipilih sedang diputar, catat posisinya dan tambahkan keterangan tentang bagian itu.',
                'Khi bài đã chọn chính là bài đang phát, hãy ghi lại vị trí phát và thêm ghi chú cho đoạn đó.',
            ),
            label(
                '只有正在播放同一首歌时，时间点才能跳转。换到另一首歌后，不会把播放进度跳到错误的位置。',
                'A saved moment can seek only while the same song is playing. Switching songs will not send the new track to the wrong position.',
                'Momen tersimpan hanya dapat dituju saat lagu yang sama diputar. Berganti lagu tidak akan memindahkan posisi lagu baru secara keliru.',
                'Chỉ có thể chuyển đến mốc đã lưu khi đang phát cùng bài hát. Đổi bài sẽ không làm bài mới nhảy đến vị trí sai.',
            ),
        ],
    },
    {
        id: 'backup',
        title: label('备份与恢复', 'Backup and restore', 'Cadangkan dan pulihkan', 'Sao lưu và khôi phục'),
        control: label('备份', 'Backup', 'Cadangan', 'Bản sao lưu'),
        rect: { left: 0.67, top: 0.05, width: 0.26, height: 0.11 },
        captions: [
            label(
                '导出备份会保存收藏、标签、备注和时间点。把备份文件留在安全的地方，换设备时再导入。',
                'Export a backup of your collection, tags, notes and moments. Keep the file somewhere safe and import it when moving to another device.',
                'Ekspor cadangan koleksi, tag, catatan, dan momen. Simpan berkas di tempat aman dan impor saat pindah perangkat.',
                'Xuất bản sao lưu gồm bộ sưu tập, nhãn, ghi chú và mốc thời gian. Giữ tệp ở nơi an toàn rồi nhập khi chuyển thiết bị.',
            ),
            label(
                '恢复采用合并方式：保留本机已有的记录，补充备份中尚未保存的歌曲。不会用旧备份覆盖现在的笔记。',
                'Restore merges records: existing local entries win, and missing songs are added from the backup. An older backup will not overwrite your current notes.',
                'Pemulihan menggabungkan data: entri lokal dipertahankan dan lagu yang belum ada ditambahkan. Cadangan lama tidak menimpa catatan saat ini.',
                'Khôi phục hợp nhất dữ liệu: giữ bản ghi hiện có trên máy và thêm bài còn thiếu từ bản sao lưu. Bản sao cũ không ghi đè ghi chú hiện tại.',
            ),
        ],
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
