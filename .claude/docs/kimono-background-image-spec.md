# Kimono Background Image Specification

## Required Image Specs

| Property | Value | Notes |
|----------|-------|-------|
| **Resolution** | **2048 x 2048 px** | Power-of-2 for GPU efficiency. Matches atlas size. |
| **Format** | PNG or JPG | PNG for lossless quality; JPG for smaller file size (~60-70% quality is fine) |
| **Color space** | sRGB | Standard web color space |
| **Aspect ratio** | 1:1 (square) | Will be mapped to world coords (8.4 x 5.2), so visible area may crop top/bottom |
| **File location** | `public/sakura/kimono_bg.png` (or `.jpg`) | Alongside existing atlas |

## Important Notes

### Coordinate Alignment

The sakura segments were extracted from an original 1042 x 1042 px source image ("花陽ひいなかた-2"). The `bboxInSource` coordinates in the manifest reference this original image space.

**The background image MUST be the same composition as the original source image** so that segment positions align correctly. If the image is resized to 2048x2048, it must be a proportional upscale (no cropping, no padding that shifts content).

### World Space Mapping

- The image will be displayed as a plane covering `KIMONO_WIDTH x KIMONO_HEIGHT` (8.4 x 5.2 world units)
- Current source is square (1042x1042), but world space is wider than tall
- Options:
  1. **Letterbox**: Show full image with black bars on sides (preserves all content)
  2. **Crop**: Fill world rect, crop top/bottom of image (fills screen better)
  3. **Stretch**: Distort to fit (not recommended)
- **Recommendation**: Provide a square 2048x2048 image. The renderer will handle the mapping.

### Acceptable Alternatives

| Resolution | Acceptable? | Notes |
|-----------|-------------|-------|
| 2048 x 2048 | Best | Optimal GPU texture size |
| 1024 x 1024 | OK | Lighter, slightly lower quality |
| 4096 x 4096 | OK | Higher quality, larger download |
| Non-square | OK | Will be UV-mapped to fit, may need adjustment |

### File Size Guidelines

| Format | Expected Size (2048x2048) |
|--------|--------------------------|
| PNG | 2-8 MB (depending on complexity) |
| JPG (quality 80) | 200-800 KB |
| WebP (quality 80) | 150-500 KB |

JPG or WebP is recommended for faster loading unless transparency is needed.
