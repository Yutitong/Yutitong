# Jumpsuit Collage

A browser app for making collage art on the surface of a 3D jumpsuit, then downloading
it as **print-ready sewing pattern pieces** with your artwork printed on them.

Place images on the 3D model and they are printed onto the matching flat pattern pieces,
including across seams. The side-by-side pattern view shows exactly what will print.

## Run it

```bash
cd jumpsuit-collage
npm install
npm run dev      # open the printed localhost URL
npm test         # geometry / export unit tests
npm run build    # static site in dist/ (works from any sub-path)
```

## Using it

- **Add images**: use the built-in stickers, upload your own (click or drag files onto the
  panel or straight onto the model), or make a text sticker.
- **Place**: click an image, then click the jumpsuit. Shift+click places several. You can also
  drag a thumbnail onto the model.
- **Wrap around body**: tick this for the selected image and it winds around the torso, a leg or
  an arm like a band, all the way round and continuous across every seam it crosses.
  "Fit all the way around" sizes it to just over one full turn; the overlapping ends are
  blended behind the body so there is no visible join.
- **Edit**: drag a placed image to move it. The selected image shows handles on the model:
  drag a corner to resize it (1–250 cm wide) and the round handle above it to rotate it a full
  360° (hold Shift to snap to 15°). Shift+scroll and Alt+scroll also resize and rotate.
  The right panel also has size, rotation, opacity, projection depth, flip, mirror copy (for a
  symmetric design), duplicate, layer order and delete.
- **Keys**: Ctrl/⌘+Z to undo, Ctrl/⌘+Shift+Z to redo, Delete to remove, Ctrl/⌘+D to duplicate,
  `[` `]` to rotate, `-` `=` to resize, Esc to deselect.
- **Views**: 3D, Split or Pattern.
- **Download pattern**: choose the DPI and seam allowance to get a ZIP.

## What you download

| File | Contents |
| --- | --- |
| `pieces/<id>.png` | Each piece at true scale with the collage, cut line and dashed seam line. White outside the cut line. The DPI is embedded (pHYs), so it prints at the right size. |
| `pieces/<id>.svg` | The same piece as a true-scale SVG in cm: the image plus vector cut, seam and grain lines. |
| `layout.svg` | All pieces arranged on 150 cm wide fabric, for fabric-printing services. |
| `pattern.json` | Seam, cut and grain lines in mm, for cutting software. |
| `README.txt` | Piece list and sewing order. |

The pieces are the bodice front and back, the left and right sleeves, and four trouser
pieces (front and back, left and right), with a waist seam. Cut 1 of each, because every
piece carries its own artwork.

## How it works

1. **Parametric garment** (`src/geometry/body.js`): the jumpsuit is built from smooth
   cross-sections. The torso has a shoulder dome, neckline and armholes. The sleeves are
   lofted from the exact armhole curve, and each trouser half runs from the hem up into the
   pelvis, where the inner edge becomes the crotch curve.
2. **Pattern pieces** (`src/geometry/pieces.js`): each piece is a quad grid on that surface
   (Coons-patched where the edges are curved). It is flattened with ARAP
   (as-rigid-as-possible, `src/geometry/flatten.js`, using a banded Cholesky solver). This
   keeps the mean edge-length distortion around 1% with no folds, so seams that sew together
   have matching lengths. The tests check this (side seams, inseams and waist within 2%;
   sleeve cap has normal ease).
3. **Collage baking** (`src/render/baker.js`): each piece is rasterised in pattern space
   while the shader knows the matching 3D point, and every image is projected onto that
   point. The same pass drives the 3D texture, the pattern view and the high-resolution
   tiled export, so what you see is what prints. The seam allowance is filled by extending
   the surface tangentially past each seam.
4. **Seamless across seams**: each image is a single continuous function of the 3D surface
   point, with soft fades rather than hard cut-offs. Surface normals are averaged where pieces
   meet, so both sides of a seam print the same colour. A browser check across every seam
   (side seams, inseams, crotch, waist, armholes, shoulders) found an average colour
   difference of at most about 5 out of 255.

## Limitations / ideas

- One size, roughly unisex M, and a stylised fit. A size or measurements panel would be
  the natural next step.
- No closure is drafted. Add a centre-front zip or a keyhole back when sewing.
- Your work isn't saved between sessions. Export before closing the tab.
- At 300 DPI the trouser pieces are about 5000×12500 px. Some browsers, notably Safari,
  can't make canvases that large, so use 150 DPI there.
