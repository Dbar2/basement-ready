# Basement Ready: Blender spec (Fresh Air)

For 3D brand assets in the demo video: the logo object, hero cutaway and title cards. Locked Oct 28, 2026. Blender base colours are **linear RGB**; web hex is sRGB.

| Role | sRGB | Linear RGB (Base Color) |
|---|---|---|
| Background (world, walls) | `#F4F6F2` | `(0.905, 0.922, 0.888)` |
| Card | `#FBFCFA` | `(0.965, 0.973, 0.956)` |
| Surface | `#E6EBE4` | `(0.791, 0.831, 0.776)` |
| Forest ink (structure, logo) | `#0F2A1E` | `(0.005, 0.023, 0.013)` |
| Mint (glow, selected) | `#4BE38A` | `(0.070, 0.768, 0.254)` |
| Mint line | `#2E9A5C` | `(0.027, 0.323, 0.107)` |
| Oak floor | `#C9A57A` | `(0.584, 0.376, 0.195)` |
| Sage cabinets | `#9DAA9A` | `(0.337, 0.402, 0.323)` |

- **Lighting:** soft, airy daylight. Key around 5600 K from a large area light, gentle bounce, and a world colour matching the background. No coloured rim lights.
- **Mint** is emissive only on scan points and selection highlights (strength 2–4). Structure is matte forest green.
- **Materials:** matte, roughness 0.6–0.85, like an architect's model.
- **Shading:** flat shading on brand assets.
- **Files:** one .blend per asset under `brand/3d/`. The brand is locked before rendering.
