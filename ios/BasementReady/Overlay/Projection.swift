// Where a point in the room lands on the screen, from the camera's own lens numbers: the same math
// for ARKit's picture (stored landscape, turned 90° clockwise to stand upright) and a replayed take
// (stored upright). The picture fills the screen (aspect fill), so the overlay and the camera match.
import simd

struct ImageGeometry: Sendable, Equatable {
  var resolution: SIMD2<Float> // the image as stored, in pixels
  var intrinsics: SIMD4<Float> // fx, fy, cx, cy at `resolution`
  var rotationCW: Int // 0, 90, 180 or 270: how the stored image turns upright

  var upright: SIMD2<Float> { rotationCW % 180 == 0 ? resolution : SIMD2(resolution.y, resolution.x) }

  // Points per upright image pixel when the picture fills `viewport`.
  func fillScale(_ viewport: SIMD2<Float>) -> Float {
    max(viewport.x / upright.x, viewport.y / upright.y)
  }

  // A stored image pixel to the upright picture: (u', v') = rotation of (u, v).
  func toUpright(_ p: SIMD2<Float>) -> SIMD2<Float> {
    let (w, h) = (resolution.x, resolution.y)
    switch rotationCW {
    case 90: return SIMD2(h - p.y, p.x)
    case 180: return SIMD2(w - p.x, h - p.y)
    case 270: return SIMD2(p.y, w - p.x)
    default: return p
    }
  }

  func fromUpright(_ p: SIMD2<Float>) -> SIMD2<Float> {
    let (w, h) = (resolution.x, resolution.y)
    switch rotationCW {
    case 90: return SIMD2(p.y, h - p.x)
    case 180: return SIMD2(w - p.x, h - p.y)
    case 270: return SIMD2(w - p.y, p.x)
    default: return p
    }
  }

  // Camera space (ARKit: +x right and +y up in the stored image, looking down −z) to clip space for
  // a viewport of `viewport` points. Metal depth runs 0 at `near` to 1 at `far`.
  func projection(viewport: SIMD2<Float>, near: Float = 0.05, far: Float = 30) -> simd_float4x4 {
    let (fx, fy, cx, cy) = (intrinsics.x, intrinsics.y, intrinsics.z, intrinsics.w)
    let (w, h) = (resolution.x, resolution.y)
    // u' = Au·u + Bu·v + Cu and v' = Av·u + Bv·v + Cv, for u = fx·x/d + cx and v = cy − fy·y/d.
    let (au, bu, cu, av, bv, cv): (Float, Float, Float, Float, Float, Float)
    switch rotationCW {
    case 90: (au, bu, cu, av, bv, cv) = (0, -1, h, 1, 0, 0)
    case 180: (au, bu, cu, av, bv, cv) = (-1, 0, w, 0, -1, h)
    case 270: (au, bu, cu, av, bv, cv) = (0, 1, 0, -1, 0, w)
    default: (au, bu, cu, av, bv, cv) = (1, 0, 0, 0, 1, 0)
    }
    let s = fillScale(viewport)
    let a = 2 * s / viewport.x, b = 2 * s / viewport.y
    let kx = au * cx + bu * cy + cu - upright.x / 2
    let ky = av * cx + bv * cy + cv - upright.y / 2
    let f = far / (far - near)
    let rows = simd_float4x4(rows: [
      SIMD4(a * au * fx, -a * bu * fy, -a * kx, 0),
      SIMD4(-b * av * fx, b * bv * fy, b * ky, 0),
      SIMD4(0, 0, -f, -f * near),
      SIMD4(0, 0, -1, 0),
    ])
    return rows
  }

  // The camera picture as a full-screen quad: each corner's clip position and where it samples the
  // stored image (0…1, top left first). Triangle strip order: bottom left, bottom right, top left, top right.
  func backgroundQuad(viewport: SIMD2<Float>) -> [SIMD4<Float>] {
    let s = fillScale(viewport)
    return [SIMD2<Float>(-1, -1), SIMD2(1, -1), SIMD2(-1, 1), SIMD2(1, 1)].map { ndc in
      let screen = SIMD2((ndc.x + 1) / 2 * viewport.x, (1 - ndc.y) / 2 * viewport.y)
      let up = (screen - viewport / 2) / s + upright / 2
      let uv = fromUpright(up) / resolution
      return SIMD4(ndc.x, ndc.y, uv.x, uv.y)
    }
  }

  // A world point to screen points, or nil behind the camera. For tests and the arrow overlay.
  func screenPoint(_ world: SIMD3<Float>, cameraToWorld: simd_float4x4, viewport: SIMD2<Float>) -> SIMD2<Float>? {
    let clip = projection(viewport: viewport) * (cameraToWorld.inverse * SIMD4(world, 1))
    guard clip.w > 0.01 else { return nil }
    let ndc = SIMD2(clip.x, clip.y) / clip.w
    return SIMD2((ndc.x + 1) / 2 * viewport.x, (1 - ndc.y) / 2 * viewport.y)
  }

  // Where a camera-space point falls in the stored image, in pixels (nil behind the camera).
  func pixel(_ c: SIMD3<Float>) -> SIMD2<Float>? {
    guard c.z < -0.05 else { return nil }
    return SIMD2(intrinsics.x * c.x / -c.z + intrinsics.z, intrinsics.w - intrinsics.y * c.y / -c.z)
  }

  // The camera-space direction through a stored image pixel.
  func ray(_ p: SIMD2<Float>) -> SIMD3<Float> {
    simd_normalize(SIMD3((p.x - intrinsics.z) / intrinsics.x, -(p.y - intrinsics.w) / intrinsics.y, -1))
  }
}
