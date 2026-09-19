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

## Quick Start

```bash
bash run.sh
```

Then open:
- http://127.0.0.1:8123/index.html

## Tech

- HTML/CSS/JavaScript
- Canvas API for resizing
- MediaPipe Tasks Vision for browser-side face detection
- heic2any + libheif-js fallback for HEIC/HEIF

## Roadmap

- Crop and rotate tools
- Batch presets
- Metadata options