# PhotoStudio

PhotoStudio is a local-first browser image toolkit.

Current feature (v1):
- Resize images in browser and export JPG
- Drag and drop UI
- HEIC/HEIF, JPG, PNG, WEBP, BMP, TIFF input support
- Pre-scan unsupported files before batch processing, then report skipped filenames
- Batch rename options: custom rename text, number position (prefix/middle/suffix), digit count, separator char
- Light / dark theme toggle
- Optional face detection mask with blur / pixelate / emoji cover
- No upload: all processing runs locally in your browser
- Bundled local runtime assets for MediaPipe, HEIC decoding, and face-detection model

## Quick Start

```bash
bash run.sh
```

Then open:
- http://127.0.0.1:8123/index.html

## Tech

- HTML/CSS/JavaScript
- Canvas API for resizing
- MediaPipe Tasks Vision with locally bundled WASM + face detector model
- heic2any + libheif-js fallback for HEIC/HEIF, bundled locally

## Privacy / Local-first

- Images stay in the browser and are never uploaded by PhotoStudio
- MediaPipe WASM, the face detector model, and HEIC decoding libraries are served from this repository
- Open via `http://127.0.0.1:8123/index.html` instead of `file://` so browser WASM loading works reliably

## Roadmap

- Crop and rotate tools
- Batch presets
- Metadata options