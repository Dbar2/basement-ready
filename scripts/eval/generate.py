# Synthetic basements with known answers, for measuring how accurate the scan really is.
# Each basement is an exact plan: rooms, ceilings, windows, doors, stairs, ducts and beams.
# Blender builds it, walks a phone-style camera through it the way the filming guide asks
# (src/capture/script.ts: stairs first, walls from about 2 m back, tilt up, room to room),
# renders a portrait 1080×1920 30 fps video, and writes truth.json next to it.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/eval/generate.py -- [options]
#     --only b1,b4      just these basements (default: all)
#     --out DIR         output folder (default: media/eval)
#     --preview N       render N stills at half size instead of the video (quick look)
#     --at 0,12.5       render stills at these seconds instead (with --preview)
#     --truth-only      write truth.json and scene.blend, skip rendering
#     --scale F         render at F × 1080×1920 (default 1)
#     --samples N       EEVEE samples per frame (default 8)
#
# Writes <out>/<id>/walkthrough.mp4, truth.json and scene.blend. Deterministic: same input, same files.
import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

REPO = Path(__file__).resolve().parents[2]
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"

FPS = 30
ANALYSIS_FPS = 5  # server/pipeline.ts reads the video at 5 fps
RES = (1080, 1920)
EYE = 1.45  # phone height while filming
JOIST_D, JOIST_W, JOIST_GAP = 0.235, 0.038, 0.406  # 2×10s at 16" centres
INT_WALL, EXT_WALL = 0.12, 0.25
DOOR_H = 2.032  # 80" slab, the height server/scan3d.ts scales from
RISER_MAX, TREAD = 0.20, 0.254
TOPLESS = 2.6  # height of the stairwell above the upper floor

# Egress rule (data/rules: egress_window_bedroom_area + egress_window_min_dimension)
EGRESS_AREA_M2, EGRESS_MIN_SIDE_M = 0.35, 0.38
# Ceiling rules, finished heights: drywall takes 16 mm off what the scan reads (server/assess.ts)
CEILING_MIN_M, CLEARANCE_MIN_M, FINISH_M = 1.95, 1.85, 0.016

# ---------------------------------------------------------------------------------------------
# The basements. Plan metres, x east, y north, rooms as interior rectangles (wall face to wall
# face). Rooms next to each other leave a 0.12 m partition between them. Rooms are listed in the
# order they're filmed, and each door joins a room to the next one.
# ceiling: "joists" (exposed; the rule height is their underside) or a drywall height in metres.
# ---------------------------------------------------------------------------------------------

BASEMENTS = [
    dict(
        id="b1-unfinished-open",
        about="One open unfinished room: low duct trunk and steel beam, only small hopper windows.",
        seed=11, duration=60, subfloor=2.27, joists="y", exposure=0.6,
        walls_ext="poured", floor="concrete",
        rooms=[
            dict(name="Basement", rect=(0, 0, 7.6, 5.4), ceiling="joists", clutter=9,
                 lights=[("bulb", 2.0, 1.7), ("bulb", 5.4, 1.7), ("bulb", 3.6, 4.1)]),
        ],
        stairs=dict(axis="x", line=0.0, side=1, bottom=4.3, up=-1),
        windows=[("N", 0, 1.6, 0.80, 0.40, 1.55), ("N", 0, 4.6, 0.80, 0.40, 1.55), ("S", 0, 5.8, 0.80, 0.40, 1.55)],
        ducts=[dict(rect=(0.5, 3.8, 6.6, 4.2), depth=0.25)],
        beams=[dict(axis="x", at=2.7, span=(0, 7.6), depth=0.20, kind="steel", posts=[2.6, 5.1])],
        furnace=dict(x=6.6, y=4.45, face="S"), heater=dict(x=7.15, y=3.6), panel=dict(wall="E", room=0, at=2.0),
    ),
    dict(
        id="b2-finished-family",
        about="Finished throughout: a good escape window, a bulkhead at 2.10 m, a duct in the utility room.",
        seed=22, duration=64, subfloor=2.60, joists="y", exposure=0.2,
        walls_ext="poured", floor="concrete",
        rooms=[
            dict(name="Family room", rect=(0, 0, 6.4, 4.6), ceiling=2.35, finish="drywall", floor="vinyl", clutter=5,
                 lights=[("pot", 1.8, 1.6), ("pot", 4.6, 1.6), ("pot", 1.8, 3.1), ("pot", 4.6, 3.1)]),
            dict(name="Utility room", rect=(6.52, 0, 9.6, 4.6), ceiling=2.35, finish="drywall", clutter=4,
                 lights=[("bulb", 8.0, 2.3), ("tube", 8.2, 0.9)]),
        ],
        stairs=dict(axis="x", line=4.6, side=-1, bottom=3.9, up=-1),
        doors=[dict(wall="E", room=0, at=1.4, width=0.81)],
        windows=[("W", 0, 1.6, 0.90, 0.65, 1.15), ("S", 0, 4.5, 0.75, 0.40, 1.55), ("S", 1, 2.5, 0.60, 0.35, 1.60)],
        bulkheads=[dict(rect=(0, 0, 6.4, 0.55), bottom=2.10, room=0)],
        ducts=[dict(rect=(6.52, 3.9, 8.75, 4.3), depth=0.20, hang=0.015)],
        furnace=dict(x=8.8, y=3.75, face="W"), heater=dict(x=9.2, y=2.9), panel=dict(wall="E", room=1, at=1.3),
        laundry=dict(x=7.0, y=0.05, face="N"),
    ),
    dict(
        id="b3-three-rooms-bulkhead",
        about="Three drywalled rooms at 2.07 m with a 1.85 m bulkhead; one proper escape window.",
        seed=33, duration=72, subfloor=2.32, joists="x", exposure=0.4,
        walls_ext="block", floor="concrete",
        rooms=[
            dict(name="Rec room", rect=(0, 0, 5.8, 5.4), ceiling=2.07, finish="drywall", floor="carpet", clutter=5,
                 lights=[("flush", 2.2, 2.0), ("flush", 3.8, 3.6)]),
            dict(name="Workshop", rect=(5.92, 0, 9.4, 2.9), ceiling=2.07, finish="drywall", clutter=4,
                 lights=[("tube", 7.6, 1.4)], bench=dict(rect=(8.75, 0.3, 9.35, 2.2))),
            dict(name="Furnace room", rect=(5.92, 3.02, 9.4, 5.4), ceiling="joists", clutter=2,
                 lights=[("bulb", 7.0, 4.2)]),
        ],
        stairs=dict(axis="x", line=0.0, side=1, bottom=4.6, up=-1),
        doors=[dict(wall="E", room=0, at=1.6, width=0.81), dict(wall="N", room=1, at=1.9, width=0.76)],
        windows=[("N", 0, 2.5, 0.80, 0.40, 1.45), ("S", 1, 1.7, 1.00, 0.60, 1.00), ("N", 2, 1.4, 0.50, 0.30, 1.55)],
        bulkheads=[dict(rect=(0, 0.92, 0.6, 5.4), bottom=1.85, room=0)],
        ducts=[dict(rect=(6.0, 4.75, 8.6, 5.15), depth=0.20)],
        furnace=dict(x=8.6, y=4.3, face="W"), heater=dict(x=9.05, y=3.55), panel=dict(wall="W", room=2, at=0.9),
    ),
    dict(
        id="b4-four-rooms-mixed",
        about="Four rooms, mixed finishes, a steel beam with posts; every window just short of escape size.",
        seed=44, duration=84, subfloor=2.45, joists="y", exposure=0.5,
        walls_ext="poured", floor="concrete",
        rooms=[
            dict(name="Rec room", rect=(0, 0, 7.0, 5.2), ceiling="joists", clutter=7,
                 lights=[("bulb", 1.9, 1.6), ("bulb", 5.2, 1.6), ("bulb", 3.5, 3.9)]),
            dict(name="Den", rect=(7.12, 0, 10.6, 3.6), ceiling=2.20, finish="drywall", floor="carpet", clutter=3,
                 lights=[("flush", 8.86, 1.8)]),
            dict(name="Laundry", rect=(7.12, 3.72, 10.6, 7.6), ceiling="joists", clutter=2,
                 lights=[("bulb", 8.4, 5.0), ("tube", 9.0, 6.8)]),
            dict(name="Storage", rect=(3.4, 5.32, 7.0, 7.6), ceiling="joists", clutter=6, shelves=True,
                 lights=[("bulb", 5.2, 6.4)]),
        ],
        stairs=dict(axis="x", line=0.0, side=1, bottom=4.3, up=-1),
        doors=[dict(wall="E", room=0, at=1.8, width=0.81), dict(wall="N", room=1, at=2.2, width=0.81),
               dict(wall="W", room=2, at=2.6, width=0.76)],
        windows=[("S", 0, 5.0, 0.75, 0.45, 1.50), ("N", 0, 1.7, 0.75, 0.45, 1.50), ("S", 1, 1.8, 0.60, 0.45, 1.45),
                 ("E", 2, 0.9, 0.50, 0.30, 1.70), ("N", 3, 1.0, 0.80, 0.40, 1.55)],
        ducts=[dict(rect=(7.2, 4.0, 7.6, 7.5), depth=0.20)],
        beams=[dict(axis="x", at=2.6, span=(0, 7.0), depth=0.20, kind="steel", posts=[1.0, 6.0])],
        furnace=dict(x=9.85, y=6.55, face="W"), heater=dict(x=10.25, y=5.0), panel=dict(wall="N", room=2, at=2.2),
        laundry=dict(x=7.6, y=6.85, face="S"),
    ),
    dict(
        id="b5-tall-bright",
        about="Tall, bright, finished throughout: 2.60 m ceilings and two large escape windows.",
        seed=55, duration=62, subfloor=2.85, joists="y", exposure=0.0,
        walls_ext="poured", floor="concrete",
        rooms=[
            dict(name="Rec room", rect=(0, 0, 8.2, 5.6), ceiling=2.60, finish="drywall", floor="vinyl", clutter=4,
                 lights=[("pot", 1.6, 1.5), ("pot", 4.1, 1.5), ("pot", 6.6, 1.5), ("pot", 1.6, 3.6), ("pot", 4.1, 3.6), ("pot", 6.6, 3.6)]),
            dict(name="Furnace room", rect=(8.32, 0, 11.2, 3.4), ceiling=2.60, finish="drywall", clutter=2,
                 lights=[("bulb", 9.6, 1.7)]),
        ],
        stairs=dict(axis="x", line=5.6, side=-1, bottom=4.4, up=-1),
        doors=[dict(wall="E", room=0, at=1.5, width=0.86)],
        windows=[("S", 0, 2.4, 1.20, 0.90, 0.95), ("S", 0, 6.0, 1.20, 0.90, 0.95)],
        ducts=[dict(rect=(8.4, 2.3, 10.4, 2.7), depth=0.20, hang=0.015)],
        furnace=dict(x=10.45, y=2.6, face="W"), heater=dict(x=10.85, y=1.0), panel=dict(wall="S", room=1, at=1.5),
    ),
    dict(
        id="b6-dim-joists-ducts",
        about="Dim, unfinished, three rooms; a wood beam 6 mm under the clearance limit, an escape window that passes.",
        seed=66, duration=72, subfloor=2.33, joists="x", exposure=1.1,
        walls_ext="block", floor="concrete",
        rooms=[
            dict(name="Main room", rect=(0, 0, 6.6, 4.8), ceiling="joists", clutter=7,
                 lights=[("bulb", 2.2, 2.4), ("bulb", 4.8, 3.0)]),
            dict(name="Back room", rect=(0, 4.92, 3.6, 8.0), ceiling="joists", clutter=4,
                 lights=[("bulb", 1.8, 6.4)]),
            dict(name="Furnace room", rect=(3.72, 4.92, 6.6, 8.0), ceiling="joists", clutter=2,
                 lights=[("bulb", 5.0, 6.2)]),
        ],
        stairs=dict(axis="y", line=6.6, side=-1, bottom=3.9, up=-1),
        doors=[dict(wall="N", room=0, at=1.6, width=0.81), dict(wall="E", room=1, at=1.98, width=0.81)],
        windows=[("W", 0, 2.4, 0.90, 0.50, 1.40), ("W", 1, 1.6, 0.80, 0.40, 1.50), ("N", 2, 0.8, 0.60, 0.35, 1.55)],
        ducts=[dict(rect=(3.8, 0.3, 4.2, 4.6), depth=0.20)],
        beams=[dict(axis="y", at=3.3, span=(0, 4.8), depth=0.235, kind="wood", posts=[1.0, 3.8])],
        furnace=dict(x=5.8, y=7.2, face="S"), heater=dict(x=6.25, y=5.5), panel=dict(wall="W", room=2, at=1.0),
    ),
    dict(
        id="b7-old-low",
        about="Old low basement: joists at 1.86 m, ducts at 1.66 m, tiny windows, no full-height doors.",
        seed=77, duration=60, subfloor=2.095, joists="y", exposure=0.9,
        walls_ext="stone", floor="old",
        rooms=[
            dict(name="Main room", rect=(0, 0, 6.0, 4.4), ceiling="joists", clutter=7,
                 lights=[("bulb", 2.2, 1.6), ("bulb", 4.2, 3.0)]),
            dict(name="Furnace room", rect=(6.12, 0, 9.0, 4.4), ceiling="joists", clutter=2,
                 lights=[("bulb", 7.6, 2.2)]),
        ],
        stairs=dict(axis="y", line=0.0, side=1, bottom=3.0, up=-1, width=0.85),
        doors=[dict(wall="E", room=0, at=1.2, width=0.90, height=1.83, slab=False)],
        windows=[("N", 0, 3.0, 0.60, 0.30, 1.45), ("S", 0, 4.0, 0.60, 0.30, 1.45), ("E", 1, 2.2, 0.60, 0.30, 1.45)],
        ducts=[dict(rect=(0.9, 3.25, 6.0, 3.55), depth=0.20, hang=0.0)],
        furnace=dict(x=8.2, y=3.55, face="S"), heater=dict(x=8.65, y=1.0), panel=dict(wall="S", room=1, at=1.6),
    ),
    dict(
        id="b8-peek-storage",
        about="A storage room only looked into from its doorway, never entered: the plan has to infer it from the door.",
        seed=88, duration=58, subfloor=2.55, joists="y", exposure=0.4,
        walls_ext="poured", floor="concrete",
        rooms=[
            dict(name="Rec room", rect=(0, 0, 6.0, 4.6), ceiling=2.30, finish="drywall", floor="vinyl", clutter=5,
                 lights=[("pot", 1.6, 1.5), ("pot", 4.4, 1.5), ("pot", 1.6, 3.2), ("pot", 4.4, 3.2)]),
            dict(name="Furnace room", rect=(6.12, 0, 9.2, 3.0), ceiling="joists", clutter=2,
                 lights=[("bulb", 7.6, 1.5)]),
            # `peek`: the camera stops in the doorway, looks round the room and leaves.
            dict(name="Storage", rect=(6.12, 3.12, 9.2, 4.6), ceiling="joists", clutter=4, shelves=True, peek=True,
                 lights=[("bulb", 7.6, 3.9)]),
        ],
        stairs=dict(axis="x", line=4.6, side=-1, bottom=3.6, up=-1),
        doors=[dict(wall="E", room=0, at=1.5, width=0.81), dict(wall="N", room=1, at=1.2, width=0.76)],
        windows=[("S", 0, 2.0, 0.90, 0.60, 1.10), ("W", 0, 2.3, 0.80, 0.40, 1.50), ("E", 1, 1.5, 0.60, 0.35, 1.60),
                 ("N", 2, 2.2, 0.50, 0.30, 1.60)],
        ducts=[dict(rect=(0.5, 2.0, 5.5, 2.4), depth=0.22, hang=0.015)],
        furnace=dict(x=8.4, y=1.9, face="W"), heater=dict(x=8.8, y=0.5), panel=dict(wall="S", room=1, at=1.0),
    ),
]


