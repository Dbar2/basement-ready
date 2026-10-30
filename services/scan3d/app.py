"""Modal app: MapAnything on one L40S, weights in a Volume, scales to zero.

Run from services/scan3d:
    modal run app.py::download_weights   # once: puts the pinned 4.9 GB checkpoint in the Volume
    modal deploy app.py                  # prints the https URL of the web endpoint
See README.md for the request and response contract.
"""

import os
from pathlib import Path

import modal

from scan3d import MODEL_ID, MODEL_REVISION

HERE = Path(__file__).parent
WEIGHTS = "/weights"
# MapAnything's encoder builds DINOv2 from torch hub code (not weights) on every load, from the
# unpinned main branch. Bake that code into the image at a fixed commit; torch hub then uses it.
DINOV2_COMMIT = "7764ea0f912e53c92e82eb78a2a1631e92725fc8"
DINOV2_HUB_DIR = "/root/.cache/torch/hub/facebookresearch_dinov2_main"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libglib2.0-0", "libgomp1")
    .pip_install("torch==2.14.1", "torchvision==0.29.1", index_url="https://download.pytorch.org/whl/cu126")
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .run_commands(
        f"git init -q {DINOV2_HUB_DIR}",
        f"git -C {DINOV2_HUB_DIR} fetch -q --depth 1 https://github.com/facebookresearch/dinov2.git {DINOV2_COMMIT}",
        f"git -C {DINOV2_HUB_DIR} checkout -q FETCH_HEAD",
    )
    .env({
        "HF_HOME": f"{WEIGHTS}/hf",
        "HF_HUB_DISABLE_TELEMETRY": "1",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
    })
    .add_local_python_source("scan3d")
)

app = modal.App("basement-ready-scan3d", image=image)
weights = modal.Volume.from_name("scan3d-weights", create_if_missing=True)


@app.function(volumes={WEIGHTS: weights}, timeout=1800)
def download_weights():
    from huggingface_hub import snapshot_download

    path = snapshot_download(MODEL_ID, revision=MODEL_REVISION)
    weights.commit()
    print("weights at", path)


@app.cls(
    gpu="L40S",
    volumes={WEIGHTS: weights},
    secrets=[modal.Secret.from_name("scan3d-token")],
    scaledown_window=60,  # idle seconds before scaling to zero; every idle second is billed GPU time
    timeout=600,
    max_containers=3,  # a basement's areas run side by side
    cpu=8.0,  # the solid surface (mesh.py) is fused on the CPU
    memory=32768,
)
class Scan3D:
    @modal.enter()
    def load(self):
        os.environ["HF_HUB_OFFLINE"] = "1"  # weights come from the Volume only; fail fast if missing
        from scan3d.pipeline import Scanner

        self.scanner = Scanner.load("cuda")

    @modal.asgi_app()
    def web(self):
        from scan3d.api import create_app

        # 48 GB holds about 150 views at once.
        return create_app(lambda: self.scanner, token=os.environ["SCAN3D_TOKEN"], max_frames_cap=150)


# Painting the as-built model (scan3d/texture.py) needs no GPU and no model: its own small CPU
# container, so repainting after a plan change never wakes an L40S. Point the Node side's
# SCAN3D_TEXTURE_URL at this endpoint's URL (it prints on deploy); without it, the GPU endpoint paints.
@app.function(secrets=[modal.Secret.from_name("scan3d-token")], cpu=4.0, memory=8192, timeout=600, scaledown_window=60, max_containers=2)
@modal.asgi_app()
def paint_web():
    from scan3d.api import create_app

    return create_app(lambda: None, token=os.environ["SCAN3D_TOKEN"], max_frames_cap=150)
