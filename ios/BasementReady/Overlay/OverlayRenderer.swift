// Draws the filming overlay with Metal, 60 times a second, on top of the camera picture or a dark
// void: floor tiles where the floor is known, filmed ceiling, the walls ARKit found, the point cloud
// coloured from the camera, and a soft glow wherever nothing has been filmed yet. Pointing back at a
// glow fills it in. Everything comes from the take's OverlayFeed; buffers are rebuilt only when
// their part changes, and the point buffer only ever grows.
import MetalKit
import QuartzCore
import SwiftUI
import simd

struct OverlayUniforms {
  var viewProj: simd_float4x4
  var camera: SIMD4<Float>
  var params: SIMD4<Float>
}

struct SurfaceVertex {
  var pos: SIMD4<Float> // world xyz, kind
  var extra: SIMD4<Float>
}

final class OverlayRenderer: NSObject, MTKViewDelegate {
  static let voidColor = MTLClearColor(red: 0.024, green: 0.067, blue: 0.047, alpha: 1)

  let feed: OverlayFeed
  let perf: CapturePerf?
  var voidView = false
  var reduceMotion = false

  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private var textures: CVMetalTextureCache?
  private let cameraYCbCr: MTLRenderPipelineState
  private let cameraBGRA: MTLRenderPipelineState
  private let surfaces: MTLRenderPipelineState
  private let glows: MTLRenderPipelineState
  private let points: MTLRenderPipelineState
  private let inFlight = DispatchSemaphore(value: 3)

  private let pointBuffer: MTLBuffer
  private var pointsUploaded = 0
  private var wallVersion = -1
  private var wallBuffer: MTLBuffer?
  private var wallCount = 0
  private var mapVersion = -1
  private var tileBuffer: MTLBuffer?
  private var tileCount = 0
  private var glowBuffer: MTLBuffer?
  private var glowCount = 0
  private var born: [Cell: Float] = [:]
  private var ceilingBorn: [Cell: Float] = [:]
  private var lastCamera: SIMD3<Float>?

  // Compiled once, the first time a take starts.
  @MainActor private static var library: MTLLibrary?