# ---------------------------------------------------------------------------------------------
# Materials (procedural; object coordinates are world metres, since every object sits at the origin)
# ---------------------------------------------------------------------------------------------

_mats = {}


def _mix(nt, a, b, fac, blend="MIX"):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = blend
    m.inputs["Factor"].default_value = fac if isinstance(fac, float) else 1.0
    if not isinstance(fac, float):
        nt.links.new(fac, m.inputs["Factor"])
    for sock, val in ((m.inputs[6], a), (m.inputs[7], b)):  # A_Color, B_Color
        if isinstance(val, tuple):
            sock.default_value = (*val, 1.0)
        else:
            nt.links.new(val, sock)
    return next(s for s in m.outputs if s.type == "RGBA")


def material(name, color, rough=0.8, metal=0.0, kind="noise", scale=3.0, var=0.25, bump=0.15, aniso=(1, 1, 1), color2=None):
    if name in _mats:
        return _mats[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    pb = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    pb.inputs["Roughness"].default_value = rough
    pb.inputs["Metallic"].default_value = metal
    coord = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (aniso[0] * scale, aniso[1] * scale, aniso[2] * scale)
    nt.links.new(coord, mapping.inputs["Vector"])
    c2 = color2 or tuple(max(0.0, c * (1 - var)) for c in color)
    if kind == "brick":
        # Concrete block: 400 × 200 mm units. Wall plane coordinates from (x + y, z) work for both wall directions.
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(coord, sep.inputs["Vector"])
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        nt.links.new(sep.outputs["X"], add.inputs[0])
        nt.links.new(sep.outputs["Y"], add.inputs[1])
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(add.outputs[0], comb.inputs["X"])
        nt.links.new(sep.outputs["Z"], comb.inputs["Y"])
        brick = nt.nodes.new("ShaderNodeTexBrick")
        nt.links.new(comb.outputs[0], brick.inputs["Vector"])
        brick.inputs["Scale"].default_value = 1.0
        brick.inputs["Brick Width"].default_value = 0.40
        brick.inputs["Row Height"].default_value = 0.20
        brick.inputs["Mortar Size"].default_value = 0.008
        brick.inputs["Mortar Smooth"].default_value = 0.3
        brick.inputs["Color1"].default_value = (*color, 1)
        brick.inputs["Color2"].default_value = (*c2, 1)
        brick.inputs["Mortar"].default_value = (*(c * 0.8 for c in color), 1)
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 9.0
        noise.inputs["Detail"].default_value = 8.0
        nt.links.new(coord, noise.inputs["Vector"])
        dirt = nt.nodes.new("ShaderNodeValToRGB")
        dirt.color_ramp.elements[0].color = (0.82, 0.82, 0.82, 1)
        dirt.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(noise.outputs["Factor"], dirt.inputs["Fac"])
        base = _mix(nt, brick.outputs["Color"], dirt.outputs["Color"], 1.0, "MULTIPLY")
        height = brick.outputs["Factor"]
    else:
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 1.0
        noise.inputs["Detail"].default_value = 10.0
        noise.inputs["Roughness"].default_value = 0.62
        nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.3
        ramp.color_ramp.elements[1].position = 0.72
        ramp.color_ramp.elements[0].color = (*c2, 1)
        ramp.color_ramp.elements[1].color = (*color, 1)
        nt.links.new(noise.outputs["Factor"], ramp.inputs["Fac"])
        base = ramp.outputs["Color"]
        if kind == "stained":
            # Big soft blotches on top, like an old concrete floor.
            blot = nt.nodes.new("ShaderNodeTexNoise")
            blot.inputs["Scale"].default_value = 0.6
            blot.inputs["Detail"].default_value = 3.0
            nt.links.new(coord, blot.inputs["Vector"])
            br = nt.nodes.new("ShaderNodeValToRGB")
            br.color_ramp.elements[0].position = 0.45
            br.color_ramp.elements[1].position = 0.62
            br.color_ramp.elements[0].color = (0.72, 0.70, 0.66, 1)
            br.color_ramp.elements[1].color = (1, 1, 1, 1)
            nt.links.new(blot.outputs["Factor"], br.inputs["Fac"])
            base = _mix(nt, base, br.outputs["Color"], 1.0, "MULTIPLY")
        height = noise.outputs["Factor"]
    nt.links.new(base, pb.inputs["Base Color"])
    if bump > 0:
        b = nt.nodes.new("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump
        b.inputs["Distance"].default_value = 0.005
        nt.links.new(height, b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], pb.inputs["Normal"])
    _mats[name] = mat
    return mat


def emissive(name, color, strength, textured=False):
    if name in _mats:
        return _mats[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    if textured:
        # What you see through a basement window: gravel, a well wall, grass and sky, all bright.
        coord = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 1.5
        noise.inputs["Detail"].default_value = 2.0
        nt.links.new(coord, noise.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (0.55, 0.62, 0.48, 1)
        ramp.color_ramp.elements[1].color = (0.93, 0.95, 1.0, 1)
        nt.links.new(noise.outputs["Factor"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = (*color, 1)
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    _mats[name] = mat
    return mat


def glass():
    if "glass" in _mats:
        return _mats["glass"]
    mat = material("glass", (0.85, 0.9, 0.92), rough=0.04, kind="noise", var=0.02, bump=0)
    pb = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    pb.inputs["Alpha"].default_value = 0.12
    mat.surface_render_method = "DITHERED"
    return mat


def mats(cfg):
    """The palette for one basement."""
    ext = cfg["walls_ext"]
    return dict(
        poured=material("poured", (0.46, 0.45, 0.43), rough=0.9, scale=2.5, var=0.3, bump=0.25),
        block=material("block", (0.60, 0.59, 0.56), rough=0.9, kind="brick", var=0.08, bump=0.3),
        stone=material("stone", (0.70, 0.68, 0.63), rough=0.95, scale=1.6, var=0.45, bump=0.6),
        drywall=material("drywall", (0.74, 0.72, 0.68), rough=0.85, scale=1.2, var=0.04, bump=0.02),
        drywall_b=material("drywall_b", (0.68, 0.70, 0.70), rough=0.85, scale=1.2, var=0.04, bump=0.02),
        ceiling=material("ceiling", (0.82, 0.82, 0.80), rough=0.9, scale=1.2, var=0.03, bump=0.02),
        concrete=material("concrete_floor", (0.42, 0.41, 0.39), rough=0.75, kind="stained", scale=3.0, var=0.25, bump=0.05),
        old=material("old_floor", (0.38, 0.36, 0.33), rough=0.85, kind="stained", scale=4.0, var=0.4, bump=0.2),
        vinyl=material("vinyl", (0.45, 0.33, 0.22), rough=0.45, scale=1.4, var=0.35, bump=0.03, aniso=(0.5, 9, 1)),
        carpet=material("carpet", (0.30, 0.29, 0.27), rough=1.0, scale=40, var=0.25, bump=0.3),
        wood_x=material("wood_x", (0.62, 0.47, 0.30), rough=0.75, scale=3, var=0.3, bump=0.1, aniso=(0.3, 12, 12)),
        wood_y=material("wood_y", (0.62, 0.47, 0.30), rough=0.75, scale=3, var=0.3, bump=0.1, aniso=(12, 0.3, 12)),
        subfloor=material("subfloor", (0.55, 0.43, 0.29), rough=0.85, scale=6, var=0.35, bump=0.08),
        trim=material("trim", (0.86, 0.85, 0.82), rough=0.4, scale=1, var=0.02, bump=0),
        door=material("door", (0.80, 0.79, 0.76), rough=0.45, scale=1, var=0.03, bump=0),
        steel=material("steel", (0.18, 0.17, 0.17), rough=0.55, metal=0.6, scale=4, var=0.3, bump=0.05),
        galv=material("galv", (0.62, 0.63, 0.64), rough=0.35, metal=0.95, scale=5, var=0.15, bump=0.02),
        appliance=material("appliance", (0.80, 0.80, 0.78), rough=0.35, scale=2, var=0.05, bump=0.01),
        panel=material("panel", (0.50, 0.51, 0.52), rough=0.4, metal=0.6, scale=2, var=0.1, bump=0.01),
        pvc=material("pvc", (0.88, 0.88, 0.86), rough=0.3, scale=1, var=0.02, bump=0),
        black=material("black", (0.03, 0.03, 0.03), rough=0.5, scale=1, var=0.0, bump=0),
        cardboard=material("cardboard", (0.50, 0.37, 0.22), rough=0.85, scale=8, var=0.2, bump=0.05),
        cardboard_b=material("cardboard_b", (0.58, 0.45, 0.30), rough=0.85, scale=8, var=0.2, bump=0.05),
        bin_blue=material("bin_blue", (0.08, 0.18, 0.40), rough=0.35, scale=1, var=0.05, bump=0),
        bin_grey=material("bin_grey", (0.35, 0.36, 0.37), rough=0.4, scale=1, var=0.05, bump=0),
        bin_clear=material("bin_clear", (0.70, 0.72, 0.72), rough=0.25, scale=1, var=0.05, bump=0),
        fabric=material("fabric", (0.35, 0.30, 0.42), rough=1.0, scale=20, var=0.3, bump=0.2),
        rust=material("rust", (0.36, 0.13, 0.07), rough=0.7, metal=0.3, scale=5, var=0.4, bump=0.1),
        wall=material(ext if ext != "poured" else "poured", (0.46, 0.45, 0.43)),
        glass=glass(),
        window_frame=material("window_frame", (0.88, 0.88, 0.86), rough=0.4, scale=1, var=0.02, bump=0),
    )


# ---------------------------------------------------------------------------------------------
# Geometry: one mesh builder per object, many boxes inside it
# ---------------------------------------------------------------------------------------------

class MeshBuilder:
    def __init__(self, name):
        self.name, self.v, self.f, self.fm, self.mats = name, [], [], [], []

    def _m(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def poly(self, pts, mat):
        i = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(i, i + len(pts))))
        self.fm.append(self._m(mat))

    def hexa(self, p, mat):
        """Eight corners in box order: bottom 0-3 counter-clockwise from above, then top 4-7."""
        i = len(self.v)
        self.v += [tuple(q) for q in p]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.f.append(tuple(i + k for k in f))
            self.fm.append(self._m(mat))

    def box(self, x0, y0, z0, x1, y1, z1, mat):
        x0, x1 = min(x0, x1), max(x0, x1)
        y0, y1 = min(y0, y1), max(y0, y1)
        z0, z1 = min(z0, z1), max(z0, z1)
        self.hexa([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)

    def rbox(self, cx, cy, z0, w, d, h, angle, mat):
        """A box turned `angle` radians about its vertical centre line."""
        c, s = math.cos(angle), math.sin(angle)
        pts = []
        for z in (z0, z0 + h):
            for dx, dy in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)):
                pts.append((cx + dx * c - dy * s, cy + dx * s + dy * c, z))
        self.hexa(pts, mat)

    def tube(self, p0, p1, r, mat, seg=16, caps=True):
        p0, p1 = Vector(p0), Vector(p1)
        ax = (p1 - p0).normalized()
        u = ax.orthogonal().normalized()
        w = ax.cross(u)
        i = len(self.v)
        for p in (p0, p1):
            for k in range(seg):
                a = 2 * math.pi * k / seg
                self.v.append(tuple(p + r * (math.cos(a) * u + math.sin(a) * w)))
        for k in range(seg):
            k2 = (k + 1) % seg
            self.f.append((i + k, i + k2, i + seg + k2, i + seg + k))
            self.fm.append(self._m(mat))
        if caps:
            self.f.append(tuple(i + k for k in reversed(range(seg))))
            self.fm.append(self._m(mat))
            self.f.append(tuple(i + seg + k for k in range(seg)))
            self.fm.append(self._m(mat))

    def build(self, coll):
        if not self.f:
            return None
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.v, [], self.f)
        for m in self.mats:
            me.materials.append(m)
        me.polygons.foreach_set("material_index", self.fm)
        me.validate()
        me.update()
        ob = bpy.data.objects.new(self.name, me)
        coll.objects.link(ob)
        return ob


def ceiling_top(cfg, room):
    """Height of the room's ceiling surface: drywall, or the subfloor above exposed joists."""
    return cfg["subfloor"] if room["ceiling"] == "joists" else room["ceiling"]


def rule_ceiling(cfg, room):
    """What the ceiling rule measures: the joists' underside, or the drywall."""
    return round(cfg["subfloor"] - JOIST_D, 3) if room["ceiling"] == "joists" else room["ceiling"]


def subtract_rects(rect, holes):
    """Axis-aligned rectangle minus holes, as a list of rectangles."""
    out = [rect]
    for h in holes:
        nxt = []
        for (x0, y0, x1, y1) in out:
            hx0, hy0, hx1, hy1 = h
            if hx1 <= x0 or hx0 >= x1 or hy1 <= y0 or hy0 >= y1:
                nxt.append((x0, y0, x1, y1))
                continue
            if hy0 > y0:
                nxt.append((x0, y0, x1, hy0))
            if hy1 < y1:
                nxt.append((x0, hy1, x1, y1))
            my0, my1 = max(y0, hy0), min(y1, hy1)
            if hx0 > x0:
                nxt.append((x0, my0, hx0, my1))
            if hx1 < x1:
                nxt.append((hx1, my0, x1, my1))
        out = nxt
    return out


def overlap(a, b, gap=0.0):
    return a[0] < b[2] + gap and b[0] < a[2] + gap and a[1] < b[3] + gap and b[1] < a[3] + gap


def point_rect_dist(px, py, r):
    dx = max(r[0] - px, 0, px - r[2])
    dy = max(r[1] - py, 0, py - r[3])
    return math.hypot(dx, dy)


# ---------------------------------------------------------------------------------------------
# Stairs
# ---------------------------------------------------------------------------------------------

def stair_layout(cfg):
    st = cfg["stairs"]
    width = st.get("width", 0.92)
    rise = cfg["subfloor"] + 0.02  # to the upper floor
    n = math.ceil(rise / RISER_MAX)
    rh = rise / n
    run = (n - 1) * TREAD
    top = st["bottom"] + st["up"] * run
    a0, a1 = sorted((st["bottom"], top))
    c0, c1 = sorted((st["line"], st["line"] + st["side"] * width))
    lo, hi = sorted((top, top + st["up"] * 0.95))  # landing past the top step

    def rect(a_lo, a_hi):
        return (a_lo, c0, a_hi, c1) if st["axis"] == "x" else (c0, a_lo, c1, a_hi)

    def at(along, across):
        return (along, across) if st["axis"] == "x" else (across, along)

    return dict(axis=st["axis"], up=st["up"], bottom=st["bottom"], top=top, n=n, rh=rh, rise=rise, width=width,
                c0=c0, c1=c1, wall_side=st["line"], open_side=st["line"] + st["side"] * width,
                footprint=rect(a0, a1), landing=rect(lo, hi), at=at)


def build_stairs(cfg, S, M, coll):
    b = MeshBuilder("Stairs")
    axis, up, n, rh = S["axis"], S["up"], S["n"], S["rh"]
    wood = M["wood_x"] if axis == "x" else M["wood_y"]
    for i in range(1, n):
        a_front = S["bottom"] + up * (i - 1) * TREAD - up * 0.025  # nosing
        a_back = S["bottom"] + up * i * TREAD
        z = i * rh
        p0, p1 = S["at"](a_front, S["c0"] + 0.04), S["at"](a_back, S["c1"] - 0.04)
        b.box(p0[0], p0[1], z - 0.03, p1[0], p1[1], z, wood)
        # Closed riser under the nosing
        r0 = S["at"](S["bottom"] + up * (i - 1) * TREAD, S["c0"] + 0.04)
        r1 = S["at"](S["bottom"] + up * (i - 1) * TREAD + up * 0.02, S["c1"] - 0.04)
        b.box(r0[0], r0[1], (i - 1) * rh, r1[0], r1[1], z - 0.03, M["subfloor"])
    # Two stringers along the run
    for across in (S["c0"], S["c1"] - 0.04):
        pts = []
        quad = [(S["bottom"] - up * 0.02, 0.0), (S["bottom"] - up * 0.02, rh + 0.02), (S["top"], S["rise"]), (S["top"], S["rise"] - 0.30)]
        for zc in (across, across + 0.04):
            for (a, z) in quad:
                x, y = S["at"](a, zc)
                pts.append((x, y, z))
        # hexa wants bottom-face then top-face corners; here the two sides of the board play those parts
        p = [pts[0], pts[4], pts[7], pts[3], pts[1], pts[5], pts[6], pts[2]]
        b.hexa(p, wood)
    # Handrail on the open side, with a newel post at the bottom
    o = S["open_side"] - (0.03 if S["open_side"] > S["wall_side"] else -0.03)
    p_lo = S["at"](S["bottom"] + up * 0.15, o)
    p_hi = S["at"](S["top"] + up * 0.1, o)
    b.tube((p_lo[0], p_lo[1], rh + 0.86), (p_hi[0], p_hi[1], S["rise"] + 0.9), 0.025, wood, seg=10)
    post = S["at"](S["bottom"] + up * 0.05, o)
    b.box(post[0] - 0.04, post[1] - 0.04, 0, post[0] + 0.04, post[1] + 0.04, rh + 0.95, wood)
    # Upper landing floor
    L = S["landing"]
    b.box(L[0] - 0.01, L[1], S["rise"] - 0.03, L[2] + 0.01, L[3], S["rise"], M["vinyl"])
    b.build(coll)


# ---------------------------------------------------------------------------------------------
# The house: walls by boolean (solid block minus rooms, stairwell, doors and windows)
# ---------------------------------------------------------------------------------------------

WALL_DIRS = {"N": (0, 1), "S": (0, -1), "E": (1, 0), "W": (-1, 0)}


def wall_frame(room_rect, wall, at):
    """Point on a wall's inner face `at` metres along it, plus the outward normal and along-wall axis."""
    x0, y0, x1, y1 = room_rect
    if wall == "N":
        return (x0 + at, y1), (0, 1), (1, 0)
    if wall == "S":
        return (x0 + at, y0), (0, -1), (1, 0)
    if wall == "E":
        return (x1, y0 + at), (1, 0), (0, 1)
    return (x0, y0 + at), (-1, 0), (0, 1)


def slab_box(b, origin, normal, along, a0, a1, n0, n1, z0, z1, mat):
    """Box spanning a0..a1 along the wall and n0..n1 out from its face."""
    ox, oy = origin
    pts = [(ox + along[0] * a + normal[0] * n, oy + along[1] * a + normal[1] * n) for a, n in ((a0, n0), (a1, n1))]
    b.box(pts[0][0], pts[0][1], z0, pts[1][0], pts[1][1], z1, mat)


def build_house(cfg, M, coll, cutters_coll, S):
    rooms = cfg["rooms"]
    xs = [r["rect"][0] for r in rooms] + [r["rect"][2] for r in rooms]
    ys = [r["rect"][1] for r in rooms] + [r["rect"][3] for r in rooms]
    top = cfg["subfloor"] + 0.02 + TOPLESS
    block = MeshBuilder("Walls")
    block.box(min(xs) - 1.6, min(ys) - 1.6, -0.1, max(xs) + 1.6, max(ys) + 1.6, top, M["drywall"])
    walls = block.build(coll)

    cut = MeshBuilder("Cutters")
    for ri, r in enumerate(rooms):
        x0, y0, x1, y1 = r["rect"]
        wall_mat = (M["drywall"] if ri % 2 == 0 else M["drywall_b"]) if r.get("finish") == "drywall" else M["wall"]
        cut.box(x0, y0, -0.05, x1, y1, ceiling_top(cfg, r) + 0.05, wall_mat)
    # Stairwell up to the floor above, and the landing at the top
    room0_top = ceiling_top(cfg, rooms[0])
    F, L = S["footprint"], S["landing"]
    cut.box(F[0], F[1], room0_top - 0.05, F[2], F[3], top - 0.15, M["drywall"])
    cut.box(L[0], L[1], S["rise"], L[2], L[3], top - 0.15, M["drywall"])
    # Doors: jamb-lined openings through the partition
    for d in cfg.get("doors", []):
        r = rooms[d["room"]]
        o, nrm, al = wall_frame(r["rect"], d["wall"], d["at"])
        h = d.get("height", DOOR_H + 0.02)
        w = d["width"] + 0.04
        slab_box(cut, o, nrm, al, -w / 2, w / 2, -0.05, INT_WALL + 0.05, -0.05, h, M["trim"])
    # Windows: rough openings through the foundation
    day = emissive("daylight", (1, 1, 1), 6.0, textured=True)
    for (wall, ri, at, w, h, sill) in cfg["windows"]:
        o, nrm, al = wall_frame(rooms[ri]["rect"], wall, at)
        slab_box(cut, o, nrm, al, -w / 2 - 0.05, w / 2 + 0.05, -0.05, EXT_WALL + 0.05, sill - 0.05, sill + h + 0.05, M["wall"])
        # The window well beyond: everything seen through the glass is bright daylight
        slab_box(cut, o, nrm, al, -w / 2 - 0.7, w / 2 + 0.7, EXT_WALL, EXT_WALL + 0.8, sill - 0.5, sill + h + 1.0, day)
    cutters = cut.build(cutters_coll)

    mod = walls.modifiers.new("rooms", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutters
    mod.material_mode = "TRANSFER"
    mod.use_self = True  # the cutter boxes overlap each other
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(walls.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    walls.modifiers.clear()
    old = walls.data
    walls.data = baked
    bpy.data.meshes.remove(old)
    cutters_coll.hide_render = True
    bpy.data.objects.remove(cutters)
    return walls


def build_room_surfaces(cfg, M, coll, S):
    """Floors, ceilings (drywall or exposed joists), baseboards, bulkheads, ducts, beams and posts."""
    b = MeshBuilder("Surfaces")
    j = MeshBuilder("Joists")
    opening = S["footprint"]
    under = cfg["subfloor"] - JOIST_D
    for ri, r in enumerate(cfg["rooms"]):
        x0, y0, x1, y1 = r["rect"]
        floor = M[r.get("floor", cfg["floor"])]
        b.box(x0 - 0.01, y0 - 0.01, -0.02, x1 + 0.01, y1 + 0.01, 0.0, floor)
        holes = [opening] if ri == 0 else []
        if r["ceiling"] == "joists":
            for (a0, b0, a1, b1) in subtract_rects(r["rect"], holes):
                b.box(a0, b0, cfg["subfloor"], a1, b1, cfg["subfloor"] + 0.02, M["subfloor"])
            # Joists span one way across the room; ones that cross the stair opening stop at a header.
            wood = M["wood_x"] if cfg["joists"] == "x" else M["wood_y"]
            if cfg["joists"] == "y":
                pos = x0 + 0.2
                while pos < x1 - 0.05:
                    segs = subtract_rects((pos - JOIST_W / 2, y0, pos + JOIST_W / 2, y1), holes)
                    for (a0, b0, a1, b1) in segs:
                        j.box(a0, b0 - 0.05, under, a1, b1 + 0.05, cfg["subfloor"], wood)
                    pos += JOIST_GAP
            else:
                pos = y0 + 0.2
                while pos < y1 - 0.05:
                    segs = subtract_rects((x0, pos - JOIST_W / 2, x1, pos + JOIST_W / 2), holes)
                    for (a0, b0, a1, b1) in segs:
                        j.box(a0 - 0.05, b0, under, a1 + 0.05, b1, cfg["subfloor"], wood)
                    pos += JOIST_GAP
            for h in holes:
                hx0, hy0, hx1, hy1 = h
                # Doubled headers around the opening
                for (a0, b0, a1, b1) in ((hx0, hy0 - 0.08, hx1, hy0), (hx0, hy1, hx1, hy1 + 0.08), (hx0 - 0.08, hy0, hx0, hy1), (hx1, hy0, hx1 + 0.08, hy1)):
                    a0, b0, a1, b1 = max(a0, x0), max(b0, y0), min(a1, x1), min(b1, y1)
                    if a1 - a0 > 0.01 and b1 - b0 > 0.01:
                        j.box(a0, b0, under, a1, b1, cfg["subfloor"], wood)
        else:
            c = r["ceiling"]
            for (a0, b0, a1, b1) in subtract_rects(r["rect"], holes):
                b.box(a0, b0, c, a1, b1, c + 0.016, M["ceiling"])
            # Baseboards along finished walls
            for (a0, b0, a1, b1) in ((x0, y0, x1, y0 + 0.012), (x0, y1 - 0.012, x1, y1), (x0, y0, x0 + 0.012, y1), (x1 - 0.012, y0, x1, y1)):
                b.box(a0, b0, 0, a1, b1, 0.09, M["trim"])
    for bh in cfg.get("bulkheads", []):
        r = cfg["rooms"][bh["room"]]
        a0, b0, a1, b1 = bh["rect"]
        b.box(a0, b0, bh["bottom"], a1, b1, ceiling_top(cfg, r) + 0.01, M["ceiling"])
    for d in cfg.get("ducts", []):
        a0, b0, a1, b1 = d["rect"]
        hang = d.get("hang", 0.0)
        z1 = under - hang
        b.box(a0, b0, z1 - d["depth"], a1, b1, z1, M["galv"])
        # Seams every 1.5 m read like real trunk sections
        long_x = (a1 - a0) > (b1 - b0)
        k = 1.5
        while k < (a1 - a0 if long_x else b1 - b0):
            if long_x:
                b.box(a0 + k - 0.01, b0 - 0.006, z1 - d["depth"] - 0.006, a0 + k + 0.01, b1 + 0.006, z1, M["galv"])
            else:
                b.box(a0 - 0.006, b0 + k - 0.01, z1 - d["depth"] - 0.006, a1 + 0.006, b0 + k + 0.01, z1, M["galv"])
            k += 1.5
    for bm in cfg.get("beams", []):
        lo, hi = bm["span"]
        top = under
        bot = top - bm["depth"]
        def along(a0, a1, c0, c1, z0, z1, mat):
            if bm["axis"] == "x":
                b.box(a0, c0, z0, a1, c1, z1, mat)
            else:
                b.box(c0, a0, z0, c1, a1, z1, mat)
        c = bm["at"]
        if bm["kind"] == "steel":
            along(lo, hi, c - 0.065, c + 0.065, bot, bot + 0.012, M["steel"])
            along(lo, hi, c - 0.065, c + 0.065, top - 0.012, top, M["steel"])
            along(lo, hi, c - 0.004, c + 0.004, bot, top, M["steel"])
        else:
            for k in range(3):  # three 2×10s nailed together
                along(lo, hi, c - 0.057 + k * 0.038, c - 0.057 + (k + 1) * 0.038 - 0.002, bot, top, M["wood_x" if bm["axis"] == "x" else "wood_y"])
        for p in bm.get("posts", []):
            x, y = (p, c) if bm["axis"] == "x" else (c, p)
            b.tube((x, y, 0), (x, y, bot), 0.045, M["steel"], seg=14)
            b.box(x - 0.08, y - 0.08, bot - 0.008, x + 0.08, y + 0.08, bot, M["steel"])
    b.build(coll)
    j.build(coll)


def build_doors(cfg, M, coll):
    b = MeshBuilder("Doors")
    for d in cfg.get("doors", []):
        r = cfg["rooms"][d["room"]]
        o, nrm, al = wall_frame(r["rect"], d["wall"], d["at"])
        w, h = d["width"], d.get("height", DOOR_H + 0.02)
        t = INT_WALL
        # Jambs and head, lining the opening
        slab_box(b, o, nrm, al, -w / 2 - 0.02, -w / 2, 0, t, 0, h, M["trim"])
        slab_box(b, o, nrm, al, w / 2, w / 2 + 0.02, 0, t, 0, h, M["trim"])
        slab_box(b, o, nrm, al, -w / 2 - 0.02, w / 2 + 0.02, 0, t, h - 0.02, h, M["trim"])
        # Casing on both faces
        for n0, n1 in ((-0.015, 0.0), (t, t + 0.015)):
            slab_box(b, o, nrm, al, -w / 2 - 0.09, -w / 2 - 0.02, n0, n1, 0, h + 0.07, M["trim"])
            slab_box(b, o, nrm, al, w / 2 + 0.02, w / 2 + 0.09, n0, n1, 0, h + 0.07, M["trim"])
            slab_box(b, o, nrm, al, -w / 2 - 0.09, w / 2 + 0.09, n0, n1, h, h + 0.07, M["trim"])
        if d.get("slab", True):
            # The door stands open into the next room, hinged on one side, at about 80 degrees.
            hinge = (o[0] + al[0] * (-w / 2) + nrm[0] * (t + 0.02), o[1] + al[1] * (-w / 2) + nrm[1] * (t + 0.02))
            toward_wall = -1 if nrm[0] * al[1] - nrm[1] * al[0] > 0 else 1
            ang = math.atan2(nrm[1], nrm[0]) + toward_wall * math.radians(10)
            cx = hinge[0] + math.cos(ang) * w / 2
            cy = hinge[1] + math.sin(ang) * w / 2
            b.rbox(cx, cy, 0.01, w, 0.035, DOOR_H, ang, M["door"])
            # Knob
            kx = hinge[0] + math.cos(ang) * (w - 0.07)
            ky = hinge[1] + math.sin(ang) * (w - 0.07)
            b.tube((kx - 0.05 * math.sin(ang), ky + 0.05 * math.cos(ang), 0.92), (kx + 0.05 * math.sin(ang), ky - 0.05 * math.cos(ang), 0.92), 0.025, M["galv"], seg=10)
    b.build(coll)


def build_windows(cfg, M, coll, lights):
    """Each window: a frame and glass in the foundation, daylight beyond, and a light coming in."""
    info = []
    for k, (wall, ri, at, w, h, sill) in enumerate(cfg["windows"]):
        o, nrm, al = wall_frame(cfg["rooms"][ri]["rect"], wall, at)
        f = 0.05  # frame width; the clear opening is w × h inside it
        n0, n1 = 0.14, 0.20
        wb = MeshBuilder(f"Window.{k}")
        slab_box(wb, o, nrm, al, -w / 2 - f, -w / 2, n0, n1, sill - f, sill + h + f, M["window_frame"])
        slab_box(wb, o, nrm, al, w / 2, w / 2 + f, n0, n1, sill - f, sill + h + f, M["window_frame"])
        slab_box(wb, o, nrm, al, -w / 2, w / 2, n0, n1, sill - f, sill, M["window_frame"])
        slab_box(wb, o, nrm, al, -w / 2, w / 2, n0, n1, sill + h, sill + h + f, M["window_frame"])
        slab_box(wb, o, nrm, al, -w / 2, w / 2, 0.168, 0.172, sill, sill + h, M["glass"])
        wb.build(coll)
        # Daylight through the opening, aimed into the room and a little down
        lx, ly = o[0] + nrm[0] * 0.24, o[1] + nrm[1] * 0.24
        lights.append(dict(kind="window", x=lx, y=ly, z=sill + h / 2, w=w, h=h, normal=nrm, area=w * h))
        corners = [(o[0] + al[0] * a + nrm[0] * 0.17, o[1] + al[1] * a + nrm[1] * 0.17, z) for a, z in ((-w / 2, sill), (w / 2, sill), (w / 2, sill + h), (-w / 2, sill + h))]
        info.append(dict(id=f"w{k + 1}", room=ri, wall=wall, corners=corners, center=(o[0] + nrm[0] * 0.17, o[1] + nrm[1] * 0.17, sill + h / 2)))
    return info


def build_fixtures(cfg, M, coll):
    """Furnace, water heater, electrical panel, laundry and workbench. Returns their plan footprints."""
    b = MeshBuilder("Fixtures")
    obstacles = []
    under = cfg["subfloor"] - JOIST_D
    fu = cfg.get("furnace")
    if fu:
        w, d, h = 0.56, 0.74, 1.30
        x, y = fu["x"], fu["y"]
        x1, y1 = x + (w if fu["face"] in "NS" else d), y + (d if fu["face"] in "NS" else w)
        b.box(x, y, 0, x1, y1, h, M["appliance"])
        # Front panel seam, and louvres
        fx = {"S": (x + 0.03, y - 0.004, x1 - 0.03, y), "N": (x + 0.03, y1, x1 - 0.03, y1 + 0.004),
              "W": (x - 0.004, y + 0.03, x, y1 - 0.03), "E": (x1, y + 0.03, x1 + 0.004, y1 - 0.03)}[fu["face"]]
        b.box(fx[0], fx[1], 0.62, fx[2], fx[3], 0.64, M["black"])
        for k in range(5):
            b.box(fx[0], fx[1], 0.95 + k * 0.05, fx[2], fx[3], 0.965 + k * 0.05, M["black"])
        # Supply plenum up to the joists, and two white PVC flues
        b.box(x + 0.04, y + 0.04, h, x1 - 0.04, y1 - 0.04, under, M["galv"])
        fx_, fy_ = (x - 0.07, (y + y1) / 2) if fu["face"] in "NS" else ((x + x1) / 2, y - 0.07)
        for k in (0, 1):
            off = (0, 0.11 * k) if fu["face"] in "NS" else (0.11 * k, 0)
            b.tube((fx_ + off[0], fy_ + off[1], 0.55), (fx_ + off[0], fy_ + off[1], under), 0.038, M["pvc"], seg=12)
        obstacles.append((x, y, x1, y1))
    he = cfg.get("heater")
    if he:
        b.tube((he["x"], he["y"], 0), (he["x"], he["y"], 1.45), 0.28, M["appliance"], seg=24)
        b.tube((he["x"], he["y"], 1.45), (he["x"], he["y"], under), 0.05, M["galv"], seg=12)
        b.tube((he["x"] + 0.18, he["y"], 0.3), (he["x"] + 0.18, he["y"], 0.42), 0.06, M["galv"], seg=12)
        obstacles.append((he["x"] - 0.3, he["y"] - 0.3, he["x"] + 0.3, he["y"] + 0.3))
    pa = cfg.get("panel")
    if pa:
        r = cfg["rooms"][pa["room"]]
        o, nrm, al = wall_frame(r["rect"], pa["wall"], pa["at"])
        slab_box(b, o, nrm, al, -0.18, 0.18, -0.10, 0.0, 1.05, 1.81, M["panel"])
        slab_box(b, o, nrm, al, -0.16, 0.16, -0.103, -0.10, 1.08, 1.78, M["panel"])
        slab_box(b, o, nrm, al, -0.12, 0.12, -0.104, -0.103, 1.40, 1.42, M["black"])
        for a in (-0.12, -0.04, 0.05, 0.13):  # conduit up to the joists
            slab_box(b, o, nrm, al, a - 0.012, a + 0.012, -0.05, -0.026, 1.81, under, M["galv"])
    la = cfg.get("laundry")
    if la:
        x, y = la["x"], la["y"]
        for k in range(2):
            b.box(x + k * 0.71, y, 0, x + k * 0.71 + 0.69, y + 0.7, 0.94, M["appliance"])
            dz = y if la["face"] == "S" else y + 0.7
            b.tube((x + k * 0.71 + 0.345, dz - 0.01, 0.55), (x + k * 0.71 + 0.345, dz + 0.01, 0.55), 0.18, M["black"], seg=20)
        obstacles.append((x, y, x + 1.41, y + 0.7))
    for r in cfg["rooms"]:
        be = r.get("bench")
        if be:
            be = be["rect"]
            a0, b0, a1, b1 = be
            b.box(a0, b0, 0.86, a1, b1, 0.90, M["wood_y"])
            for (px, py) in ((a0 + 0.05, b0 + 0.05), (a1 - 0.05, b0 + 0.05), (a0 + 0.05, b1 - 0.05), (a1 - 0.05, b1 - 0.05)):
                b.box(px - 0.035, py - 0.035, 0, px + 0.035, py + 0.035, 0.86, M["wood_y"])
            b.box(a0 + 0.05, b0 + 0.05, 0.18, a1 - 0.05, b1 - 0.05, 0.2, M["subfloor"])
            obstacles.append(be)
    b.build(coll)
    return obstacles


def build_lights(cfg, M, coll, lights_extra):
    b = MeshBuilder("Fixtures.lights")
    bulb = emissive("bulb", (1.0, 0.86, 0.66), 40.0)
    tube = emissive("tube", (0.92, 0.96, 1.0), 25.0)
    pot = emissive("pot", (1.0, 0.92, 0.80), 30.0)
    dim = cfg.get("dim", 1.0)
    for ri, r in enumerate(cfg["rooms"]):
        top = ceiling_top(cfg, r)
        exposed = r["ceiling"] == "joists"
        low = cfg["subfloor"] - JOIST_D if exposed else top
        for (kind, x, y) in r["lights"]:
            if kind == "bulb":
                # Porcelain lampholder on a joist, bare bulb hanging below the joists
                z = low - 0.06
                b.tube((x, y, z + 0.05), (x, y, low + 0.02), 0.045, M["pvc"], seg=14)
                b.tube((x, y, z - 0.07), (x, y, z + 0.05), 0.03, bulb, seg=12)
                add_light(coll, "POINT", (x, y, z - 0.04), 75 * dim, (1.0, 0.80, 0.58), radius=0.03)
            elif kind == "flush":
                b.tube((x, y, top - 0.07), (x, y, top), 0.17, M["bin_clear"], seg=24)
                add_light(coll, "POINT", (x, y, top - 0.13), 100 * dim, (1.0, 0.85, 0.66), radius=0.05)
            elif kind == "tube":
                z = low - 0.07
                b.box(x - 0.62, y - 0.08, z, x + 0.62, y + 0.08, z + 0.06, M["appliance"])
                b.box(x - 0.6, y - 0.05, z - 0.01, x + 0.6, y + 0.05, z, tube)
                add_light(coll, "AREA", (x, y, z - 0.02), 90 * dim, (0.92, 0.96, 1.0), size=(1.2, 0.1))
            elif kind == "pot":
                b.tube((x, y, top - 0.002), (x, y, top + 0.001), 0.07, pot, seg=20)
                b.tube((x, y, top - 0.006), (x, y, top - 0.002), 0.085, M["trim"], seg=20, caps=False)
                add_light(coll, "SPOT", (x, y, top - 0.02), 80 * dim, (1.0, 0.88, 0.72), radius=0.05, spot=math.radians(110))
    ob = b.build(coll)
    if ob:
        ob.visible_shadow = False
    # A light in the stairwell ceiling, over the upper half of the flight
    S = cfg["_stairs"]
    lx, ly = S["at"](S["top"] + (S["bottom"] - S["top"]) * 0.3, (S["c0"] + S["c1"]) / 2)
    add_light(coll, "POINT", (lx, ly, S["rise"] + TOPLESS - 0.3), 90 * dim, (1.0, 0.86, 0.66), radius=0.08)
    for w in lights_extra:
        # Overcast daylight: an area light just outside the glass, facing in and slightly down
        nx, ny = w["normal"]
        ob = add_light(coll, "AREA", (w["x"], w["y"], w["z"]), 220 * w["area"] * cfg.get("daylight", 1.0), (0.92, 0.95, 1.0), size=(max(w["w"], w["h"]), min(w["w"], w["h"])))
        direction = Vector((-nx, -ny, -0.35)).normalized()
        ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_light(coll, kind, loc, power, color, radius=0.05, size=None, spot=None):
    ld = bpy.data.lights.new(f"{kind.lower()}", kind)
    ld.energy = power
    ld.color = color
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = radius
    if kind == "SPOT":
        ld.spot_size = spot
        ld.spot_blend = 0.6
    if kind == "AREA":
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size
    ob = bpy.data.objects.new(ld.name, ld)
    ob.location = loc
    coll.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------------------------
# Clutter, placed along the walls after the camera path is known so nothing blocks it
# ---------------------------------------------------------------------------------------------

def clutter_item(rng, M):
    """A random basement thing: (kind, width, depth, height, draw(builder, x0, y0, x1, y1))."""
    kind = rng.choice(["boxes", "boxes", "bins", "cans", "dresser", "chair", "dehumidifier", "tree_box", "rug", "boxes"])
    if kind == "boxes":
        n = rng.randint(1, 3)
        sizes = [(rng.uniform(0.35, 0.6), rng.uniform(0.3, 0.5), rng.uniform(0.25, 0.42)) for _ in range(n)]
        w, d = max(s[0] for s in sizes), max(s[1] for s in sizes)
        h = sum(s[2] for s in sizes)

        def draw(b, x0, y0, x1, y1):
            z = 0
            for (sw, sd, sh) in sizes:
                cx, cy = (x0 + x1) / 2 + rng.uniform(-0.03, 0.03), (y0 + y1) / 2 + rng.uniform(-0.03, 0.03)
                ww, dd = (sw, sd) if (x1 - x0) >= (y1 - y0) else (sd, sw)
                b.rbox(cx, cy, z, ww, dd, sh, rng.uniform(-0.08, 0.08), rng.choice([M["cardboard"], M["cardboard_b"]]))
                b.rbox(cx, cy, z + sh - 0.002, ww * 0.08, dd + 0.004, 0.004, 0, M["bin_clear"])
                z += sh
        return kind, w, d, h, draw
    if kind == "bins":
        n = rng.randint(2, 3)
        mat = rng.choice([M["bin_blue"], M["bin_grey"], M["bin_clear"]])

        def draw(b, x0, y0, x1, y1):
            for k in range(n):
                b.box(x0 + 0.02, y0 + 0.02, k * 0.31, x1 - 0.02, y1 - 0.02, k * 0.31 + 0.28, mat)
                b.box(x0, y0, k * 0.31 + 0.28, x1, y1, k * 0.31 + 0.31, mat)
        return kind, 0.62, 0.42, n * 0.31, draw
    if kind == "cans":
        def draw(b, x0, y0, x1, y1):
            for k in range(4):
                cx, cy = x0 + 0.1 + (k % 2) * 0.19, y0 + 0.1 + (k // 2) * 0.19
                b.tube((cx, cy, 0), (cx, cy, 0.19), 0.085, rng.choice([M["galv"], M["appliance"], M["rust"]]), seg=16)
        return kind, 0.4, 0.4, 0.2, draw
    if kind == "dresser":
        def draw(b, x0, y0, x1, y1):
            b.box(x0, y0, 0.05, x1, y1, 0.8, M["wood_x"])
            long_x = (x1 - x0) >= (y1 - y0)
            for k in range(3):
                z = 0.12 + k * 0.23
                if long_x:
                    b.box(x0 + 0.05, y0 - 0.005, z, x1 - 0.05, y1 + 0.005, z + 0.012, M["black"])
                else:
                    b.box(x0 - 0.005, y0 + 0.05, z, x1 + 0.005, y1 - 0.05, z + 0.012, M["black"])
        return kind, 0.9, 0.45, 0.8, draw
    if kind == "chair":
        def draw(b, x0, y0, x1, y1):
            b.box(x0, y0, 0.44, x1, y1, 0.47, M["fabric"])
            for (px, py) in ((x0, y0), (x1 - 0.03, y0), (x0, y1 - 0.03), (x1 - 0.03, y1 - 0.03)):
                b.box(px, py, 0, px + 0.03, py + 0.03, 0.44, M["steel"])
            b.box(x0, y1 - 0.03, 0.47, x1, y1, 0.9, M["fabric"])
        return kind, 0.45, 0.45, 0.9, draw
    if kind == "dehumidifier":
        def draw(b, x0, y0, x1, y1):
            b.box(x0, y0, 0, x1, y1, 0.6, M["appliance"])
            b.box(x0 + 0.04, y0 - 0.003, 0.4, x1 - 0.04, y1 + 0.003, 0.55, M["black"])
        return kind, 0.36, 0.28, 0.6, draw
    if kind == "tree_box":
        def draw(b, x0, y0, x1, y1):
            b.box(x0, y0, 0, x1, y1, 0.32, M["cardboard_b"])
        return kind, 1.5, 0.32, 0.32, draw

    def draw(b, x0, y0, x1, y1):  # rolled rug lying along the wall
        long_x = (x1 - x0) >= (y1 - y0)
        cz = 0.12
        if long_x:
            b.tube((x0, (y0 + y1) / 2, cz), (x1, (y0 + y1) / 2, cz), 0.12, M["fabric"], seg=18)
        else:
            b.tube(((x0 + x1) / 2, y0, cz), ((x0 + x1) / 2, y1, cz), 0.12, M["fabric"], seg=18)
    return "rug", 1.6, 0.26, 0.26, draw


def shelf_unit(b, M, x0, y0, x1, y1, rng):
    h = 1.8
    for (px, py) in ((x0, y0), (x1 - 0.025, y0), (x0, y1 - 0.025), (x1 - 0.025, y1 - 0.025)):
        b.box(px, py, 0, px + 0.025, py + 0.025, h, M["steel"])
    for k in range(4):
        z = 0.1 + k * 0.55
        b.box(x0, y0, z, x1, y1, z + 0.02, M["galv"])
        if k < 3:
            long_x = (x1 - x0) >= (y1 - y0)
            span = (x1 - x0) if long_x else (y1 - y0)
            a = 0.03
            while a < span - 0.25:
                bw = rng.uniform(0.25, 0.4)
                bh = rng.uniform(0.18, 0.38)
                mat = rng.choice([M["cardboard"], M["cardboard_b"], M["bin_blue"], M["bin_grey"]])
                if long_x:
                    b.box(x0 + a, y0 + 0.03, z + 0.02, x0 + a + bw, y1 - 0.03, z + 0.02 + bh, mat)
                else:
                    b.box(x0 + 0.03, y0 + a, z + 0.02, x1 - 0.03, y0 + a + bw, z + 0.02 + bh, mat)
                a += bw + rng.uniform(0.02, 0.12)


def place_clutter(cfg, M, coll, path_xy, obstacles, windows_info):
    rng = random.Random(cfg["seed"])
    b = MeshBuilder("Clutter")
    placed = []
    blocked = list(obstacles)
    S = cfg["_stairs"]
    blocked.append(S["footprint"])
    # Keep doorways clear
    for d in cfg.get("doors", []):
        r = cfg["rooms"][d["room"]]
        o, nrm, al = wall_frame(r["rect"], d["wall"], d["at"])
        pts = [(o[0] + al[0] * a + nrm[0] * n, o[1] + al[1] * a + nrm[1] * n) for a, n in ((-d["width"] / 2 - 0.45, -1.3), (d["width"] / 2 + 0.45, INT_WALL + 1.3))]
        blocked.append((min(pts[0][0], pts[1][0]), min(pts[0][1], pts[1][1]), max(pts[0][0], pts[1][0]), max(pts[0][1], pts[1][1])))
    for ri, r in enumerate(cfg["rooms"]):
        x0, y0, x1, y1 = r["rect"]
        want = r.get("clutter", 0)
        if r.get("shelves"):
            # A run of steel shelving along the longest free wall
            for wall in ("N", "W", "E", "S"):
                L = (x1 - x0) if wall in "NS" else (y1 - y0)
                for start in [a * 0.1 for a in range(int((L - 1.2) * 10) + 1)]:
                    o, nrm, al = wall_frame(r["rect"], wall, start + 0.6)
                    pts = [(o[0] + al[0] * a - nrm[0] * n, o[1] + al[1] * a - nrm[1] * n) for a, n in ((-0.6, 0.02), (0.6, 0.48))]
                    rect = (min(pts[0][0], pts[1][0]), min(pts[0][1], pts[1][1]), max(pts[0][0], pts[1][0]), max(pts[0][1], pts[1][1]))
                    if ok_spot(rect, 1.8, wall, ri, blocked, placed, path_xy, windows_info, cfg):
                        shelf_unit(b, M, *rect, rng)
                        placed.append(rect)
                        break
                else:
                    continue
                break
        tries = 0
        n = 0
        while n < want and tries < 400:
            tries += 1
            kind, w, d, h, draw = clutter_item(rng, M)
            wall = rng.choice("NSEW")
            L = (x1 - x0) if wall in "NS" else (y1 - y0)
            if w + 0.1 > L:
                continue
            at = rng.uniform(w / 2 + 0.05, L - w / 2 - 0.05)
            gap = rng.uniform(0.02, 0.12)
            o, nrm, al = wall_frame(r["rect"], wall, at)
            pts = [(o[0] + al[0] * a - nrm[0] * nn, o[1] + al[1] * a - nrm[1] * nn) for a, nn in ((-w / 2, gap), (w / 2, gap + d))]
            rect = (min(pts[0][0], pts[1][0]), min(pts[0][1], pts[1][1]), max(pts[0][0], pts[1][0]), max(pts[0][1], pts[1][1]))
            if not ok_spot(rect, h, wall, ri, blocked, placed, path_xy, windows_info, cfg):
                continue
            draw(b, *rect)
            placed.append(rect)
            n += 1
        if n < want:
            print(f"[{cfg['id']}] {r['name']}: placed {n} of {want} clutter items")
    b.build(coll)
    return placed


def ok_spot(rect, h, wall, ri, blocked, placed, path_xy, windows_info, cfg):
    x0, y0, x1, y1 = cfg["rooms"][ri]["rect"]
    if rect[0] < x0 or rect[1] < y0 or rect[2] > x1 or rect[3] > y1:
        return False
    if any(overlap(rect, o, 0.05) for o in blocked + placed):
        return False
    if any(point_rect_dist(px, py, rect) < 0.55 for (px, py) in path_xy):
        return False
    for w in windows_info:
        if w["room"] != ri or w["wall"] != wall:
            continue
        sill = min(c[2] for c in w["corners"])
        xs = [c[0] for c in w["corners"]]
        ys = [c[1] for c in w["corners"]]
        span = (min(xs) - 0.25, min(ys) - 0.6, max(xs) + 0.25, max(ys) + 0.6)
        if h > sill - 0.15 and overlap(rect, span):
            return False
    return True


# ---------------------------------------------------------------------------------------------
# The walkthrough: keyframes in the guide's order, then smoothed, then a hand's shake
# ---------------------------------------------------------------------------------------------

WALK, TURN, TILT = 0.5, 55.0, 45.0  # m/s, deg/s, deg/s before scaling to the target length


class Track:
    def __init__(self, x, y, z, yaw, pitch):
        self.keys = [dict(t=0.0, x=x, y=y, z=z, yaw=yaw, pitch=pitch, label="start")]

    @property
    def last(self):
        return self.keys[-1]

    def go(self, x=None, y=None, z=None, yaw=None, pitch=None, hold=0.0, label=None, min_dur=0.35):
        k = self.last
        nk = dict(k)
        nk["x"] = k["x"] if x is None else x
        nk["y"] = k["y"] if y is None else y
        nk["z"] = k["z"] if z is None else z
        if yaw is not None:
            # Nearest equivalent angle, so turns take the short way round
            d = (yaw - k["yaw"] + 180) % 360 - 180
            nk["yaw"] = k["yaw"] + d
        nk["pitch"] = k["pitch"] if pitch is None else pitch
        dist = math.dist((k["x"], k["y"], k["z"]), (nk["x"], nk["y"], nk["z"]))
        dur = max(dist / WALK, abs(nk["yaw"] - k["yaw"]) / TURN, abs(nk["pitch"] - k["pitch"]) / TILT, min_dur)
        nk["t"] = k["t"] + dur
        nk["label"] = label or k.get("label")
        self.keys.append(nk)
        if hold:
            h = dict(nk)
            h["t"] += hold
            self.keys.append(h)

    def turn_by(self, d, **kw):
        k = self.last
        nk_yaw = k["yaw"] + d
        self.keys.append(dict(k, yaw=nk_yaw, t=k["t"] + max(abs(d) / TURN, 0.35), **kw))


def heading(dx, dy):
    return math.degrees(math.atan2(dy, dx))


def plan_walkthrough(cfg, windows_info):
    S = cfg["_stairs"]
    rooms = cfg["rooms"]
    up = S["up"]
    down_dir = -up  # walking down the stairs moves this way along the axis
    mid = (S["c0"] + S["c1"]) / 2
    yaw_down = heading(*(S["at"](down_dir, 0)))  # direction vector along the axis
    # 1. Stairs first: from the landing, film the stairs on the way down.
    sx, sy = S["at"](S["top"] + up * 0.45, mid)
    tr = Track(sx, sy, S["rise"] + EYE, yaw_down, -38)
    tr.go(hold=0.8, label="stairs")
    for frac, pitch in ((0.35, -30), (0.7, -22), (1.0, -12)):
        a = S["top"] + (S["bottom"] - S["top"]) * frac
        steps_down = round(frac * (S["n"] - 1))
        z = (S["n"] - 1 - steps_down) * S["rh"] + EYE
        x, y = S["at"](a, mid)
        tr.go(x, y, z, pitch=pitch, label="stairs")
    x, y = S["at"](S["bottom"] + down_dir * 0.55, mid)
    tr.go(x, y, EYE, pitch=0, hold=0.4, label="stairs")
    open_dir = 1 if S["open_side"] > S["wall_side"] else -1
    x, y = S["at"](S["bottom"] + down_dir * 0.55, mid + open_dir * 0.9)
    tr.go(x, y, label="room0:arrive")
    segments = []
    for ri, r in enumerate(rooms):
        x0, y0, x1, y1 = r["rect"]
        ix = min(2.0, (x1 - x0) / 2 - 0.15)
        iy = min(2.0, (y1 - y0) / 2 - 0.15)
        ax0, ax1, ay0, ay1 = x0 + ix, x1 - ix, y0 + iy, y1 - iy
        corners = [(ax0, ay0), (ax1, ay0), (ax1, ay1), (ax0, ay1)]
        travel = [0, 90, 180, 270]  # counter-clockwise; the camera faces the wall to its right
        k = min(range(4), key=lambda i: math.dist(corners[i], (tr.last["x"], tr.last["y"])))
        # 2. Walls: about 2 m back, side-stepping along each wall, turning into the corners.
        face = travel[k] - 75
        tr.go(*corners[k], yaw=face, label=f"room{ri}:walls")
        for s in range(4):
            i = (k + s) % 4
            nxt = corners[(i + 1) % 4]
            tr.go(*nxt, label=f"room{ri}:walls")
            tr.turn_by(90, label=f"room{ri}:walls")
        # 3. Tilt up to the ceiling and sweep it.
        tr.go(pitch=68, label=f"room{ri}:ceiling", hold=0.3)
        tr.turn_by(75, label=f"room{ri}:ceiling")
        tr.go(pitch=0, label=f"room{ri}:ceiling")
        # 4. Point at each window in the room for a second.
        here = (tr.last["x"], tr.last["y"])
        mine = [w for w in windows_info if w["room"] == ri]
        mine.sort(key=lambda w: (heading(w["center"][0] - here[0], w["center"][1] - here[1]) - tr.last["yaw"]) % 360)
        for w in mine:
            cx, cy, cz = w["center"]
            dist = math.dist(here, (cx, cy))
            tr.go(yaw=heading(cx - here[0], cy - here[1]), pitch=min(40, math.degrees(math.atan2(cz - EYE, dist))), hold=1.0, label=f"room{ri}:windows")
        # 5. A moment to say what this room should be.
        tr.go(pitch=-5, hold=1.2, label=f"room{ri}:plans")
        # 6. On to the next room, through the door; a room to peek into is only looked at from its doorway.
        if ri + 1 < len(rooms) and rooms[ri + 1].get("peek"):
            d = cfg["doors"][ri]
            o, nrm, al = wall_frame(rooms[d["room"]]["rect"], d["wall"], d["at"])
            sign = 1 if d["room"] == ri else -1
            n = (nrm[0] * sign, nrm[1] * sign)
            cx, cy = o[0] + nrm[0] * INT_WALL / 2, o[1] + nrm[1] * INT_WALL / 2
            # Stand just short of the doorway, on this side, and look in: across, then each way, then down.
            here = (cx - n[0] * (INT_WALL / 2 + 0.3), cy - n[1] * (INT_WALL / 2 + 0.3))
            tr.go(cx - n[0] * 1.0, cy - n[1] * 1.0, yaw=heading(*n), pitch=-4, label=f"room{ri}:to-door")
            tr.go(*here, label=f"peek{ri + 1}")
            ahead = heading(*n)
            for yaw, pitch, hold in ((ahead, -10, 0.8), (ahead - 50, -12, 0.8), (ahead + 50, -12, 0.8), (ahead, -30, 0.6), (ahead, 20, 0.6), (ahead, -5, 0.4)):
                tr.go(yaw=yaw, pitch=pitch, hold=hold, label=f"peek{ri + 1}")
            break
        if ri + 1 < len(rooms):
            d = cfg["doors"][ri]
            o, nrm, al = wall_frame(rooms[d["room"]]["rect"], d["wall"], d["at"])
            sign = 1 if d["room"] == ri else -1  # door normal points from its room into the next
            n = (nrm[0] * sign, nrm[1] * sign)
            cx, cy = o[0] + nrm[0] * INT_WALL / 2, o[1] + nrm[1] * INT_WALL / 2
            pre = (cx - n[0] * 1.0, cy - n[1] * 1.0)
            post = (cx + n[0] * 1.25, cy + n[1] * 1.25)
            tr.go(*pre, yaw=heading(*n), pitch=-4, label=f"room{ri}:to-door")
            tr.go(*post, label=f"door{ri}")
    tr.go(hold=1.0, label="end")
    return tr


def sample_track(tr, target_s, rng):
    keys = tr.keys
    nominal = keys[-1]["t"]
    scale = min(max(target_s / nominal, 0.55), 1.6)
    total = nominal * scale
    n = int(round(total * FPS))
    times = [k["t"] * scale for k in keys]
    raw = []
    j = 0
    for f in range(n):
        t = f / FPS
        while j < len(keys) - 2 and times[j + 1] <= t:
            j += 1
        a, b = keys[j], keys[j + 1]
        span = max(times[j + 1] - times[j], 1e-6)
        u = min(max((t - times[j]) / span, 0.0), 1.0)
        e = u * u * (3 - 2 * u)
        raw.append({k: a[k] + (b[k] - a[k]) * e for k in ("x", "y", "z", "yaw", "pitch")} | {"label": b["label"]})
    # Gaussian smoothing so the walk flows instead of stopping at every key.
    sigma = 0.22 * FPS
    rad = int(3 * sigma)
    wts = [math.exp(-0.5 * (i / sigma) ** 2) for i in range(-rad, rad + 1)]
    out = []
    for f in range(n):
        acc = {k: 0.0 for k in ("x", "y", "z", "yaw", "pitch")}
        wsum = 0.0
        for i, w in zip(range(-rad, rad + 1), wts):
            g = raw[min(max(f + i, 0), n - 1)]
            for k in acc:
                acc[k] += g[k] * w
            wsum += w
        out.append({k: v / wsum for k, v in acc.items()} | {"label": raw[f]["label"]})
    # A hand's shake: slow drift, balance sway, tremor, and a step bob while walking.
    ph = [rng.uniform(0, 2 * math.pi) for _ in range(16)]
    step_phase = 0.0
    for f, p in enumerate(out):
        t = f / FPS
        if f:
            speed = math.dist((p["x"], p["y"]), (out[f - 1]["x"], out[f - 1]["y"])) * FPS
        else:
            speed = 0.0
        step_phase += 2 * math.pi * 1.8 / FPS * min(speed / 0.45, 1.0)
        walk = min(speed / 0.35, 1.0)
        p["sx"] = 0.012 * math.sin(2 * math.pi * 0.09 * t + ph[0]) + 0.005 * math.sin(2 * math.pi * 0.43 * t + ph[1])
        p["sy"] = 0.012 * math.sin(2 * math.pi * 0.07 * t + ph[2]) + 0.005 * math.sin(2 * math.pi * 0.37 * t + ph[3])
        p["sz"] = 0.008 * math.sin(2 * math.pi * 0.11 * t + ph[4]) + walk * 0.009 * abs(math.sin(step_phase))
        p["syaw"] = 0.7 * math.sin(2 * math.pi * 0.13 * t + ph[5]) + 0.35 * math.sin(2 * math.pi * 0.53 * t + ph[6]) + 0.12 * math.sin(2 * math.pi * 2.1 * t + ph[7]) + walk * 0.4 * math.sin(step_phase / 2 + ph[8])
        p["spitch"] = 0.6 * math.sin(2 * math.pi * 0.11 * t + ph[9]) + 0.3 * math.sin(2 * math.pi * 0.61 * t + ph[10]) + 0.12 * math.sin(2 * math.pi * 2.6 * t + ph[11]) + walk * 0.5 * math.sin(step_phase + ph[12])
        p["sroll"] = 0.9 * math.sin(2 * math.pi * 0.08 * t + ph[13]) + 0.3 * math.sin(2 * math.pi * 0.47 * t + ph[14]) + walk * 0.6 * math.sin(step_phase / 2 + ph[15])
    return out, total


def cam_matrix(p):
    x, y, z = p["x"] + p["sx"], p["y"] + p["sy"], p["z"] + p["sz"]
    yaw = math.radians(p["yaw"] + p["syaw"])
    pitch = math.radians(p["pitch"] + p["spitch"])
    roll = math.radians(p["sroll"])
    rot = Matrix.Rotation(yaw - math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi / 2 + pitch, 4, "X") @ Matrix.Rotation(roll, 4, "Z")
    return Matrix.Translation((x, y, z)) @ rot


def room_at(cfg, x, y, prev):
    best, depth = prev, -1.0
    for ri, r in enumerate(cfg["rooms"]):
        x0, y0, x1, y1 = r["rect"]
        m = INT_WALL / 2
        inside = min(x - (x0 - m), (x1 + m) - x, y - (y0 - m), (y1 + m) - y)
        if inside >= 0 and inside > depth:
            best, depth = ri, inside
    return best


def check_path(cfg, frames, obstacles, total):
    """The camera must stay clear of fixtures and walls (doorways and the stairs excepted)."""
    S = cfg["_stairs"]
    problems = []
    for f in range(0, len(frames), 3):
        p = frames[f]
        x, y = p["x"], p["y"]
        if p["label"] == "stairs":
            continue
        for o in obstacles + [S["footprint"]]:
            if point_rect_dist(x, y, o) < 0.32:
                problems.append(f"{f / FPS:.1f}s at ({x:.2f},{y:.2f}) is {point_rect_dist(x, y, o):.2f} m from {o}")
        for bm in cfg.get("beams", []):
            for q in bm.get("posts", []):
                px, py = (q, bm["at"]) if bm["axis"] == "x" else (bm["at"], q)
                if math.hypot(x - px, y - py) < 0.4:
                    problems.append(f"{f / FPS:.1f}s at ({x:.2f},{y:.2f}) is near a post at ({px},{py})")
        in_room = any(r["rect"][0] + 0.3 <= x <= r["rect"][2] - 0.3 and r["rect"][1] + 0.3 <= y <= r["rect"][3] - 0.3 for r in cfg["rooms"])
        if not in_room and not p["label"].startswith("door") and "to-door" not in p["label"]:
            problems.append(f"{f / FPS:.1f}s at ({x:.2f},{y:.2f}) is within 0.3 m of a wall ({p['label']})")
    return problems


# ---------------------------------------------------------------------------------------------
# Ground truth
# ---------------------------------------------------------------------------------------------

def projected_box(scene, cam, pts):
    from bpy_extras.object_utils import world_to_camera_view
    uv = [world_to_camera_view(scene, cam, Vector(p)) for p in pts]
    if any(c.z <= 0.05 for c in uv):
        return None
    xs = [c.x for c in uv]
    ys = [1 - c.y for c in uv]
    x0, x1 = max(0.0, min(xs)), min(1.0, max(xs))
    y0, y1 = max(0.0, min(ys)), min(1.0, max(ys))
    if x1 - x0 < 0.01 or y1 - y0 < 0.01:
        return None
    return (x0, y0, x1 - x0, y1 - y0)


def visible(scene, dg, origin, target, name):
    d = Vector(target) - origin
    dist = d.length
    hit, loc, _n, _i, ob, _m = scene.ray_cast(dg, origin, d.normalized(), distance=dist + 0.05)
    if not hit:
        return True
    return ob.name.startswith(name) or (loc - origin).length >= dist - 0.08


def window_boxes(scene, cam, frames, windows_info):
    """Each window's clear opening as a box on every analysis frame where it's in view (5 fps)."""
    dg = bpy.context.evaluated_depsgraph_get()
    boxes = {w["id"]: [] for w in windows_info}
    step = FPS // ANALYSIS_FPS
    for af, f in enumerate(range(0, len(frames), step)):
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        origin = cam.matrix_world.translation.copy()
        for k, w in enumerate(windows_info):
            box = projected_box(scene, cam, w["corners"])
            if not box:
                continue
            c = w["corners"]
            probes = [w["center"]] + [tuple(0.75 * Vector(c[i]) + 0.25 * Vector(w["center"])) for i in range(4)]
            if sum(visible(scene, dg, origin, p, f"Window.{k}") for p in probes) >= 2:
                boxes[w["id"]].append([af, *[round(v, 4) for v in box]])
    return boxes


def truth(cfg, frames, total, windows_info, wboxes):
    rooms = cfg["rooms"]
    # Room by frame, from where the camera stands
    idx, prev = [], 0
    for p in frames:
        prev = room_at(cfg, p["x"], p["y"], prev)
        idx.append(prev)
    starts = [0.0]
    order = [0]
    for f in range(1, len(idx)):
        if idx[f] != idx[f - 1]:
            starts.append(round(f / FPS, 2))
            order.append(idx[f])
    entered = [ri for ri, r in enumerate(rooms) if not r.get("peek")]
    assert order == entered, f"rooms filmed out of order: {order}"
    out_rooms = []
    for ri, r in enumerate(rooms):
        x0, y0, x1, y1 = r["rect"]
        w, d = round(x1 - x0, 3), round(y1 - y0, 3)
        obstructions = []
        for bm in cfg.get("beams", []):
            lo, hi = bm["span"]
            line = (lo, bm["at"] - 0.07, hi, bm["at"] + 0.07) if bm["axis"] == "x" else (bm["at"] - 0.07, lo, bm["at"] + 0.07, hi)
            if overlap(line, r["rect"]):
                obstructions.append(dict(kind="beam", material=bm["kind"], bottomM=round(cfg["subfloor"] - JOIST_D - bm["depth"], 3)))
        for du in cfg.get("ducts", []):
            if overlap(du["rect"], r["rect"]):
                obstructions.append(dict(kind="duct", bottomM=round(cfg["subfloor"] - JOIST_D - du.get("hang", 0) - du["depth"], 3)))
        for bh in cfg.get("bulkheads", []):
            if bh["room"] == ri:
                obstructions.append(dict(kind="bulkhead", bottomM=bh["bottom"]))
        mine = [w_ for w_ in windows_out(cfg) if w_["room"] == ri]
        k = entered.index(ri) if ri in entered else None
        out_rooms.append(dict(
            index=ri, name=r["name"],
            entered=k is not None,  # false: only looked into from its doorway
            startS=starts[k] if k is not None else None,
            endS=(starts[k + 1] if k + 1 < len(starts) else round(total, 2)) if k is not None else None,
            widthM=max(w, d), depthM=min(w, d), alongX=w, alongY=d, areaM2=round(w * d, 2),
            ceiling="exposed_joists" if r["ceiling"] == "joists" else "drywall",
            ceilingHeightM=rule_ceiling(cfg, r),
            subfloorM=cfg["subfloor"] if r["ceiling"] == "joists" else None,
            minClearanceM=min([o["bottomM"] for o in obstructions], default=None),
            obstructions=obstructions,
            windows=[w_["id"] for w_ in mine],
            hasStairs=ri == 0,
            hasFurnace=bool(cfg.get("furnace")) and point_in(cfg["furnace"]["x"], cfg["furnace"]["y"], r["rect"]),
        ))
    wins = windows_out(cfg)
    for w_ in wins:
        seen = wboxes[w_["id"]]
        w_["seenS"] = [round(seen[0][0] / ANALYSIS_FPS, 1), round(seen[-1][0] / ANALYSIS_FPS, 1)] if seen else None
        w_["analysisBoxes"] = seen
    habitable = [r for r in out_rooms if not r["hasFurnace"]] or out_rooms
    ceiling_ok = all(r["ceilingHeightM"] - FINISH_M >= CEILING_MIN_M for r in habitable)
    clear = [r["minClearanceM"] for r in out_rooms if r["minClearanceM"] is not None]
    clearance_ok = all(c - FINISH_M >= CLEARANCE_MIN_M for c in clear)
    egress_ok = any(w_["meetsEgress"] for w_ in wins)
    fixes = [k for k, ok in (("ceiling_height_suite", ceiling_ok), ("clearance_beams_ducts_suite", clearance_ok), ("egress_window", egress_ok)) if not ok]
    # The assessment agent is told to flag open joists (no fire-rated ceiling) and a furnace open to
    # the space on sight (server/assess.ts), so those count as expected fixes too.
    furnace_room = next((r for r in out_rooms if r["hasFurnace"]), None)
    door_in = next((d for d in cfg.get("doors", []) if furnace_room and d["room"] + 1 == furnace_room["index"]), None)
    if any(r["ceiling"] == "exposed_joists" for r in out_rooms):
        fixes.append("fire_separation_between_units")
    if furnace_room and (furnace_room["index"] == 0 or not (door_in and door_in.get("slab", True))):
        fixes.append("service_room_separation")
    categories = sorted({"height" if k.startswith(("ceiling", "clearance")) else "egress" if k.startswith("egress") else "fire" for k in fixes})
    doors = []
    for d in cfg.get("doors", []):
        doors.append(dict(between=[d["room"], d["room"] + 1], widthM=d["width"],
                          heightM=round(d.get("height", DOOR_H), 3), slab=d.get("slab", True)))
    return dict(
        id=cfg["id"], about=cfg["about"], video="walkthrough.mp4",
        fps=FPS, analysisFps=ANALYSIS_FPS, width=RES[0], height=RES[1], durationS=round(total, 2),
        frames=len(frames),
        rooms=out_rooms,
        roomStartsS=starts,
        stairsEndS=round(max(f for f, p in enumerate(frames) if p["label"] == "stairs") / FPS, 2),
        windows=wins,
        doors=doors,
        stairs=dict(room=0, risers=cfg["_stairs"]["n"], riserM=round(cfg["_stairs"]["rh"], 3), widthM=cfg["_stairs"]["width"]),
        expected=dict(
            ceilingHeightOk=ceiling_ok, clearanceOk=clearance_ok, egressWindow=egress_ok,
            minCeilingM=min(r["ceilingHeightM"] for r in habitable), minClearanceM=min(clear) if clear else None,
            fixes=fixes, fixCategories=categories, verdict="fix" if fixes else "yes",
            note="Rules: finished ceiling >= 1.95 m and clearance under beams/ducts >= 1.85 m (scan reading minus 16 mm drywall); "
                 "an escape window with a clear opening >= 0.35 m² and no side under 380 mm. Open joists and a furnace with no "
                 "door count as fire fixes, as the assessment agent is told to flag them on sight.",
        ),
        camera=dict(eyeM=EYE, longSideFovDeg=68, path="stairs first, walls from about 2 m back, tilt up, windows, next room"),
        generator=dict(script="scripts/eval/generate.py", seed=cfg["seed"], blender=bpy.app.version_string),
    )


def point_in(x, y, rect):
    return rect[0] <= x <= rect[2] and rect[1] <= y <= rect[3]


def windows_out(cfg):
    out = []
    for k, (wall, ri, at, w, h, sill) in enumerate(cfg["windows"]):
        area = round(w * h, 4)
        out.append(dict(id=f"w{k + 1}", room=ri, wall=wall, widthM=w, heightM=h, sillM=sill, areaM2=area,
                        minSideMm=round(min(w, h) * 1000), meetsEgress=area >= EGRESS_AREA_M2 and min(w, h) >= EGRESS_MIN_SIDE_M))
    return out


# ---------------------------------------------------------------------------------------------
# Scene, render, encode
# ---------------------------------------------------------------------------------------------

def setup_render(scene, cfg, scale, samples):
    scene.render.engine = "BLENDER_EEVEE"
    ee = scene.eevee
    ee.taa_render_samples = samples
    # Screen-space raytracing leaves a speckle fixed to the screen, which a 3D model could read as
    # texture; without it the walls render clean and each frame takes about 0.8 s at full size.
    ee.use_raytracing = False
    ee.use_shadows = True
    ee.shadow_ray_count = 1
    ee.shadow_step_count = 4
    scene.render.resolution_x = int(RES[0] * scale)
    scene.render.resolution_y = int(RES[1] * scale)
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.view_settings.view_transform = "AgX"
    for look in ("AgX - Medium High Contrast", "AgX - Base Contrast"):
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            pass
    scene.view_settings.exposure = cfg.get("exposure", 0.0)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.035, 0.034, 0.033, 1)  # stands in for light bouncing around the room
    bg.inputs["Strength"].default_value = 1.0
    scene.world = world
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 93


def build(cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    scene = bpy.context.scene
    coll = bpy.data.collections.new("Basement")
    scene.collection.children.link(coll)
    cutters = bpy.data.collections.new("Cutters")
    scene.collection.children.link(cutters)
    M = mats(cfg)
    S = stair_layout(cfg)
    cfg["_stairs"] = S
    rng = random.Random(cfg["seed"])

    build_house(cfg, M, coll, cutters, S)
    build_room_surfaces(cfg, M, coll, S)
    build_stairs(cfg, S, M, coll)
    build_doors(cfg, M, coll)
    lights_extra = []
    windows_info = build_windows(cfg, M, coll, lights_extra)
    obstacles = build_fixtures(cfg, M, coll)
    build_lights(cfg, M, coll, lights_extra)

    tr = plan_walkthrough(cfg, windows_info)
    frames, total = sample_track(tr, cfg["duration"], rng)
    problems = check_path(cfg, frames, obstacles, total)
    if problems:
        print(f"[{cfg['id']}] camera path problems ({len(problems)}):")
        for p in problems[:12]:
            print("   ", p)
        raise SystemExit(f"{cfg['id']}: camera path runs into the scene; fix the plan")
    path_xy = [(p["x"], p["y"]) for p in frames[:: FPS // 3] if p["label"] != "stairs"]
    place_clutter(cfg, M, coll, path_xy, obstacles, windows_info)

    cam_data = bpy.data.cameras.new("Phone")
    cam_data.sensor_fit = "AUTO"
    cam_data.angle = math.radians(68)  # long side, a phone's main camera in 16:9 video
    cam_data.clip_start = 0.05
    cam = bpy.data.objects.new("Phone", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for f, p in enumerate(frames):
        cam.matrix_world = cam_matrix(p)
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
    scene.frame_start, scene.frame_end = 0, len(frames) - 1
    return scene, cam, frames, total, windows_info


def auto_exposure(scene, cfg, frames_n, starts, work):
    """A phone's auto exposure, room by room: meter a few small stills in each room, set that room's
    exposure, and ease between rooms over about a second. `brightness` is the mean display level
    it aims for; a dim room ends up lifted, and grainier (see render)."""
    import numpy as np
    target = cfg.get("brightness", 0.34)
    keep = (scene.render.resolution_x, scene.render.resolution_y, scene.render.filepath)
    scene.render.resolution_x, scene.render.resolution_y = 180, 320
    work.mkdir(parents=True, exist_ok=True)
    bounds = [int(round(t * FPS)) for t in starts] + [frames_n]
    evs = []
    for ri in range(len(starts)):
        a, b = bounds[ri], bounds[ri + 1]
        picks = [a + int((b - a) * k / 7) for k in range(1, 7)]
        ev = cfg.get("exposure", 0.0)
        for _ in range(3):
            scene.view_settings.exposure = ev
            levels = []
            for f in picks:
                scene.frame_set(f)
                scene.render.filepath = str(work / "meter.jpg")
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(str(work / "meter.jpg"))
                px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
                levels.append(float((px[:, 0] * 0.2126 + px[:, 1] * 0.7152 + px[:, 2] * 0.0722).mean()))
                bpy.data.images.remove(img)
            level = float(np.mean(levels))
            step = max(-3.0, min(3.0, 2.2 * math.log2(target / max(level, 1e-3))))
            if abs(step) < 0.1:
                break
            ev += step
        print(f"[{cfg['id']}] room {ri + 1}: exposure {ev:+.2f} (mean level {level:.3f}, aiming for {target})")
        evs.append(ev)
    (work / "meter.jpg").unlink(missing_ok=True)
    scene.render.resolution_x, scene.render.resolution_y, scene.render.filepath = keep
    vs = scene.view_settings
    vs.exposure = evs[0]
    scene.keyframe_insert("view_settings.exposure", frame=0)
    for ri in range(1, len(evs)):
        vs.exposure = evs[ri - 1]
        scene.keyframe_insert("view_settings.exposure", frame=max(0, bounds[ri] - 12))
        vs.exposure = evs[ri]
        scene.keyframe_insert("view_settings.exposure", frame=bounds[ri] + 18)
    return evs


def render(scene, cfg, out_dir, frames_n, scale, preview, at=()):
    work = out_dir / ("preview" if preview else "frames")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    if preview:
        picks = [min(frames_n - 1, int(round(t * FPS))) for t in at] or [int(i * (frames_n - 1) / max(1, preview - 1)) for i in range(preview)]
        for f in picks:
            scene.frame_set(f)
            scene.render.filepath = str(work / f"{f:05d}.jpg")
            bpy.ops.render.render(write_still=True)
        return None
    scene.render.filepath = str(work / "#####")
    started = time.time()
    bpy.ops.render.render(animation=True)
    print(f"[{cfg['id']}] rendered {frames_n} frames in {time.time() - started:.0f} s")
    video = out_dir / "walkthrough.mp4"
    # A phone's H.264 at about 12 Mbps, with a touch of sensor grain.
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(work / "%05d.jpg"),
                    "-vf", f"noise=alls={cfg.get('_grain', 5)}:allf=t", "-c:v", "libx264", "-preset", "medium", "-b:v", "12M", "-maxrate", "16M",
                    "-bufsize", "24M", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
                    "-color_trc", "bt709", "-movflags", "+faststart", str(video)], check=True)
    shutil.rmtree(work)
    return video


def write_capture(out_dir, frames):
    """The camera path as the iPhone app would send it (docs/capture-contract.md): ARKit-style
    camera-to-world, column-major, in a +Y-up world, with the lens in pixels. Blender's camera looks down
    -Z with +Y up like ARKit's; only the world turns (Blender is Z-up)."""
    to_y_up = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    f = (max(RES) / 2) / math.tan(math.radians(68) / 2)
    records = []
    for i, p in enumerate(frames):
        m = to_y_up @ cam_matrix(p)
        records.append({
            "t": round(i / FPS, 4),
            "transform": [round(m[r][c], 6) for c in range(4) for r in range(4)],
            "intrinsics": [round(f, 3), round(f, 3), RES[0] / 2, RES[1] / 2],
            "tracking": "normal",
        })
    capture = {"version": 1, "device": "blender", "lens": "wide", "imageResolution": list(RES), "rotationCW": 0, "frames": records}
    (out_dir / "capture.json").write_text(json.dumps(capture))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=str(REPO / "media" / "eval"))
    ap.add_argument("--preview", type=int, default=0)
    ap.add_argument("--truth-only", action="store_true")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--at", default="")
    ap.add_argument("--samples", type=int, default=8)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    only = [s for s in args.only.split(",") if s]
    todo = [c for c in BASEMENTS if not only or any(c["id"].startswith(o) for o in only)]
    for cfg in todo:
        started = time.time()
        out_dir = Path(args.out) / cfg["id"]
        out_dir.mkdir(parents=True, exist_ok=True)
        scene, cam, frames, total, windows_info = build(cfg)
        write_capture(out_dir, frames)
        setup_render(scene, cfg, args.scale if not args.preview else 0.5 * args.scale, args.samples)
        wboxes = window_boxes(scene, cam, frames, windows_info)
        t = truth(cfg, frames, total, windows_info, wboxes)
        if not args.truth_only:
            t["exposureEv"] = [round(e, 2) for e in auto_exposure(scene, cfg, len(frames), t["roomStartsS"], out_dir / "meter")]
            shutil.rmtree(out_dir / "meter", ignore_errors=True)
            cfg["_grain"] = round(4 + 1.5 * max(0.0, max(t["exposureEv"])), 1)
        bpy.ops.wm.save_as_mainfile(filepath=str(out_dir / "scene.blend"), compress=True)
        if not args.truth_only:
            render(scene, cfg, out_dir, len(frames), args.scale, args.preview, [float(a) for a in args.at.split(",") if a])
        if not args.preview:
            old = out_dir / "truth.json"
            if args.truth_only and old.exists() and "exposureEv" in json.loads(old.read_text()):
                t["exposureEv"] = json.loads(old.read_text())["exposureEv"]  # from the render, kept
            (out_dir / "truth.json").write_text(json.dumps(t, indent=1))
        print(f"[{cfg['id']}] {len(cfg['rooms'])} rooms, {total:.1f} s, rooms start at {t['roomStartsS']}, "
              f"expected {t['expected']['verdict']} {t['expected']['fixes']} ({time.time() - started:.0f} s)")


main()
