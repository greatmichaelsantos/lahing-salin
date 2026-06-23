"""
compress_photos.py
Compresses all images (JPG, JPEG, PNG) under public/assets/ in-place using Pillow.
PNGs are converted to JPEG unless they have transparency (kept as PNG).
Run: python compress_photos.py

Requires Pillow:  pip install Pillow
"""

from pathlib import Path
from PIL import Image

ASSETS_DIR = Path(__file__).parent / "public" / "assets"
QUALITY    = 75     # JPEG quality (75 = good balance of size vs clarity)
MAX_WIDTH  = 1920   # downscale if wider than this (preserves aspect ratio)
MAX_HEIGHT = 1080   # downscale if taller than this


def compress_image(path: Path) -> Path:
    """Compress a single image. Returns the (possibly renamed) output path."""
    original_size = path.stat().st_size
    img = Image.open(path)
    has_transparency = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)

    # Downscale if needed
    img.thumbnail((MAX_WIDTH, MAX_HEIGHT), Image.LANCZOS)

    if path.suffix.lower() == ".png" and has_transparency:
        # Keep as PNG — lossless optimize only
        img.save(path, format="PNG", optimize=True)
        out_path = path
    else:
        # Convert to JPEG (handles PNG→JPG conversion too)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        out_path = path.with_suffix(".jpg")
        img.save(out_path, format="JPEG", quality=QUALITY, optimize=True, progressive=True)
        if out_path != path:
            path.unlink()   # remove original .png after saving as .jpg

    new_size = out_path.stat().st_size
    saving = (1 - new_size / original_size) * 100
    label = f"{path.parent.name}/{path.name}"
    print(f"  {label:<40s}  {original_size/1024:>8.1f} KB  →  {new_size/1024:>8.1f} KB  ({saving:.1f}%)")
    return out_path


def collect_images(root: Path) -> list[Path]:
    images = []
    for ext in ("*.jpg", "*.jpeg", "*.JPG", "*.JPEG", "*.png", "*.PNG"):
        images.extend(root.rglob(ext))
    return sorted(set(images))


def main():
    images = collect_images(ASSETS_DIR)

    if not images:
        print("No images found under", ASSETS_DIR)
        return

    print(f"Found {len(images)} images under {ASSETS_DIR}\n")
    print(f"  {'File':<40}  {'Before':>11}    {'After':>11}  Saving")
    print("  " + "-" * 80)

    total_before = sum(p.stat().st_size for p in images)
    total_after  = 0

    for img_path in images:
        out = compress_image(img_path)
        total_after += out.stat().st_size

    saved_mb = (total_before - total_after) / 1024 / 1024
    total_saving = (1 - total_after / total_before) * 100

    print("  " + "-" * 80)
    print(f"  {'TOTAL':<40}  {total_before/1024/1024:>8.2f} MB  →  {total_after/1024/1024:>8.2f} MB  ({total_saving:.1f}% — saved {saved_mb:.2f} MB)")
    print("\nDone. Re-deploy with: firebase deploy --only hosting")


if __name__ == "__main__":
    main()
