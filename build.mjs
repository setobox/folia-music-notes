import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import { zipSync } from 'fflate';
import { Converter } from 'opencc-js';
import { build } from 'vite';
import { musicNotesZhCN } from './src/locales.ts';
import { ponderChineseLabels } from './src/ponder.ts';

// Build the Folium client and include the licenses of the libraries shipped in its ZIP.
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist', 'music-notes');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'mod.json'), 'utf8'));
const traditional = Converter({ from: 'cn', to: 'tw' });
const traditionalPonder = Object.fromEntries(ponderChineseLabels.map(text => [text, traditional(text)]));
const result = await build({
    configFile: false,
    root,
    publicDir: false,
    resolve: {
        // Dexie's default entry rejects a different version already registered by Folia.
        alias: [{ find: /^dexie$/, replacement: fileURLToPath(import.meta.resolve('dexie/dist/dexie.mjs')) }],
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        __MUSIC_NOTES_TRADITIONAL__: traditional(JSON.stringify(musicNotesZhCN)),
        __MUSIC_NOTES_PONDER_TRADITIONAL__: JSON.stringify(traditionalPonder),
    },
    css: { postcss: { plugins: [tailwind()] } },
    build: {
        write: false,
        target: 'es2022',
        minify: true,
        lib: { entry: path.join(root, 'src/client.tsx'), formats: ['es'], fileName: () => manifest.client, cssFileName: 'music-notes' },
        rolldownOptions: {
            output: { codeSplitting: false },
            onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); },
        },
    },
});

const files = {};
const moduleIds = new Set([fileURLToPath(import.meta.resolve('tailwindcss/package.json'))]);
for (const item of Array.isArray(result) ? result : [result]) {
    for (const artifact of item.output) {
        if (artifact.type === 'chunk') {
            if (artifact.imports.length || artifact.dynamicImports.length) throw new Error('Folium requires a self-contained client.');
            for (const id of Object.keys(artifact.modules)) moduleIds.add(id);
            files[artifact.fileName] = Buffer.from(artifact.code);
        } else {
            files[artifact.fileName] = Buffer.from(artifact.source);
        }
    }
}

// Walk back from the actual bundled modules to their owning package metadata.
const packages = new Map();
for (const id of moduleIds) {
    let directory = path.dirname(id.split('?')[0]);
    while (directory.includes('node_modules')) {
        try {
            const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
            if (metadata.name) {
                packages.set(`${metadata.name}@${metadata.version}`, directory);
                break;
            }
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        }
        directory = path.dirname(directory);
    }
}
let notices = 'Music Notes includes Folia settings components under AGPL-3.0 (see LICENSE).\n';
for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const licenses = (await fs.readdir(directory)).filter(file => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(file)).sort();
    if (!licenses.length) throw new Error(`Missing license for ${name}`);
    notices += `\n${'='.repeat(72)}\n${name}\n`;
    for (const file of licenses) notices += `${await fs.readFile(path.join(directory, file), 'utf8')}\n`;
}
files['THIRD_PARTY_NOTICES.txt'] = Buffer.from(notices);
for (const name of ['mod.json', manifest.preview, 'README.md', 'LICENSE']) {
    files[name] = await fs.readFile(path.join(root, name));
}

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(output, name), bytes);
const release = path.join(root, 'release');
await fs.mkdir(release, { recursive: true });
const zipPath = path.join(release, `music-notes-${manifest.version}.zip`);
await fs.writeFile(zipPath, zipSync({ 'music-notes': files }, { level: 9, mtime: new Date(2000, 0, 1) }));
console.info(`[MusicNotes] Built ${output}\n[MusicNotes] ZIP ${zipPath}`);
