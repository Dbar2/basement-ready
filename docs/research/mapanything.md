# MapAnything for the Basement Ready "scan" step

Researched Wed Oct 28, 2026, from primary sources (GitHub repo, Hugging Face, the paper, platform pricing pages). Nothing was installed or run. Numbers marked **(est.)** are my extrapolations, not measurements; check them in the Day-1 test.

## Recommendation

1. **Verdict: conditional go.** Build the scan on MapAnything, but make the final call on Thu Oct 29 after one real-basement test. Until a tape measurement confirms it, treat its "metric" scale as an estimate.
2. **Checkpoint:** use `facebook/map-anything-apache` (Apache 2.0, V1.1, about 1B parameters, 4.9 GB). Pin HF revision `00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a` and code tag `v1.1.3`. Don't ship `facebook/map-anything`: it's CC-BY-NC (non-commercial), even though its training data has more indoor scenes.
3. **Where to run it:** Modal, one L40S (48 GB) GPU that scales to zero. Keep the weights in a Modal Volume and call `infer(memory_efficient_inference=True)`. The backup host is Runpod Serverless (a 48 GB worker, via Flash or a Docker worker). Use Baseten only if you want everything next to Spark Open.
4. **Input:** take 40 to 60 sharp frames from the 60–90 s video, about one every 1.5 s. Film in portrait with the 1x lens and all lights on. Resize frames to 294×518 (the model's 9:16 size).
5. **Expected time (est.):** about 3–6 s of model time for 48 frames on an L40S or A100; Meta measured about 1.4 s for 50 views on an H200. That's roughly 15–25 s end to end when the server is warm, plus 40–120 s on a cold start. Cost is about 1–3 cents per scan.
6. **Scale:** images alone will likely put the scale 10–25% off indoors. The paper reports 22% depth error on ScanNet, dropping to 3.5% once the scale is aligned. Correct it with one tape measurement (floor to the underside of the joists), and label sizes "estimated" until that's done.
7. **Thursday pass bar:** walls aren't doubled, the floor comes out as one flat plane, and ceiling height is within 5 cm after the one-measurement fix. To test with no install, run your test video through the free HF Space or Replicate `vufinder/map-anything` (Apache weights, about $0.06 per run), then measure the GLB in Blender.
8. **Fallback:** ship a precomputed sample-basement scan as static files (judges need this anyway). If MapAnything fails on live scans, use a tape measurement plus a 2D frame view with the SAM outlines.
9. **Meta tooling:** MapAnything comes from Meta Reality Labs but isn't on the hackathon's model list. It can't hurt Stage 1, because Spark and SAM already cover that; the real risk is build time. Ask at office hours whether it counts.
10. **Your Mac:** MapAnything has run on Apple Silicon (MPS) since v1.1.1 (Mar 2026). Your M3 Pro with 36 GB is fine for development runs of 8–24 frames, but don't serve from it.

---

## 1. MapAnything basics

| Item | Finding | Source |
|---|---|---|
| Repo | `facebookresearch/map-anything`, Apache-2.0 code, created Sep 2025, about 3.9k stars, last push Aug 7, 2026 | [GitHub](https://github.com/facebookresearch/map-anything) |
| Team | Meta Reality Labs + Carnegie Mellon (project page) | [map-anything.github.io](https://map-anything.github.io/) |
| Paper | arXiv 2509.13414, 3DV 2026. v3 (Jan 23, 2026) matches the V1.1 models | [arXiv](https://arxiv.org/abs/2509.13414), [HTML v3](https://arxiv.org/html/2509.13414v3) |
| Latest release | v1.1.3 (Jul 17, 2026). `pyproject.toml` on main already says 1.1.4 | [Releases](https://github.com/facebookresearch/map-anything/releases) |
| Model size | About 1B parameters; one `model.safetensors` of 4.91 GB (F32) | [HF apache](https://huggingface.co/facebook/map-anything-apache) |

**Code vs weights licence.** The code is Apache-2.0. There are four checkpoints. The README says the only difference between the pairs is the training data, and the API is identical.

| HF model ID | Licence | Version | Use it? |
|---|---|---|---|
| `facebook/map-anything-apache` | **Apache 2.0** | V1.1 (Jan 2026; HF repo last modified Feb 4, 2026) | **Yes, for the product** |
| `facebook/map-anything` | CC-BY-NC 4.0 | V1.1 | Research/eval only. This is what the official HF Space runs |
| `facebook/map-anything-apache-v1` | Apache 2.0 | V1 (Sep 2025) | Faster and lighter (see profiling), but older |
| `facebook/map-anything-v1` | CC-BY-NC 4.0 | V1 | No |

**Why the two variants differ (this matters for basements).** Per the paper's Table 1, the Apache model is trained on 6 datasets. Its only real indoor set is ScanNet++ v2 (926 scenes); the others are BlendedMVS, Mapillary street depth, Spring, TartanAirV2 and UnrealStereo4K. The NC model adds 7 more, including **Aria Synthetic Environments, about 104k synthetic indoor scenes**. Expect the Apache model to be weaker indoors than the paper's headline numbers. The paper only calls it "competitive with the VGGT baseline", with numbers in a figure.

**Inputs.** Images are required. Optional inputs per view: `intrinsics` *or* `ray_directions`; `depth_z` (needs intrinsics); `camera_poses` (4×4 OpenCV cam2world); and an `is_metric_scale` flag. Mixed per-view inputs are allowed. If any view has a pose, view 0 must have one too. Images are resized to a fixed set of sizes with a 518 px longest side. 9:16 portrait becomes **294×518**, 16:9 landscape becomes 518×294, and every view is forced to one shared aspect ratio. ([README](https://github.com/facebookresearch/map-anything#multi-modal-inference), [`utils/image.py`](https://github.com/facebookresearch/map-anything/blob/main/mapanything/utils/image.py))

**Outputs (per view, metric units).** The model returns these per view:
- `pts3d` (world, H×W×3) and `pts3d_cam`
- `depth_z` and `depth_along_ray`
- `ray_directions`
- `intrinsics` (3×3) and `camera_poses` (4×4), plus `cam_trans` and `cam_quats`
- `conf`, `mask` and `non_ambiguous_mask`
- `metric_scaling_factor`
- `img_no_norm`

The world frame is **view 0's camera** (OpenCV: +X right, +Y down, +Z forward), so it is *not* gravity-aligned ([issue #127](https://github.com/facebookresearch/map-anything/issues/127)). Internally the model predicts up-to-scale geometry plus one learned global metric scale factor (paper §3).

**How many frames, and memory.** These come from Meta's profile on an H200 for V1.1 ([speed plot](https://github.com/facebookresearch/map-anything/blob/main/assets/profiling_speed.png), [memory plot](https://github.com/facebookresearch/map-anything/blob/main/assets/profiling_memory.png)); values are read off log plots:

| Views | Default mode, peak GB | `memory_efficient_inference=True`, peak GB | Time (H200) |
|---|---|---|---|
| 24 | ~23 | ~9 | ~0.5 s |
| 32 | ~28 | ~10 | ~0.75 s |
| 50 | ~40 | ~12 | ~1.4 s |
| 100 | ~65 | ~18 | ~4.4 s |
| 200 | ~117 | ~29 | ~15 s |

The README says memory-efficient mode costs "negligible" speed and scales to about 2,000 views on 140 GB. The paper benchmarks 2–100 views; training used 2–24. At 50 views memory-efficient mode fits any 24 GB card. The profile's image size isn't stated; portrait 294×518 frames are smaller than 4:3, so real use should be a bit lighter. The V1 checkpoint is about 1.4× faster and lighter than V1.1.

## 2. Runtime

**Apple Silicon / CPU.**
- MPS support was merged in [PR #131](https://github.com/facebookresearch/map-anything/pull/131) (v1.1.1, Mar 23, 2026). It auto-picks CUDA, then MPS, then CPU, and the PR says it was confirmed working on Apple Silicon. CPU has worked since day one via the `cuda if available else cpu` fallback.
- **No published MPS or CPU timings.** My estimates (est.) for your M3 Pro with 36 GB:
  - **~30 s to a few minutes for 16–32 frames.** The 4.9 GB of weights fit easily.
  - **Risk above ~24–32 frames.** Global attention over tens of thousands of tokens doesn't get CUDA's FlashAttention on MPS, so memory can spike.
  - **CPU is tens of minutes per scan.** Not viable.
- Use the Mac for a dev loop, not for serving.

**GPU timings for ~48 frames.** Only the H200 row is measured (by Meta); the rest are scaled by compute and memory bandwidth (est.).

| GPU | VRAM | Model time, 48 frames | Notes |
|---|---|---|---|
| H200 | 141 GB | ~1.4 s (measured, 50 views) | Meta's profile |
| H100 | 80 GB | ~1.5–2.5 s (est.) | |
| A100 | 40/80 GB | ~3–5 s (est.) | |
| L40S | 48 GB | ~3–6 s (est.) | Replicate runs MapAnything on L40S. Its example log shows ~3 s inference for 9 video frames, 10.7 s predict incl. GLB/mesh export, and **203 s total including cold boot** ([schema page](https://replicate.com/vufinder/map-anything/api/schema)) |
| A10G / A10 | 24 GB | ~8–15 s (est.) | Needs memory-efficient mode |
| L4 | 24 GB | ~10–20 s (est.) | Needs memory-efficient mode |

On top of model time: about 5–15 s to load the 4.9 GB of weights on a cold start (longer if downloaded from HF), plus 3–10 s of CPU post-processing (voxelizing, plane fitting, file export). bf16 needs Ampere or newer; every GPU above qualifies.

**Install (for the GPU image; not run here).** MapAnything is **not on PyPI** (`mapanything` and `map-anything` both return 404). Per the README:

```bash
git clone --branch v1.1.3 https://github.com/facebookresearch/map-anything.git
cd map-anything
# Python 3.12 recommended (requires-python >= 3.10). Torch/CUDA are NOT pinned: install a CUDA 12.x torch + torchvision first.
pip install -e .            # base install is enough for MapAnything inference
# optional: pip install -e ".[colmap]"  (open3d, pycolmap 3.10, LightGlue) or ".[gradio]" (gradio 5.47.2)
```

- Notable pins: `uniception==0.1.7`, `opencv-python-headless==4.10.0.84` and `rerun-sdk~=0.24.1` (rerun needs numpy ≥ 2; see [issue #160](https://github.com/facebookresearch/map-anything/issues/160) if you add the VGGT-Omega extra).
- Use v1.1.3 or later. Older versions also download DINOv2 from Torch Hub at load time, which slows cold starts and breaks offline containers. The fix is [PR #162](https://github.com/facebookresearch/map-anything/pull/162).
- Load with: `MapAnything.from_pretrained("facebook/map-anything-apache", revision="00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a")`. It uses HF's `PyTorchModelHubMixin`, so `revision=` works.

**Official demos and hosted versions.**
- **HF Space** [`facebook/map-anything`](https://huggingface.co/spaces/facebook/map-anything) is Gradio on ZeroGPU and was running as of today. It takes video or images and samples one frame every N seconds (slider 0.1–5 s, default 1 s). It runs the **CC-BY-NC** checkpoint with `memory_efficient_inference=False` and a 120 s GPU window, and outputs a GLB. ZeroGPU daily quotas apply, so use it for testing, not production. Gradio's API client works with it.
- **Local Gradio:** `pip install -e ".[gradio]"; python scripts/gradio_app.py`. Rerun viewer: `scripts/demo_images_only_inference.py --viz --save_glb --apache`. Voxelized COLMAP/PLY export: `scripts/demo_colmap.py --apache --voxel_size=0.01`.
- **Replicate** [`vufinder/map-anything`](https://replicate.com/vufinder/map-anything) is a community wrapper, not Meta's. It uses the **Apache weights** on an L40S at about $0.055 per run.
  - Input: MP4/MOV/AVI or images, with `sampling_rate` (every nth frame, default 24).
  - Output: `point_cloud` GLB, `mesh` GLB and per-frame JSON (arrays as base64).
  - Cold boots took about 3 min in its example. Fine for testing; risky for a live demo.
- **fal / HF Inference Providers:** nothing found. The HF model page shows no inference provider.

## 3. Deployment options for a 7-day build

Prices were checked today. "Per scan" assumes about 25–35 s of warm GPU billing.

| Option | Price | Per scan (est.) | Pros | Cons |
|---|---|---|---|---|
| **Modal** (recommended) | L40S $0.000542/s ($1.95/h), A100-80 $2.50/h, A10 $1.10/h, L4 $0.80/h; $30/mo free plus $100 hackathon credits if you request them (first 1,000) ([pricing](https://modal.com/pricing)) | L40S ~$0.015 warm; a cold start adds ~$0.03 | Pure Python, and images build in the cloud, so you never build CUDA Docker on the Mac. Volumes cache the 4.9 GB weights. Scales to zero; default 60 s idle window, configurable. Simple web endpoint. [Memory snapshots](https://modal.com/docs/guide/memory-snapshots) can cut cold starts (GPU snapshots are alpha) | New platform to learn. Credits are first-come. Cold start without snapshots is probably 30–90 s (est.) |
| **Runpod Serverless** (backup) | Flex: 24 GB (L4/A5000) $0.69/h, 48 GB PRO (L40S) $1.75/h, A100 $2.72/h, H100 $4.79/h ([pricing](https://www.runpod.io/pricing)) | 48 GB ~$0.012; 24 GB ~$0.007 | You already have an account, and the Runpod MCP/skills are set up. Per-second billing; default idle timeout is only 5 s. Image pulls and model downloads happen while scaled down and aren't billed ([billing docs](https://docs.runpod.io/serverless/pricing)). [Flash](https://www.runpod.io/blog/flash-is-ga) (GA Apr 2026) deploys Python functions with no Dockerfile | Payload cap: 10 MB on `/run`, 20 MB on `/runsync`, so pass frame URLs and return result URLs from object storage. A classic worker needs a ~10–15 GB CUDA image, slow to build on an M3, so use Flash or Runpod's GitHub build. Flash's decorator API changed during beta; check the current docs |
| **Baseten** | L4 $0.85/h, A10G $1.21/h, A100 $4.00/h, H100 $6.50/h, billed per minute ([pricing](https://www.baseten.co/pricing/)); $100 hackathon credits (2,000 spots) | A10G ~$0.01; H100 ~$0.04 | Same platform as Muse Spark Open (`meta-models/muse-spark-open-1026`), so one bill and one dashboard. Scale-to-zero; [Truss](https://github.com/basetenlabs/truss) packaging | Truss config is one more thing to learn this week. Highest GPU prices; no published cold-start numbers |
| **Pre-computed demo scan** (build regardless) | $0 at runtime | $0 | Instant, can't fail during judging, and the same files drive the reveal. Judges have no Waterloo basement anyway | Not a live scan, so be honest about that in the video and README |
| Replicate `vufinder/map-anything` (test/emergency only) | ~$0.055/run on L40S | ~$0.055 | No setup; takes video and returns GLB + JSON | Community wrapper you don't control; ~3 min cold boots; another account and card |

**Keeping a server warm** costs about $1.95/h on a Modal L40S (≈ $187 for the Nov 5–8 judging window) and $0.69/h on a Runpod 24 GB worker. It isn't worth it: judges will mostly click "Try a sample basement" (precomputed). Show a progress state for live scans ("First scan warms up the 3D engine, about 1–2 min").

**Untested Modal sketch** (shape only):

```python
import modal
image = (modal.Image.debian_slim(python_version="3.12").apt_install("git")
         .pip_install("torch", "torchvision")  # pin a CUDA 12.x build
         .run_commands("git clone --depth 1 --branch v1.1.3 https://github.com/facebookresearch/map-anything /opt/ma",
                       "pip install -e /opt/ma open3d"))
hf = modal.Volume.from_name("hf-cache", create_if_missing=True)
app = modal.App("basement-scan")

@app.cls(gpu="L40S", image=image, volumes={"/root/.cache/huggingface": hf}, timeout=600)
class Scan:
    @modal.enter()
    def load(self):
        from mapanything.models import MapAnything
        self.model = MapAnything.from_pretrained("facebook/map-anything-apache",
            revision="00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a").to("cuda").eval()

    @modal.method()
    def run(self, frame_urls: list[str]) -> dict:
        # download frames -> load_images(paths) -> self.model.infer(views, memory_efficient_inference=True,
        # use_amp=True, amp_dtype="bf16", apply_mask=True, mask_edges=True)
        # -> save depth_z (fp16) + intrinsics + camera_poses + conf to scan.npz in object storage, return URLs
        ...
```

Store `depth_z` (fp16), `intrinsics`, `camera_poses` and `conf` instead of raw `pts3d`. Points can be rebuilt anywhere: about 300 KB per view, so about 15 MB for 48 views versus about 90 MB of float32 points.

## 4. Accuracy indoors

**What the evidence says.**
- **Metric scale from images alone is the weak spot.** The paper's Table 4 (Robust-MVD benchmark, ScanNet indoor) gives these absolute relative depth errors for MapAnything:

  | Inputs | Error |
  |---|---|
  | Multi-view, images only | **22.2%** |
  | Images + intrinsics | 24.9% |
  | Images + intrinsics + poses | 5.6% |
  | Images only, after median scale alignment | **3.5%** (VGGT 2.3%, π³ 2.0%) |

  So the *shape* is good and the *global scale* is the error. The authors call their ScanNet metric scale "sub-optimal" and blame benchmark quality. MUSt3R (Naver) scored 7.7% on the same metric test.
- **Maintainers on scale:** it is "purely data prior driven" and can be off for out-of-distribution scenes. One user's cube came out at about half its real size ([#107](https://github.com/facebookresearch/map-anything/issues/107)), and a landmark came out about 3× small ([#81](https://github.com/facebookresearch/map-anything/issues/81)). Within one scene the scale is consistent, so one reference fixes it everywhere ([#83](https://github.com/facebookresearch/map-anything/issues/83), [#168](https://github.com/facebookresearch/map-anything/issues/168)).
- **Too many frames can double walls.** The paper's Fig. S.5 shows duplicated structure for MapAnything and baselines at 100 images without known poses. A user scanning a room reported unconnected walls and duplicated floor ([#126](https://github.com/facebookresearch/map-anything/issues/126); that was a panorama workflow, but the symptom is the one to watch). Stay at 40–60 frames and close the loop.
- **Textureless walls:** the paper claims, qualitatively, better handling than VGGT on textureless surfaces (Fig. 3). Learned priors beat classic SfM here; COLMAP usually fails on blank drywall.
- **Low light and phone video:** there's **no published evaluation** of low light or handheld phone video. The limitations section doesn't mention low light. Dim basements mean motion blur and noise, which hurt both depth and poses. Mitigate in capture: turn every light on, use the phone torch if allowed, move slowly, and pick the sharpest frames.
- **Calibration is strong:** single-image focal estimation error is 0.39° on ScanNet++ (Table 3). Passing intrinsics doesn't fix scale (see the table above), so images-only is fine.

**What this means for the product.** Without a tape, the video's scale can be off enough to swing a "ceiling height OK?" verdict entirely. One tape measurement brings it much closer, but a reading can still sit near a code threshold, so near a threshold say "confirm with a tape measure" instead of pass/fail. This fits your trust rule. The product never shows these error figures to homeowners.

**Fixing scale with one known measurement.**
1. Fit floor and ceiling planes (section 6) and compute the measured height `h_scan`.
2. Ask the user for one tape number, `h_tape`: floor to the underside of the joists or ceiling, in one spot you show on screen.
3. Compute `s = h_tape / h_scan` and multiply every 3D point, `depth_z` and camera translation by `s`. Rotations and intrinsics don't change.
4. Plane-to-plane height is the best reference because thousands of points average out. A single window width depends on edge pixels.
5. With several references (say ceiling height and a window width), use the median of the ratios and show the spread as your error bar.
6. Optional automatic sanity check: SAM's "door". Many interior doors are 80 in (2.03 m) slabs; use that only to flag a suspicious scale (off by more than 15%), never as ground truth.

## 5. Alternatives if MapAnything fails

| Option | One-line trade-off | Meta? |
|---|---|---|
| **VGGT** (`facebook/VGGT-1B`) | Fast and accurate *shape* (2.3% aligned ScanNet depth error in Table 4 vs MapAnything's 3.5%), but scale is normalized, not metric, so the tape measurement becomes mandatory. Weights are CC-BY-NC; `VGGT-1B-Commercial` is gated with its own licence | Yes (FAIR + Oxford) |
| **VGGT-Ω** ([repo](https://github.com/facebookresearch/vggt-omega)) | Newest (May 2026); fits 50 frames in about 10 GB on an A100. Weights are **gated** (automated approval) under the **FAIR Noncommercial Research License**, which also restricts outputs; metric scale isn't stated (likely up-to-scale like VGGT). Too risky to depend on in 7 days | Yes |
| MapAnything V1 Apache (`facebook/map-anything-apache-v1`) | Same API, about 1.4× faster and lighter. Worth one A/B on your test video if V1.1 does badly | Yes |
| DUSt3R / MASt3R / MUSt3R (Naver) | MUSt3R had better ScanNet metric scale than MapAnything (Table 4), but CC BY-NC-SA, slower global alignment, and not Meta | No |
| Depth Anything 3 (ByteDance) | `DA3METRIC-LARGE` is Apache but monocular; the multi-view metric `DA3NESTED-GIANT-LARGE` is CC-BY-NC. Swappable inside MapAnything's model factory (`da3`). Not Meta | No |
| Depth Anything + COLMAP | Classic SfM is slow (minutes) and fails on dim, blank walls; still needs a scale reference | No |
| WebXR depth sensing ([spec](https://immersive-web.github.io/depth-sensing/)) | Real metric depth in the browser, but Android Chrome with ARCore only; iPhone Safari has no WebXR AR. Doesn't cover most homeowners | No |
| iPhone LiDAR apps (Polycam, Scaniverse, 3d Scanner App, Record3D) | Accurate to about 1–2 cm, but needs a Pro iPhone and an app install, breaks the browser-only flow, and isn't Meta (your plan already dropped RoomPlan for this reason). Middle path for the *sample* basement only: Record3D exports RGB-D + poses, which MapAnything accepts as metric inputs, so a Meta model stays in the loop | No |
| **2D fallback (already in your plan)** | One tape measurement + SAM outlines on frames + measurements typed or confirmed by the user. No 3D reveal, but honest and reliable | SAM (yes) |

Meta-first order: MapAnything V1.1 Apache, then MapAnything V1 Apache, then VGGT plus a mandatory tape scale, then the 2D fallback.

## 6. Practical pipeline

**1. Capture (browser).**
- Portrait, locked orientation, 1x lens (the best low-light sensor), all lights on.
- Walk one slow loop around the room. Tilt floor-to-ceiling at each wall, window and duct run. Portrait at 1x sees roughly 3 m of height from 2.5 m away, so floor and ceiling share frames, which makes height measurement much more reliable.
- Pull frames on the phone instead of uploading a 100–200 MB video: draw the camera stream to a canvas every ~0.5 s and save JPEGs at ~1024 px on the long side (SAM likes more pixels than MapAnything's 518). Record audio separately for Muse Voice Transcribe.
- Optional: log `DeviceMotionEvent` gravity per frame (iOS needs `requestPermission()` on a tap). That gives a true "up" direction later.

**2. Frame selection.**
- From the 0.5 s samples, keep the sharpest frame per 1.5 s window (variance of the Laplacian) and drop near-duplicates when the phone was still.
- Target **40–60 frames, capped at 64**: 60 s gives about 40, 90 s about 60.
- More isn't better; see the duplication risk at 100 frames.

**3. Resolution and crop alignment (critical for SAM).**
- Center-crop every frame to exactly 9:16 *before* sending it anywhere.
- Send the cropped ~1024 px frames to SAM 3.1, and the same frames to MapAnything, which resizes them to 294×518.
- Resize each SAM mask to 294×518 with nearest-neighbour. Because the crop is identical, each mask pixel then maps 1:1 to the `pts3d[i]` pixel.

**4. Lifting SAM masks to 3D (yes, pixel-aligned).**
- `pts3d[i]` is an H×W×3 world-coordinate image, so `obj_pts = pts3d[i][mask_i & valid_i]`, where `valid_i = pred["mask"] & (conf > percentile_20)`.
- Erode masks by 2 px first to avoid edge "flying pixels" (MapAnything's `mask_edges=True` helps too).
- Pool points across frames by SAM 3.1's track ID (same object, many views) and use robust stats: medians and 5th/95th percentiles.
- For the glowing reveal, store a per-point `label` byte and vote by majority within each voxel.

**5. Windows: use rays, not glass depth.**
- Depth on glass is unreliable (reflections, or the window well behind it). Fit the wall plane from a ring of wall pixels around the window mask, using the dilated mask minus the mask.
- Intersect each window-pixel ray with that plane. The ray origin is the camera position; the direction is the camera rotation applied to `ray_directions[i]`.
- Take a min-area rectangle of the outline in wall coordinates, using the 2nd and 98th percentiles. That gives width, height, and sill height above the floor plane.

**6. Gravity, floor and ceiling.**
- Initial "up" = the average of each camera's −Y axis in world coordinates (people hold phones roughly upright), or use the DeviceMotion gravity.
- Run Open3D `segment_plane` (RANSAC, `distance_threshold≈0.02–0.03 m`, about 1,000 iterations) repeatedly on a 2 cm voxel-downsampled cloud, removing inliers each round.
- **Floor** = the lowest large plane with its normal within ~10° of up. Re-align up to the floor normal.
- **Ceiling** = the highest large plane facing down. Unfinished joists give "underside of joists"; label it so.
- **Ceiling height** = the distance from the floor plane to the ceiling plane, using the median over inliers.
- **Under-duct clearance** = floor plane to the 5th-percentile height of duct-labelled points.

**7. Walls and room box.**
- Take points with roughly horizontal normals, between 0.3 m above the floor and 0.3 m below the ceiling.
- Find the dominant wall direction from the normal azimuths (mod 90°, the Manhattan assumption) and rotate to align.
- Room box = the 2nd–98th percentile extents along both axes. Optionally rasterize a 2D footprint (5 cm cells) for L-shaped basements.
- Output `room.json` with floor/ceiling heights, wall planes (normal and offset), L×W×H, the scale factor and its source (`model` or `tape`), plus per-object measurements with the frames they came from (your evidence rule).

**8. Browser formats and point budget.**
- Raw input is about 48 views × 152k pixels ≈ 7.3M points. After the confidence mask and a 2 cm voxel grid, a 10×8 m basement comes to about 400–700k points; use 3 cm for mobile (about 250k).
- **Binary PLY** with `x y z` (float32), `red green blue` (uint8) plus custom `label` and `frame` properties is about 16 bytes per point, so about 4–10 MB before Brotli. Three.js `PLYLoader.setCustomPropertyNameMapping()` reads the extra properties.
- Or a **GLB** `POINTS` primitive quantized with gltf-transform (meshopt, int16 positions): about 2–4 MB.
- Also export camera poses (`cameras.json`) and `room.json`.
- **Reveal:**
  - Use `THREE.Points` with a `ShaderMaterial`, plus per-point attributes `aFrame` (capture order) and `aLabel`.
  - A time uniform flies points in frame by frame along the camera path; draw camera frustums from the poses.
  - SAM classes then glow by label colour, and measurements pop in as `CSS2DObject` labels.

**Browser libraries worth using.**
- **[three.js](https://threejs.org) (0.186.x):** `Points`, [`PLYLoader`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/PLYLoader.js), `GLTFLoader` + `MeshoptDecoder`, `CSS2DRenderer`, `OrbitControls`/`PointerLockControls`.
- **[@react-three/fiber](https://r3f.docs.pmnd.rs) + drei:** only if the app is React.
- **[gltf-transform](https://gltf-transform.dev) (4.5.x):** compression on the server or in the build.
- **[three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh):** picking against the clean room-box meshes in the explorer.
- **Optional:**
  - [potree-core](https://github.com/tentone/potree-core): only needed above about 2–3M points, so not needed here.
  - [Spark](https://sparkjs.dev) (2.4.x): Gaussian splats, for a stretch "photoreal" sample built with MapAnything → COLMAP export → gsplat, about 10–20 min of GPU per scene, so precomputed only.
  - [Rerun](https://rerun.io): dev-only debug viewer, already wired into MapAnything's demo scripts.
- **Server-side:**
  - Open3D (plane RANSAC, voxels, normals, outlier removal)
  - numpy/scipy, OpenCV (frames, sharpness)
  - trimesh/plyfile (already MapAnything dependencies) for export

## 7. Does MapAnything count as "Meta AI tooling"?

**Facts.**
- It is built and released by Meta Reality Labs, in the `facebookresearch` org on GitHub and the `facebook` org on Hugging Face.
- The Apache-2.0 weights also satisfy the hackathon's "rights to everything you use" rule.
- It is **not** on the listed model set (Muse Spark, Muse Image, Muse Voice Transcribe, SAM 3.1 API, Muse Glimmer, Muse Spark Open).

**Risk, in plain terms.**
- **Stage 1 (pass/fail on really using Meta models):** no risk. Spark, SAM 3.1, Voice Transcribe and Muse Image carry it whatever judges think of MapAnything.
- **"Use of Meta tooling" (25%):**
  - *Best case:* judges count it as an extra Meta open-weights model doing a hard job (metric 3D from phone video) that SAM then grounds. That's a strong "beyond a basic integration" story and supports the "Best Build on Meta Open Weights" bonus.
  - *Likely case:* partial credit as "Meta research tech", plus a boost to Technical depth (20%) and Demo (25%) through the reveal.
  - *Worst case:* only listed models count, and MapAnything is neutral for tooling.
- The cost of the worst case is **build time, not points**. Cap MapAnything work at Thursday plus half of Friday. If it isn't producing a usable room by then, switch to the fallback.
- **Mitigation for the narrative:** keep SAM 3.1 visibly central to the 3D step. SAM finds the objects; MapAnything places them in metres; Spark reasons only over SAM-verified, measured objects.

**Question for office hours (Thu 10–11 AM, #office-hours):**

> "We use MapAnything (Meta Reality Labs, Apache-2.0 open weights `facebook/map-anything-apache`) to turn phone video into a metric 3D room, alongside SAM 3.1, Muse Spark and Muse Image. Does it count toward 'Use of Meta tooling' and toward 'Best Build on Meta Open Weights', or do only the listed models count?"

## Day-1 test (no install, about 30 minutes)

1. Film 60–90 s of the test basement as in section 6. Tape-measure three things: floor to joists, one window's width and height, and the room's length.
2. Upload the video to the [HF Space](https://huggingface.co/spaces/facebook/map-anything) with a 1.5 s interval. Optionally run [Replicate](https://replicate.com/vufinder/map-anything) too (`sampling_rate` ≈ 45 for 30 fps): the Space runs the NC weights, while Replicate runs the Apache weights you'd actually ship.
3. Download the GLB and open it in Blender. Measure floor to ceiling, the window and the room length; compute each scan/tape ratio.
4. **Go** if walls aren't doubled and the floor is one plane, and the three ratios agree within about 5% of each other (one shared scale error is fixable). **Go with mandatory tape** if they agree but the shared scale is off by more than 10%. **No-go** if the geometry is broken (doubled walls, split floor), or the ratios disagree by more than 10%, even after a re-film with more light.

## Sources

- MapAnything repo and README: <https://github.com/facebookresearch/map-anything>
  - Changelog: <https://github.com/facebookresearch/map-anything/blob/main/CHANGELOG.md>
  - `pyproject.toml`: <https://github.com/facebookresearch/map-anything/blob/main/pyproject.toml>
  - Releases: <https://github.com/facebookresearch/map-anything/releases>
- Profiling plots:
  - <https://github.com/facebookresearch/map-anything/blob/main/assets/profiling_speed.png>
  - <https://github.com/facebookresearch/map-anything/blob/main/assets/profiling_memory.png>
- Pull requests: MPS support <https://github.com/facebookresearch/map-anything/pull/131>; DINO hub fix <https://github.com/facebookresearch/map-anything/pull/162>
- Issues: [#81](https://github.com/facebookresearch/map-anything/issues/81), [#83](https://github.com/facebookresearch/map-anything/issues/83), [#107](https://github.com/facebookresearch/map-anything/issues/107), [#126](https://github.com/facebookresearch/map-anything/issues/126), [#127](https://github.com/facebookresearch/map-anything/issues/127), [#133](https://github.com/facebookresearch/map-anything/issues/133), [#149](https://github.com/facebookresearch/map-anything/issues/149), [#152](https://github.com/facebookresearch/map-anything/issues/152), [#160](https://github.com/facebookresearch/map-anything/issues/160), [#168](https://github.com/facebookresearch/map-anything/issues/168)
- Paper: <https://arxiv.org/abs/2509.13414>; v3 HTML (Tables 1–4, Figs. S.1, S.2, S.5): <https://arxiv.org/html/2509.13414v3>
- Project page: <https://map-anything.github.io/>
- Hugging Face models:
  - <https://huggingface.co/facebook/map-anything-apache>
  - <https://huggingface.co/facebook/map-anything>
  - <https://huggingface.co/facebook/map-anything-apache-v1>
  - <https://huggingface.co/facebook/map-anything-v1>
- HF Space and its `app.py`: <https://huggingface.co/spaces/facebook/map-anything>
- Replicate wrapper and schema: <https://replicate.com/vufinder/map-anything>, <https://replicate.com/vufinder/map-anything/api/schema>
- Modal: <https://modal.com/pricing>, <https://modal.com/docs/guide/memory-snapshots>, <https://modal.com/blog/gpu-mem-snapshots>
- Runpod:
  - <https://www.runpod.io/pricing>
  - <https://docs.runpod.io/serverless/pricing>
  - <https://docs.runpod.io/serverless/endpoints/operations>
  - <https://www.runpod.io/blog/flash-is-ga>
  - <https://pypi.org/project/runpod-flash/>
- Baseten: <https://www.baseten.co/pricing/>, <https://github.com/basetenlabs/truss>
- VGGT-Ω: <https://github.com/facebookresearch/vggt-omega>, <https://arxiv.org/abs/2605.15195>, <https://huggingface.co/facebook/VGGT-Omega>
- VGGT: <https://huggingface.co/facebook/VGGT-1B>, <https://huggingface.co/facebook/VGGT-1B-Commercial>
- Depth Anything 3: <https://huggingface.co/depth-anything/DA3METRIC-LARGE>, <https://huggingface.co/depth-anything/DA3NESTED-GIANT-LARGE>
- WebXR depth sensing: <https://immersive-web.github.io/depth-sensing/>
- three.js PLYLoader: <https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/PLYLoader.js>

Not verified today: the iPhone LiDAR apps' current export formats, and Modal/Runpod cold-start times for this exact model (no published numbers).
