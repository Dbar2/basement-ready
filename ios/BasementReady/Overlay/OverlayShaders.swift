// The overlay's Metal shaders, compiled when filming first starts (Metal compiles source at run time,
// so the build needs no Metal toolchain). Colours are the brand's sRGB values, written straight to an
// 8-bit (non-sRGB) target, the same as the camera picture.
enum OverlayShaders {
  static let source = #"""
#include <metal_stdlib>
using namespace metal;

struct Uniforms {
  float4x4 viewProj;
  float4 camera;  // xyz: where the camera is; w: seconds since the take's epoch
  float4 params;  // x: void view (0 or 1); y: point size at 1 m (px); z: glow pulse (0 still, 1 moving); w: tile size (m)
};

constant float3 MINT = float3(0.294, 0.890, 0.541);
constant float3 LIGHT = float3(0.957, 0.965, 0.949);

// ---------- the camera picture ----------

struct QuadOut {
  float4 position [[position]];
  float2 uv;
};

vertex QuadOut quad_vertex(uint vid [[vertex_id]], constant float4 *quad [[buffer(0)]]) {
  QuadOut o;
  o.position = float4(quad[vid].xy, 0, 1);
  o.uv = quad[vid].zw;
  return o;
}

// ARKit's full-range YCbCr (BT.601) to RGB.
fragment float4 camera_ycbcr(QuadOut in [[stage_in]], texture2d<float> lum [[texture(0)]], texture2d<float> chroma [[texture(1)]],
                             constant float &dim [[buffer(0)]]) {
  constexpr sampler s(filter::linear, address::clamp_to_edge);
  float y = lum.sample(s, in.uv).r;
  float2 c = chroma.sample(s, in.uv).rg - 0.5;
  float3 rgb = float3(y + 1.402 * c.y, y - 0.344 * c.x - 0.714 * c.y, y + 1.772 * c.x);
  return float4(saturate(rgb) * dim, 1);
}

fragment float4 camera_bgra(QuadOut in [[stage_in]], texture2d<float> tex [[texture(0)]], constant float &dim [[buffer(0)]]) {
  constexpr sampler s(filter::linear, address::clamp_to_edge);
  return float4(tex.sample(s, in.uv).rgb * dim, 1);
}

// ---------- surfaces: floor and ceiling tiles, walls, glows ----------

// kind: 0 wall, 1 floor tile, 2 filmed ceiling tile, 3 ceiling still to film (glow), 4 gap (glow)
struct SurfaceIn {
  float4 pos;    // world xyz, kind
  float4 extra;  // wall: paint seed xyz, born. tile: uv, -, born. gap: along, up, -, born
};

struct SurfaceOut {
  float4 position [[position]];
  float3 world;
  float4 extra;
  float kind;
  float dist;
};

vertex SurfaceOut surface_vertex(uint vid [[vertex_id]], constant SurfaceIn *v [[buffer(0)]], constant Uniforms &u [[buffer(1)]]) {
  SurfaceIn s = v[vid];
  float3 p = s.pos.xyz;
  int kind = int(s.pos.w + 0.5);
  if (kind >= 1 && kind <= 3) {
    // New tiles grow from their centre.
    float age = u.camera.w - s.extra.w;
    float grow = saturate(age / 0.35);
    grow = 1 - (1 - grow) * (1 - grow);
    float2 centre = p.xz - (s.extra.xy - 0.5) * u.params.w;
    p.xz = centre + (p.xz - centre) * grow;
  }
  SurfaceOut o;
  o.position = u.viewProj * float4(p, 1);
  o.world = p;
  o.extra = s.extra;
  o.kind = s.pos.w;
  o.dist = distance(p, u.camera.xyz);
  return o;
}

// Thin lines every `spacing` metres, along whichever axes change across the surface.
static float grid(float3 w, float spacing) {
  float3 c = w / spacing;
  float3 fw = fwidth(c);
  float3 g = abs(fract(c - 0.5) - 0.5) / max(fw, 1e-4);
  g = select(float3(1e6), g, fw > 1e-3);
  return 1 - saturate(min(min(g.x, g.y), g.z));
}

fragment float4 surface_fragment(SurfaceOut in [[stage_in]], constant Uniforms &u [[buffer(1)]]) {
  int kind = int(in.kind + 0.5);
  float voidView = u.params.x;
  float fade = 1 - smoothstep(6.0, 9.0, in.dist);
  float t = u.camera.w;
  float pulse = mix(0.8, 0.55 + 0.45 * sin(t * 2.6), u.params.z);
  if (kind == 0) {
    // A wall paints out from where it was first found, with a bright edge where the paint is.
    float r = (t - in.extra.w) * 2.2;
    float d = distance(in.world, in.extra.xyz);
    float painted = smoothstep(r, r - 0.35, d);
    float edge = smoothstep(0.3, 0.0, abs(d - r)) * step(d, r + 0.3) * saturate(2.5 - (t - in.extra.w));
    float lines = grid(in.world, 0.25);
    float a = (mix(0.10, 0.20, voidView) + lines * mix(0.22, 0.38, voidView)) * painted;
    float3 c = mix(LIGHT, MINT, 0.25 + 0.75 * edge);
    return float4(c, saturate(a + edge * 0.5) * fade);
  }
  if (kind == 1 || kind == 2) {
    // Floor and filmed ceiling: rounded tiles with a small gap between them.
    float2 q = abs(in.extra.xy - 0.5) * 2;
    float corner = length(max(q - 0.78, 0.0)) / 0.22;
    float inside = 1 - smoothstep(0.85, 1.0, max(max(q.x, q.y), corner));
    float base = kind == 1 ? mix(0.20, 0.34, voidView) : mix(0.10, 0.22, voidView);
    float3 c = kind == 1 ? MINT : mix(LIGHT, MINT, 0.5);
    return float4(c, base * inside * fade);
  }
  if (kind == 3) {
    // Ceiling not filmed yet: a soft breathing glow, brightest in the middle of each spot.
    float2 q = abs(in.extra.xy - 0.5) * 2;
    float soft = 1 - smoothstep(0.2, 1.0, max(q.x, q.y));
    return float4(MINT * 0.5 * soft * pulse * fade, 1);
  }
  // A gap: a curtain of light rising from the floor where nobody has looked yet.
  float up = in.extra.y;
  float curtain = pow(1 - up, 1.6) * (0.55 + 0.45 * smoothstep(0.0, 0.08, up));
  float base = smoothstep(0.06, 0.0, up);
  return float4(MINT * (curtain * 0.8 + base * 0.9) * pulse * fade, 1);
}

// ---------- the point cloud ----------

struct PointIn {
  float4 p;    // world xyz, born
  uchar4 c;
};

struct PointOut {
  float4 position [[position]];
  float size [[point_size]];
  float4 color;
};

vertex PointOut point_vertex(uint vid [[vertex_id]], constant PointIn *pts [[buffer(0)]], constant Uniforms &u [[buffer(1)]]) {
  PointIn p = pts[vid];
  PointOut o;
  o.position = u.viewProj * float4(p.p.xyz, 1);
  float age = max(0.0, u.camera.w - p.p.w);
  float flash = exp(-age * 3.0);
  float depth = max(o.position.w, 0.15);
  float scale = mix(1.0, 1.35, u.params.x);
  o.size = clamp(u.params.y * scale / depth, 2.0, 16.0) * (1 + 1.1 * flash);
  float3 c = float3(p.c.rgb) / 255.0;
  float fade = 1 - smoothstep(6.0, 9.0, depth);
  o.color = float4(mix(c, MINT, 0.7 * flash), fade);
  return o;
}

fragment float4 point_fragment(PointOut in [[stage_in]], float2 pc [[point_coord]]) {
  float d = length(pc - 0.5) * 2;
  if (d > 1) discard_fragment();
  return float4(in.color.rgb, in.color.a * (1 - smoothstep(0.65, 1.0, d)));
}
"""#
}
