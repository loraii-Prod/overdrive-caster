# 4K replacements for the bundled Overdrive assets

Put a higher-resolution version of a bundled file here under the **same relative path and name**. The extension may
differ: an SVG can replace a PNG. Examples:

| Bundled (1080p or smaller) | 4K replacement |
| --- | --- |
| `../bar.webm` (1920×1080) | `bar.webm` (3840×2160, VP9 with alpha, same length and timing) |
| `../plate-brb.png` (1920×1080) | `plate-brb.png` (3840×2160) |
| `../mark.png` (235×180) | `mark.svg` or `mark.png` (≥ 470×360) |
| `../teams/solary.png` (64×64) | `teams/solary.svg` or `teams/solary.png` (≥ 256×256) |
| `../maps/india.jpg` (1024×1024) | `maps/india.jpg` (≥ 2320×2160) |

`npm run build` lists what is here (`shared/uhdAssets.generated.ts`). Outputs rendered at 4K use the replacement;
1080p outputs keep the original file (identical picture, no 4K decoding cost). Nothing is upscaled automatically.
Keep video replacements frame-identical in timing (stinger cut points and loop lengths are fixed in `shared/skins.ts`).
