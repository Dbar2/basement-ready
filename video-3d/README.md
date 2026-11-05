# 3D clips for the demo video

A capture-only page that draws the example basement's real scan, plan and furnished layout, one frame per
call, so Playwright can step it at 30 fps. It imports the app's mesh loader, example data and
`StagedFurniture` from `../src` and changes nothing there.

```bash
node video-3d/render.mjs 1                       # 01-assemble: points rise, scan line fuses the surface
node video-3d/render.mjs 2                       # 02-finds: window, stairs, duct, beam, furnace, water heater, door
node video-3d/render.mjs 3                       # 03-plan-to-3d: the plan draws, then walls and furniture rise
node video-3d/render.mjs 4                       # 04-flythrough: eye-level glide through the layout
node video-3d/render.mjs 2 --stills 0,90 --scale 1 --out /tmp/s2.mp4   # quick JPEG stills instead
```

A private scan instead of the example (read in place, never copied into the repo):

```bash
pnpm exec tsx video-3d/seed-existing.ts <scan>/result.json /tmp/existing.json   # its as-built plan, as the app seeds it
SCAN_DIR=<scan folder> SCAN_EXISTING=/tmp/existing.json node video-3d/render.mjs 1
```

The scan folder is laid out like `public/samples/sample` (`result.json`, `3d/basement/mesh.bin`, `3d/asbuilt/`).

Output: `media/video-clips/<name>.mp4` (git-ignored), 1920×1080, 30 fps, H.264 CRF 14, no audio. Frames are
drawn at 3840×2160 in headless Chromium on the Mac's GPU (ANGLE Metal) and downscaled by ffmpeg. Each clip
takes about 20 s. One browser, closed at the end.

Where things come from: the points in shot 1 are the example's own scan (`public/samples/sample/3d/mesh.bin`,
kept to inside the room). The solid basement in shots 1–3 is the app's clean as-built model (`AsBuiltScene`,
from `src/marketing/example-existing.json`, painted with `public/samples/sample/3d/asbuilt/`), with the near
end wall cut away (both near walls in shot 3) so its inside shows. The finds (window, stairs, duct, furnace,
water heater, door) sit where that model has them; the furnace and water heater heights are set by hand.
Shot 4 is the furnished layout on its own (`StagedFurniture`) with plain walls and the app's laminate.
