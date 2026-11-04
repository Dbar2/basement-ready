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

Output: `media/video-clips/<name>.mp4` (git-ignored), 1920×1080, 30 fps, H.264 CRF 14, no audio. Frames are
drawn at 3840×2160 in headless Chromium on the Mac's GPU (ANGLE Metal) and downscaled by ffmpeg. Each clip
takes about 20 s. One browser, closed at the end.

Where things come from: the surface is `public/samples/sample/3d/mesh.bin`; window, door, stairs, furnace
and water heater sit where `result.json`'s plan puts them (the furnace and water heater boxes are sized by
hand). The duct and the beam have no 3D position in the plan, so each is a ray from the camera pose of the
video frame where SAM boxed it, through the box's centre, onto the mesh (assuming a 64° field of view).
