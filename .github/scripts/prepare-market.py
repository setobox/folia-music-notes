"""Prepare the installable Release asset for Folium's music-notes/ directory."""

import json
import re
import stat
import sys
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from PIL import Image, ImageOps


MAX_PREVIEW = 1024 * 1024


def market_preview(name, content):
    formats = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
    expected = formats.get(Path(name).suffix.lower())
    with Image.open(BytesIO(content)) as source:
        if source.format != expected:
            raise ValueError(f"Unexpected image format in {name}")
        width, height = source.size
        if width >= 640 and height >= 360 and 1.5 <= width / height <= 2 and len(content) <= MAX_PREVIEW:
            source.verify()
            return content
        # Keep the title and the playback bar visible when the screenshot is tall.
        rgb = ImageOps.exif_transpose(source).convert("RGB")
        fitted = ImageOps.pad(rgb, (1280, 720), Image.Resampling.LANCZOS, color=rgb.getpixel((0, 0)))
        output = BytesIO()
        fitted.save(output, expected)
        if expected == "PNG" and output.tell() > MAX_PREVIEW:
            output = BytesIO()
            fitted.quantize(colors=256).save(output, "PNG")
        if output.tell() > MAX_PREVIEW:
            raise ValueError(f"Market preview exceeds 1 MiB: {name}")
        print(f"Prepared market preview: {width}x{height} -> 1280x720")
        return output.getvalue()


def prepare(tag, archive, destination):
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise ValueError(f"Expected a version tag, got {tag!r}")
    files = {}
    total_size = 0
    with ZipFile(archive) as package:
        for entry in package.infolist():
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if entry.filename == "music-notes/" and kind in (0, stat.S_IFDIR):
                continue
            # build.mjs emits regular files directly under music-notes/, including the bundled client.
            path = re.fullmatch(r"music-notes/([A-Za-z0-9_-][A-Za-z0-9_.-]*)", entry.filename)
            if not path or kind not in (0, stat.S_IFREG):
                raise ValueError(f"Unexpected release entry: {entry.filename!r}")
            name = path.group(1)
            if name in files or name == "folium.sig.json":
                raise ValueError(f"Duplicate or signed release entry: {name}")
            total_size += entry.file_size
            if len(files) >= 300 or total_size > 16 * 1024 * 1024:
                raise ValueError("Release exceeds Folium's package limits")
            files[name] = package.read(entry)

    manifest = json.loads(files["mod.json"])
    if manifest.get("id") != "music-notes" or manifest.get("version") != tag[1:]:
        raise ValueError(f"Expected music-notes {tag} in mod.json")
    preview = manifest["preview"]
    for name in (manifest["client"], preview, "LICENSE", "THIRD_PARTY_NOTICES.txt"):
        if not files.get(name):
            raise ValueError(f"Missing or empty release file: {name}")
    files[preview] = market_preview(preview, files[preview])
    if sum(map(len, files.values())) > 16 * 1024 * 1024:
        raise ValueError("Prepared package exceeds 16 MiB")

    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError(f"Expected an empty directory: {destination}")
    for name, content in files.items():
        (destination / name).write_bytes(content)


if __name__ == "__main__":
    tag, archive, destination = sys.argv[1:]
    prepare(tag, Path(archive), Path(destination))