  @MainActor init?(feed: OverlayFeed, perf: CapturePerf?) {
    if Self.library == nil, let device = MTLCreateSystemDefaultDevice() {
      Self.library = try? device.makeLibrary(source: OverlayShaders.source, options: nil)
    }
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue(), let library = Self.library,
          let points = device.makeBuffer(length: MemoryLayout<CloudPoint>.stride * PointCloud.capacity, options: .storageModeShared) else { return nil }
    self.feed = feed
    self.perf = perf
    self.device = device
    self.queue = queue
    pointBuffer = points
    CVMetalTextureCacheCreate(nil, nil, device, nil, &textures)

    func state(_ vertex: String, _ fragment: String, additive: Bool = false) -> MTLRenderPipelineState? {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = library.makeFunction(name: vertex)
      d.fragmentFunction = library.makeFunction(name: fragment)
      let c = d.colorAttachments[0]!
      c.pixelFormat = .bgra8Unorm
      c.isBlendingEnabled = true
      c.rgbBlendOperation = .add
      c.alphaBlendOperation = .add
      c.sourceRGBBlendFactor = additive ? .one : .sourceAlpha
      c.destinationRGBBlendFactor = additive ? .one : .oneMinusSourceAlpha
      c.sourceAlphaBlendFactor = .one
      c.destinationAlphaBlendFactor = .oneMinusSourceAlpha
      return try? device.makeRenderPipelineState(descriptor: d)
    }
    guard let a = state("quad_vertex", "camera_ycbcr"), let b = state("quad_vertex", "camera_bgra"),
          let s = state("surface_vertex", "surface_fragment"), let g = state("surface_vertex", "surface_fragment", additive: true),
          let p = state("point_vertex", "point_fragment") else { return nil }
    cameraYCbCr = a
    cameraBGRA = b
    surfaces = s
    glows = g
    self.points = p
    super.init()
  }

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    let began = CACurrentMediaTime()
    guard let pass = view.currentRenderPassDescriptor else { return }
    let frame = feed.latest()
    let now = Float(feed.now())
    pass.colorAttachments[0].clearColor = voidView || frame == nil ? Self.voidColor : MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
    inFlight.wait()
    guard let cmd = queue.makeCommandBuffer(), let enc = cmd.makeRenderCommandEncoder(descriptor: pass), let drawable = view.currentDrawable else {
      inFlight.signal()
      return
    }
    var textures: [CVMetalTexture] = []
    if let frame {
      let size = SIMD2(Float(view.drawableSize.width), Float(view.drawableSize.height))
      let T = frame.cameraToWorld
      let eye = SIMD3(T.columns.3.x, T.columns.3.y, T.columns.3.z)
      var u = OverlayUniforms(
        viewProj: frame.geometry.projection(viewport: size) * T.inverse,
        camera: SIMD4(eye, now),
        params: SIMD4(voidView ? 1 : 0, size.y * 0.0055, reduceMotion ? 0 : 1, 0))

      if !voidView { textures = drawCamera(frame, size: size, enc: enc) }
      refresh(now: now, eye: eye)
      u.params.w = mapCellSize * 0.92

      enc.setVertexBytes(&u, length: MemoryLayout<OverlayUniforms>.stride, index: 1)
      enc.setFragmentBytes(&u, length: MemoryLayout<OverlayUniforms>.stride, index: 1)
      if let tileBuffer, tileCount > 0 {
        enc.setRenderPipelineState(surfaces)
        enc.setVertexBuffer(tileBuffer, offset: 0, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: tileCount)
      }
      if let wallBuffer, wallCount > 0 {
        enc.setRenderPipelineState(surfaces)
        enc.setVertexBuffer(wallBuffer, offset: 0, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: wallCount)
      }
      if let glowBuffer, glowCount > 0 {
        enc.setRenderPipelineState(glows)
        enc.setVertexBuffer(glowBuffer, offset: 0, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: glowCount)
      }
      if pointsUploaded > 0 {
        enc.setRenderPipelineState(points)
        enc.setVertexBuffer(pointBuffer, offset: 0, index: 0)
        enc.drawPrimitives(type: .point, vertexStart: 0, vertexCount: pointsUploaded)
      }
    }
    enc.endEncoding()
    cmd.present(drawable)
    // The camera textures (and the picture under them) live until the GPU is done with them.
    let keep = TextureHold(textures)
    let done = inFlight
    cmd.addCompletedHandler { _ in
      keep.release()
      done.signal()
    }
    cmd.commit()
    perf?.render(CACurrentMediaTime() - began)
  }

  // ---------- the camera picture ----------

  private func drawCamera(_ frame: LiveFrame, size: SIMD2<Float>, enc: MTLRenderCommandEncoder) -> [CVMetalTexture] {
    guard let cache = textures else { return [] }
    var quad = frame.geometry.backgroundQuad(viewport: size)
    var dim: Float = 0.82 // a touch darker, so the overlay reads on a bright wall
    let image = frame.image
    let format = CVPixelBufferGetPixelFormatType(image)
    func texture(_ plane: Int, _ pixel: MTLPixelFormat) -> CVMetalTexture? {
      let w = CVPixelBufferGetPlaneCount(image) == 0 ? CVPixelBufferGetWidth(image) : CVPixelBufferGetWidthOfPlane(image, plane)
      let h = CVPixelBufferGetPlaneCount(image) == 0 ? CVPixelBufferGetHeight(image) : CVPixelBufferGetHeightOfPlane(image, plane)
      var out: CVMetalTexture?
      CVMetalTextureCacheCreateTextureFromImage(nil, cache, image, nil, pixel, w, h, plane, &out)
      return out
    }
    enc.setVertexBytes(&quad, length: MemoryLayout<SIMD4<Float>>.stride * 4, index: 0)
    enc.setFragmentBytes(&dim, length: MemoryLayout<Float>.stride, index: 0)
    if format == kCVPixelFormatType_32BGRA {
      guard let t = texture(0, .bgra8Unorm), let mt = CVMetalTextureGetTexture(t) else { return [] }
      enc.setRenderPipelineState(cameraBGRA)
      enc.setFragmentTexture(mt, index: 0)
      enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
      return [t]
    }
    guard let y = texture(0, .r8Unorm), let c = texture(1, .rg8Unorm), let my = CVMetalTextureGetTexture(y), let mc = CVMetalTextureGetTexture(c) else { return [] }
    enc.setRenderPipelineState(cameraYCbCr)
    enc.setFragmentTexture(my, index: 0)
    enc.setFragmentTexture(mc, index: 1)
    enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4)
    return [y, c]
  }

  // ---------- what's been captured ----------

  private var mapCellSize: Float = 0.25

  private func refresh(now: Float, eye: SIMD3<Float>) {
    // New points, appended to the buffer the GPU already has.
    let have = pointsUploaded
    feed.cloud.copy(from: have) { fresh in
      let dst = pointBuffer.contents().advanced(by: have * MemoryLayout<CloudPoint>.stride)
      dst.copyMemory(from: fresh.baseAddress!, byteCount: fresh.count * MemoryLayout<CloudPoint>.stride)
      pointsUploaded = have + fresh.count
    }

    let walls = feed.walls.snapshot()
    if walls.version != wallVersion {
      wallVersion = walls.version
      var v: [SurfaceVertex] = []
      for w in walls.walls where w.outline.count >= 3 {
        let mid = w.outline.reduce(.zero, +) / Float(w.outline.count)
        for i in 0..<w.outline.count {
          let a = w.outline[i], b = w.outline[(i + 1) % w.outline.count]
          for p in [mid, a, b] { v.append(SurfaceVertex(pos: SIMD4(p, 0), extra: SIMD4(w.seed, Float(w.born)))) }
        }
      }
      wallBuffer = v.isEmpty ? nil : device.makeBuffer(bytes: v, length: v.count * MemoryLayout<SurfaceVertex>.stride)
      wallCount = v.count
    }

    let map = feed.map.snapshot()
    // The ceiling glows are only for what's around you, so they follow the camera a little.
    let moved = lastCamera.map { simd_distance($0, eye) > 0.5 } ?? true
    guard map.version != mapVersion || moved, let m = map.map, let floorY = m.floorY else { return }
    mapVersion = map.version
    lastCamera = eye
    mapCellSize = m.cellSize
    let ceilingY = m.ceilingY ?? floorY + 2.3
    var tiles: [SurfaceVertex] = []
    var glow: [SurfaceVertex] = []
    tiles.reserveCapacity((m.floorCovered.count * 2 + m.floorOpen.count) * 6)
    let cs = m.cellSize, inset = cs * 0.04
    func quad(_ c: Cell, y: Float, kind: Float, born: Float, into out: inout [SurfaceVertex]) {
      let x0 = Float(c.x) * cs + inset, z0 = Float(c.z) * cs + inset, x1 = x0 + cs - 2 * inset, z1 = z0 + cs - 2 * inset
      let corners: [(Float, Float, Float, Float)] = [(x0, z0, 0, 0), (x1, z0, 1, 0), (x1, z1, 1, 1), (x0, z0, 0, 0), (x1, z1, 1, 1), (x0, z1, 0, 1)]
      for (x, z, u, w) in corners { out.append(SurfaceVertex(pos: SIMD4(x, y, z, kind), extra: SIMD4(u, w, 0, born))) }
    }
    for c in m.floorCovered + m.floorOpen {
      let b = born[c] ?? now
      born[c] = b
      quad(c, y: floorY + 0.01, kind: 1, born: b, into: &tiles)
    }
    for c in m.floorCovered {
      let b = ceilingBorn[c] ?? now
      ceilingBorn[c] = b
      quad(c, y: ceilingY - 0.01, kind: 2, born: b, into: &tiles)
    }
    for c in m.floorOpen {
      let mid = SIMD2((Float(c.x) + 0.5) * cs, (Float(c.z) + 0.5) * cs)
      if simd_distance(mid, SIMD2(eye.x, eye.z)) < 4.5 { quad(c, y: ceilingY - 0.02, kind: 3, born: -10, into: &glow) }
    }
    // Gaps: a curtain from the floor to 1.3 m on each edge nobody has looked at yet.
    for g in m.gapsUnseen {
      let a0 = SIMD3(g.a.x, floorY, g.a.y), b0 = SIMD3(g.b.x, floorY, g.b.y)
      let a1 = a0 + SIMD3(0, 1.3, 0), b1 = b0 + SIMD3(0, 1.3, 0)
      let corners: [(SIMD3<Float>, Float, Float)] = [(a0, 0, 0), (b0, 1, 0), (b1, 1, 1), (a0, 0, 0), (b1, 1, 1), (a1, 0, 1)]
      for (p, along, up) in corners { glow.append(SurfaceVertex(pos: SIMD4(p, 4), extra: SIMD4(along, up, 0, 0))) }
    }
    tileBuffer = tiles.isEmpty ? nil : device.makeBuffer(bytes: tiles, length: tiles.count * MemoryLayout<SurfaceVertex>.stride)
    tileCount = tiles.count
    glowBuffer = glow.isEmpty ? nil : device.makeBuffer(bytes: glow, length: glow.count * MemoryLayout<SurfaceVertex>.stride)
    glowCount = glow.count
  }
}

private final class TextureHold: @unchecked Sendable {
  private var textures: [CVMetalTexture]
  init(_ t: [CVMetalTexture]) { textures = t }
  func release() { textures = [] }
}

// The camera picture with the overlay drawn on it, full screen.
struct OverlayView: UIViewRepresentable {
  let feed: OverlayFeed
  var perf: CapturePerf?
  var voidView: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func makeCoordinator() -> OverlayRenderer? { OverlayRenderer(feed: feed, perf: perf) }

  func makeUIView(context: Context) -> MTKView {
    let view = MTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
    view.colorPixelFormat = .bgra8Unorm
    view.framebufferOnly = true
    view.preferredFramesPerSecond = 60
    view.isOpaque = true
    view.backgroundColor = UIColor(red: 0.024, green: 0.067, blue: 0.047, alpha: 1)
    view.clearColor = OverlayRenderer.voidColor
    view.delegate = context.coordinator
    view.isAccessibilityElement = false
    return view
  }

  func updateUIView(_ view: MTKView, context: Context) {
    context.coordinator?.voidView = voidView
    context.coordinator?.reduceMotion = reduceMotion
  }
}
