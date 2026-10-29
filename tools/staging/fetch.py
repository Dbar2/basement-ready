"""Fetch the CC0 furniture and finishes for the 3D staging from Poly Haven, sized for phones.

Models become meshopt-compressed GLBs with WebP textures (public/staging/models), finishes become
1k WebP maps (public/staging/textures). Every asset is CC0 (polyhaven.com/license); credits are
written to public/staging/CREDITS.txt. Run once: python3 tools/staging/fetch.py
"""
import json
import shutil
import subprocess
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "staging"
WORK = ROOT / "tmp" / "staging-src"
UA = {"User-Agent": "BasementReady/0.1 (staging assets)"}

# id: largest texture side. Hero pieces get 1024, small decor 512.
MODELS = {
    "mid_century_lounge_chair": 1024,
    "modern_arm_chair_01": 1024,
    "modern_coffee_table_01": 1024,
    "modern_wooden_cabinet": 1024,
    "side_table_01": 512,
    "modern_ceiling_lamp_01": 512,
    "ceramic_vase_02": 512,
    "ceramic_vase_04": 512,
    "hanging_picture_frame_01": 512,
    "standing_picture_frame_02": 512,
}
# id: which maps. Fabrics only lend their weave (normal, roughness): the colour is ours.
TEXTURES = {
    "laminate_floor_02": ["Diffuse", "nor_gl", "Rough"],
    "wood_floor": ["Diffuse", "nor_gl", "Rough"],
    "white_oak_veneer": ["Diffuse", "Rough"],
    "long_white_tiles": ["Diffuse", "nor_gl", "Rough"],
    "rough_linen": ["nor_gl"],
    "wool_boucle": ["nor_gl"],
}
FABRICS = {"rough_linen", "wool_boucle"}  # a fine weave repeats: 512 px is plenty
MAP_NAME = {"Diffuse": "diff", "nor_gl": "nor", "Rough": "rough"}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def files(asset: str) -> dict:
    return json.loads(get(f"https://api.polyhaven.com/files/{asset}"))


def fetch_model(asset: str, size: int) -> None:
    g = files(asset)["gltf"]["1k"]["gltf"]
    src = WORK / asset
    src.mkdir(parents=True, exist_ok=True)
    (src / Path(g["url"]).name).write_bytes(get(g["url"]))
    for rel, inc in g["include"].items():
        (src / rel).parent.mkdir(parents=True, exist_ok=True)
        (src / rel).write_bytes(get(inc["url"]))
    out = OUT / "models" / f"{asset}.glb"
    subprocess.run(
        ["npx", "--yes", "@gltf-transform/cli@4.4.1", "optimize", str(src / Path(g["url"]).name), str(out),
         "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", str(size)],
        check=True, capture_output=True,
    )
    print(f"model {asset}: {out.stat().st_size // 1024} KB")


def fetch_texture(asset: str, maps: list[str]) -> None:
    f = files(asset)
    for m in maps:
        img = Image.open(BytesIO(get(f[m]["1k"]["jpg"]["url"])))
        if asset in FABRICS:
            img = img.resize((512, 512), Image.LANCZOS)
        out = OUT / "textures" / f"{asset}_{MAP_NAME[m]}.webp"
        img.convert("RGB").save(out, "WEBP", quality=80 if m == "Diffuse" else 85, method=6)
        print(f"texture {out.name}: {out.stat().st_size // 1024} KB")


def main() -> None:
    (OUT / "models").mkdir(parents=True, exist_ok=True)
    (OUT / "textures").mkdir(parents=True, exist_ok=True)
    for asset, size in MODELS.items():
        fetch_model(asset, size)
    for asset, maps in TEXTURES.items():
        fetch_texture(asset, maps)
    credits = ["3D staging assets, all CC0 (public domain) from Poly Haven: https://polyhaven.com/license", ""]
    credits += [f"https://polyhaven.com/a/{a}" for a in [*MODELS, *TEXTURES]]
    (OUT / "CREDITS.txt").write_text("\n".join(credits) + "\n")
    shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    main()
