const fileInput = document.getElementById('fileInput');
const maxEdgeInput = document.getElementById('maxEdge');
const qualityInput = document.getElementById('quality');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const renameModeInput = document.getElementById('renameMode');
const renameTextInput = document.getElementById('renameText');
const renameDigitsInput = document.getElementById('renameDigits');
const renameSeparatorInput = document.getElementById('renameSeparator');
const themeToggleBtn = document.getElementById('themeToggle');
const faceDetectionEnabledInput = document.getElementById('faceDetectionEnabled');
const faceEffectInput = document.getElementById('faceEffect');
const faceConfidenceInput = document.getElementById('faceConfidence');
const faceConfidenceValueEl = document.getElementById('faceConfidenceValue');
const effectStrengthInput = document.getElementById('effectStrength');
const effectStrengthValueEl = document.getElementById('effectStrengthValue');
const effectStrengthLabelEl = document.getElementById('effectStrengthLabel');
const effectStrengthHintEl = document.getElementById('effectStrengthHint');
const statusEl = document.getElementById('status');
const reportEl = document.getElementById('report');
const countEl = document.getElementById('count');
const resultList = document.getElementById('resultList');
const dropZone = document.getElementById('dropZone');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');

let processedItems = [];
let selectedFiles = [];
let faceDetectorPromise = null;
let faceDetector = null;
let faceDetectorConfidence = null;
const LOCAL_FACE_TASKS_MODULE = './vendor/mediapipe/vision_bundle.mjs';
const LOCAL_FACE_WASM_DIR = './vendor/mediapipe/wasm';
const LOCAL_FACE_MODEL_PATH = './vendor/models/blaze_face_short_range.tflite';
const FACE_DETECTOR_DELEGATES = ['GPU', 'CPU'];
const DEFAULT_FACE_DETECTION_CONFIDENCE = 0.4;
const FACE_DETECT_MAX_EDGE = 1920;
const FACE_CANDIDATE_IOU_THRESHOLD = 0.45;
const MAX_FACE_CANDIDATES = 10;
const FACE_LOWER_REGION_SUPPRESS_Y = 0.72;
const FACE_ROI_SCAN_REGIONS = [
  { x: 0, y: 0, width: 1, height: 0.74, weightBoost: 0.24 },
  { x: 0.08, y: 0.03, width: 0.84, height: 0.7, weightBoost: 0.2 },
];

const EFFECT_STRENGTH_CONFIG = {
  blur: {
    label: 'Blur 濃度',
    hint: '越高越朦，遮蔽力更強。',
    min: 0.6,
    max: 2.5,
    step: 0.05,
    defaultValue: 1,
  },
  pixelate: {
    label: '打碼濃度',
    hint: '越高格仔越粗，越難辨認。',
    min: 0.6,
    max: 2.5,
    step: 0.05,
    defaultValue: 1,
  },
  emoji: {
    label: 'Emoji 覆蓋濃度',
    hint: '越高遮蓋底色越深、emoji 越搶眼。',
    min: 0.6,
    max: 2,
    step: 0.05,
    defaultValue: 1,
  },
};

const effectStrengthState = {
  blur: EFFECT_STRENGTH_CONFIG.blur.defaultValue,
  pixelate: EFFECT_STRENGTH_CONFIG.pixelate.defaultValue,
  emoji: EFFECT_STRENGTH_CONFIG.emoji.defaultValue,
};

let supportsCanvasBlurFilterCache = null;

const supportedExtensions = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
]);

function setStatus(text) {
  statusEl.textContent = text;
}

function setReport(text) {
  reportEl.textContent = text;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function getOutputName(name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.jpg`;
}

function getBaseName(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function getExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function isSupportedInputFile(file) {
  if (isHeicFile(file)) {
    return true;
  }

  if (supportedExtensions.has(getExtension(file.name))) {
    return true;
  }

  return typeof file.type === 'string' && file.type.startsWith('image/');
}

function splitFilesBySupport(files) {
  const supportedFiles = [];
  const unsupportedFiles = [];
  for (const file of files) {
    if (isSupportedInputFile(file)) {
      supportedFiles.push(file);
    } else {
      unsupportedFiles.push(file);
    }
  }
  return { supportedFiles, unsupportedFiles };
}

function joinWithSeparator(left, right, separator) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left}${separator}${right}`;
}

function buildOutputName(file, outputIndex, renameOptions) {
  if (renameOptions.mode === 'keep') {
    return getOutputName(file.name);
  }

  const base = renameOptions.text || getBaseName(file.name);
  const number = String(outputIndex + 1).padStart(renameOptions.digits, '0');
  const separator = renameOptions.separator;

  if (renameOptions.mode === 'prefix') {
    return `${joinWithSeparator(number, base, separator)}.jpg`;
  }

  if (renameOptions.mode === 'middle') {
    const splitAt = Math.ceil(base.length / 2);
    const left = base.slice(0, splitAt);
    const right = base.slice(splitAt);
    const firstPart = joinWithSeparator(left, number, separator);
    return `${joinWithSeparator(firstPart, right, separator)}.jpg`;
  }

  return `${joinWithSeparator(base, number, separator)}.jpg`;
}

function getRenameOptions() {
  const mode = renameModeInput.value;
  const text = (renameTextInput.value || '').trim().slice(0, 80);
  renameTextInput.value = text;
  const digits = clampInteger(renameDigitsInput.value, 1, 12, 3);
  renameDigitsInput.value = String(digits);
  const separator = (renameSeparatorInput.value || '').slice(0, 8);
  renameSeparatorInput.value = separator;

  return {
    mode: ['keep', 'prefix', 'middle', 'suffix'].includes(mode) ? mode : 'keep',
    text,
    digits,
    separator,
  };
}

function getFaceOptions() {
  const effect = faceEffectInput.value;
  const effectConfig = EFFECT_STRENGTH_CONFIG[effect] || EFFECT_STRENGTH_CONFIG.blur;
  const confidence = clampNumber(faceConfidenceInput.value, 0.1, 0.95, DEFAULT_FACE_DETECTION_CONFIDENCE);
  const currentEffectStrength = clampNumber(
    effectStrengthInput.value,
    effectConfig.min,
    effectConfig.max,
    effectConfig.defaultValue
  );

  faceConfidenceInput.value = confidence.toFixed(2);
  effectStrengthState[effect] = currentEffectStrength;
  effectStrengthInput.value = currentEffectStrength.toFixed(2);

  const blurStrength = clampNumber(
    effect === 'blur' ? currentEffectStrength : effectStrengthState.blur,
    EFFECT_STRENGTH_CONFIG.blur.min,
    EFFECT_STRENGTH_CONFIG.blur.max,
    EFFECT_STRENGTH_CONFIG.blur.defaultValue
  );
  const pixelateStrength = clampNumber(
    effect === 'pixelate' ? currentEffectStrength : effectStrengthState.pixelate,
    EFFECT_STRENGTH_CONFIG.pixelate.min,
    EFFECT_STRENGTH_CONFIG.pixelate.max,
    EFFECT_STRENGTH_CONFIG.pixelate.defaultValue
  );
  const emojiStrength = clampNumber(
    effect === 'emoji' ? currentEffectStrength : effectStrengthState.emoji,
    EFFECT_STRENGTH_CONFIG.emoji.min,
    EFFECT_STRENGTH_CONFIG.emoji.max,
    EFFECT_STRENGTH_CONFIG.emoji.defaultValue
  );

  return {
    enabled: faceDetectionEnabledInput.checked,
    effect: ['blur', 'pixelate', 'emoji'].includes(effect) ? effect : 'blur',
    confidence,
    blurStrength,
    pixelateStrength,
    emojiStrength,
  };
}

function formatNameList(files) {
  if (files.length === 0) {
    return '';
  }
  return files.map((file) => file.name).join('、');
}

function isHeicFile(file) {
  const lower = file.name.toLowerCase();
  return (
    lower.endsWith('.heic') ||
    lower.endsWith('.heif') ||
    file.type === 'image/heic' ||
    file.type === 'image/heif'
  );
}

function hasHeicDecoder() {
  return typeof window.heic2any === 'function';
}

function hasLibheifDecoder() {
  return typeof window.libheif !== 'undefined' && typeof window.libheif.HeifDecoder === 'function';
}

let libheifModulePromise = null;

async function ensureLibheifReady() {
  if (hasLibheifDecoder()) {
    return window.libheif;
  }

  if (typeof window.libheif === 'function') {
    if (!libheifModulePromise) {
      libheifModulePromise = Promise.resolve(window.libheif()).catch(() => null);
    }
    const maybeModule = await libheifModulePromise;
    if (maybeModule && typeof maybeModule.HeifDecoder === 'function') {
      window.libheif = maybeModule;
      return maybeModule;
    }
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (hasLibheifDecoder()) {
      return window.libheif;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error('libheif 解碼器未完成初始化');
}

async function convertHeicToJpegBlob(file) {
  if (!hasHeicDecoder()) {
    throw new Error('HEIC 轉換器未載入，請先連上網絡再重開頁面。');
  }

  const converted = await window.heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 1,
  });

  if (Array.isArray(converted)) {
    return converted[0];
  }
  return converted;
}

async function convertHeicWithLibheif(file) {
  const libheif = await ensureLibheifReady();

  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(bytes);

  if (!images || images.length === 0) {
    throw new Error('libheif 無法解碼此 HEIC');
  }

  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);

  await new Promise((resolve, reject) => {
    image.display(imageData, (displayData) => {
      if (!displayData) {
        reject(new Error('libheif 顯示資料失敗'));
        return;
      }
      resolve();
    });
  });

  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error('libheif 輸出失敗'));
          return;
        }
        resolve(result);
      },
      'image/jpeg',
      1
    );
  });

  return blob;
}

function getFileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function renderQueue() {
  queueList.innerHTML = '';

  if (selectedFiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '未有檔案，拖放相片到上方即可。';
    queueList.appendChild(empty);
  } else {
    for (let i = 0; i < selectedFiles.length; i += 1) {
      const file = selectedFiles[i];
      const row = document.createElement('div');
      row.className = 'queue-item';

      const name = document.createElement('p');
      name.className = 'queue-name';
      name.textContent = file.name;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'queue-remove';
      remove.textContent = '移除';
      remove.addEventListener('click', () => {
        selectedFiles.splice(i, 1);
        renderQueue();
        setStatus(`已移除 ${file.name}`);
      });

      row.appendChild(name);
      row.appendChild(remove);
      queueList.appendChild(row);
    }
  }

  queueCount.textContent = `${selectedFiles.length} 個檔案`;
}

function addFiles(newFiles) {
  const map = new Map(selectedFiles.map((file) => [getFileKey(file), file]));
  for (const file of newFiles) {
    map.set(getFileKey(file), file);
  }
  selectedFiles = Array.from(map.values());
  renderQueue();
  setStatus(`已加入 ${newFiles.length} 個檔案，現有 ${selectedFiles.length} 個`);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`無法讀取圖片：${file.name}`));
    };

    img.src = url;
  });
}

async function ensureFaceDetector(confidence = DEFAULT_FACE_DETECTION_CONFIDENCE) {
  const normalizedConfidence = clampNumber(confidence, 0.1, 0.95, DEFAULT_FACE_DETECTION_CONFIDENCE);

  if (faceDetector && faceDetectorConfidence !== null && Math.abs(faceDetectorConfidence - normalizedConfidence) < 0.0001) {
    return faceDetector;
  }

  if (faceDetector && typeof faceDetector.close === 'function') {
    try {
      faceDetector.close();
    } catch (error) {
      // ignore close errors
    }
  }

  faceDetector = null;
  faceDetectorPromise = null;
  faceDetectorConfidence = null;

  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import(LOCAL_FACE_TASKS_MODULE);
      const fileset = await FilesetResolver.forVisionTasks(LOCAL_FACE_WASM_DIR);
      let lastError = null;

      for (const delegate of FACE_DETECTOR_DELEGATES) {
        try {
            const detector = await FaceDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: LOCAL_FACE_MODEL_PATH,
              delegate,
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: normalizedConfidence,
          });

          faceDetector = detector;
          faceDetectorConfidence = normalizedConfidence;
          return detector;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error('FACE_DETECTOR_INIT_FAILED');
    })().catch((error) => {
      faceDetector = null;
      faceDetectorConfidence = null;
      faceDetectorPromise = null;
      throw error;
    });
  }

  return faceDetectorPromise;
}

function normalizeFaceRect(boundingBox, canvas) {
  const x = Math.max(0, Math.floor(boundingBox.originX || 0));
  const y = Math.max(0, Math.floor(boundingBox.originY || 0));
  const width = Math.min(canvas.width - x, Math.ceil(boundingBox.width || 0));
  const height = Math.min(canvas.height - y, Math.ceil(boundingBox.height || 0));

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function fitRectInCanvas(rect, canvas) {
  const x = Math.max(0, Math.min(canvas.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.round(rect.y)));
  const width = Math.max(1, Math.min(canvas.width - x, Math.round(rect.width)));
  const height = Math.max(1, Math.min(canvas.height - y, Math.round(rect.height)));
  return { x, y, width, height };
}

function tuneFaceRect(rect, canvas, effect) {
  const widthRatio = effect === 'emoji' ? 0.92 : 0.9;
  const heightRatio = effect === 'emoji' ? 0.84 : 0.86;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height * 0.46;
  const tunedRect = {
    x: centerX - (rect.width * widthRatio) / 2,
    y: centerY - (rect.height * heightRatio) / 2,
    width: rect.width * widthRatio,
    height: rect.height * heightRatio,
  };

  return fitRectInCanvas(tunedRect, canvas);
}

function supportsCanvasBlurFilter() {
  if (supportsCanvasBlurFilterCache !== null) {
    return supportsCanvasBlurFilterCache;
  }

  const probe = document.createElement('canvas');
  probe.width = 10;
  probe.height = 10;
  const probeCtx = probe.getContext('2d');

  if (!probeCtx || typeof probeCtx.filter !== 'string') {
    supportsCanvasBlurFilterCache = false;
    return supportsCanvasBlurFilterCache;
  }

  probeCtx.fillStyle = '#000000';
  probeCtx.fillRect(0, 0, 5, 10);
  probeCtx.fillStyle = '#ffffff';
  probeCtx.fillRect(5, 0, 5, 10);

  const blurred = document.createElement('canvas');
  blurred.width = 10;
  blurred.height = 10;
  const blurredCtx = blurred.getContext('2d');

  if (!blurredCtx || typeof blurredCtx.filter !== 'string') {
    supportsCanvasBlurFilterCache = false;
    return supportsCanvasBlurFilterCache;
  }

  blurredCtx.filter = 'blur(2px)';
  blurredCtx.drawImage(probe, 0, 0);

  const centerPixel = blurredCtx.getImageData(5, 5, 1, 1).data[0];
  supportsCanvasBlurFilterCache = centerPixel > 15 && centerPixel < 240;
  return supportsCanvasBlurFilterCache;
}

function createRegionCanvas(sourceCanvas, rect, paddingRatio = 0.15) {
  const padX = Math.round(rect.width * paddingRatio);
  const padY = Math.round(rect.height * paddingRatio);
  const sx = Math.max(0, rect.x - padX);
  const sy = Math.max(0, rect.y - padY);
  const sw = Math.min(sourceCanvas.width - sx, rect.width + padX * 2);
  const sh = Math.min(sourceCanvas.height - sy, rect.height + padY * 2);
  const regionCanvas = document.createElement('canvas');
  regionCanvas.width = sw;
  regionCanvas.height = sh;
  const regionCtx = regionCanvas.getContext('2d');
  regionCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return { regionCanvas, sx, sy, sw, sh };
}

function applyBlurMaskFallback(ctx, sourceCanvas, sx, sy, sw, sh, blurRadius) {
  const strength = Math.max(8, Math.round(blurRadius * 1.1));
  const tinyCanvas = document.createElement('canvas');
  tinyCanvas.width = Math.max(1, Math.round(sw / strength));
  tinyCanvas.height = Math.max(1, Math.round(sh / strength));
  const tinyCtx = tinyCanvas.getContext('2d');
  tinyCtx.imageSmoothingEnabled = true;
  tinyCtx.imageSmoothingQuality = 'high';
  tinyCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, tinyCanvas.width, tinyCanvas.height);

  const blurredCanvas = document.createElement('canvas');
  blurredCanvas.width = sw;
  blurredCanvas.height = sh;
  const blurredCtx = blurredCanvas.getContext('2d');
  blurredCtx.imageSmoothingEnabled = true;
  blurredCtx.imageSmoothingQuality = 'high';
  blurredCtx.drawImage(tinyCanvas, 0, 0, tinyCanvas.width, tinyCanvas.height, 0, 0, sw, sh);

  ctx.drawImage(blurredCanvas, sx, sy);
}

function applyBlurMask(ctx, sourceCanvas, rect, intensity = 1) {
  const blurIntensity = clampNumber(intensity, 0.6, 2.5, 1);
  const { regionCanvas, sx, sy, sw, sh } = createRegionCanvas(sourceCanvas, rect, 0.14);
  const blurRadius = Math.max(10, Math.round((Math.min(rect.width, rect.height) / 5) * blurIntensity));

  if (!supportsCanvasBlurFilter()) {
    applyBlurMaskFallback(ctx, sourceCanvas, sx, sy, sw, sh, blurRadius);
    return;
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.filter = `blur(${blurRadius}px)`;
  tempCtx.drawImage(regionCanvas, 0, 0, sw, sh);
  ctx.drawImage(tempCanvas, sx, sy);
}

function applyPixelateMask(ctx, sourceCanvas, rect, intensity = 1) {
  const pixelateIntensity = clampNumber(intensity, 0.6, 2.5, 1);
  const sampleCanvas = document.createElement('canvas');
  const sampleScale = Math.max(4, Math.round((Math.min(rect.width, rect.height) / 12) * pixelateIntensity));
  sampleCanvas.width = Math.max(1, Math.round(rect.width / sampleScale));
  sampleCanvas.height = Math.max(1, Math.round(rect.height / sampleScale));
  const sampleCtx = sampleCanvas.getContext('2d');
  sampleCtx.drawImage(
    sourceCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    sampleCanvas.width,
    sampleCanvas.height
  );

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sampleCanvas, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function applyEmojiMask(ctx, rect, intensity = 1) {
  const emojiIntensity = clampNumber(intensity, 0.6, 2, 1);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const radiusX = (rect.width / 2) * Math.min(1.08, 0.9 + emojiIntensity * 0.1);
  const radiusY = (rect.height / 2) * Math.min(1.04, 0.88 + emojiIntensity * 0.08);
  const fontSize = Math.round(Math.max(rect.height, rect.width) * (0.76 + emojiIntensity * 0.28));
  const backdropAlpha = Math.max(0.35, Math.min(0.82, 0.35 + emojiIntensity * 0.23));

  ctx.save();
  ctx.fillStyle = `rgba(8, 17, 31, ${backdropAlpha.toFixed(2)})`;
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = `${fontSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('🙈', centerX, centerY + rect.height * 0.02);
  ctx.restore();
}

function createDetectionInputCanvas(source, sourceSize) {
  if (source && source.tagName === 'CANVAS') {
    return source;
  }

  const width = Math.max(1, Math.round(sourceSize?.width || source?.width || 1));
  const height = Math.max(1, Math.round(sourceSize?.height || source?.height || 1));
  const scale = Math.min(1, FACE_DETECT_MAX_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return canvas;
}

function createContrastNormalizedCanvas(sourceCanvas) {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let minLuma = 255;
  let maxLuma = 0;

  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (luma < minLuma) {
      minLuma = luma;
    }
    if (luma > maxLuma) {
      maxLuma = luma;
    }
  }

  const lumaRange = Math.max(1, maxLuma - minLuma);
  if (lumaRange < 12) {
    return null;
  }

  const gamma = 0.92;
  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const stretched = Math.max(0, Math.min(1, (luma - minLuma) / lumaRange));
    const corrected = Math.pow(stretched, gamma);
    const gray = Math.round(corrected * 255);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function createSoftenedCanvas(sourceCanvas) {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const gamma = 1.18;

  for (let i = 0; i < data.length; i += 4) {
    const r = Math.pow(data[i] / 255, gamma) * 255;
    const g = Math.pow(data[i + 1] / 255, gamma) * 255;
    const b = Math.pow(data[i + 2] / 255, gamma) * 255;
    data[i] = Math.min(255, Math.max(0, Math.round(r + 4)));
    data[i + 1] = Math.min(255, Math.max(0, Math.round(g + 4)));
    data[i + 2] = Math.min(255, Math.max(0, Math.round(b + 4)));
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function createRoiScanCanvas(sourceCanvas, region) {
  const sx = Math.max(0, Math.round(sourceCanvas.width * region.x));
  const sy = Math.max(0, Math.round(sourceCanvas.height * region.y));
  const sw = Math.max(1, Math.round(sourceCanvas.width * region.width));
  const sh = Math.max(1, Math.round(sourceCanvas.height * region.height));
  const clippedWidth = Math.min(sw, sourceCanvas.width - sx);
  const clippedHeight = Math.min(sh, sourceCanvas.height - sy);

  if (clippedWidth <= 0 || clippedHeight <= 0) {
    return null;
  }

  const roiCanvas = document.createElement('canvas');
  roiCanvas.width = clippedWidth;
  roiCanvas.height = clippedHeight;
  const roiCtx = roiCanvas.getContext('2d');
  roiCtx.imageSmoothingEnabled = true;
  roiCtx.imageSmoothingQuality = 'high';
  roiCtx.drawImage(
    sourceCanvas,
    sx,
    sy,
    clippedWidth,
    clippedHeight,
    0,
    0,
    clippedWidth,
    clippedHeight
  );

  return {
    canvas: roiCanvas,
    sx,
    sy,
    sw: clippedWidth,
    sh: clippedHeight,
  };
}

function mapRectFromRoiToBase(rect, roiMeta) {
  if (!roiMeta || roiMeta.sw <= 0 || roiMeta.sh <= 0) {
    return rect;
  }

  return {
    x: roiMeta.sx + rect.x,
    y: roiMeta.sy + rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function getDetectionVariants(baseCanvas) {
  const variants = [{ canvas: baseCanvas, weight: 1 }];
  const normalized = createContrastNormalizedCanvas(baseCanvas);
  if (normalized) {
    variants.push({ canvas: normalized, weight: 0.92 });
  }

  const softened = createSoftenedCanvas(baseCanvas);
  variants.push({ canvas: softened, weight: 0.86 });
  return variants;
}

function computeRectIoU(a, b) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) {
    return 0;
  }

  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function getDetectionScore(detection) {
  const score = detection?.categories?.[0]?.score;
  return Number.isFinite(score) ? score : 0;
}

function isLikelyFaceRect(rect, canvas) {
  const area = rect.width * rect.height;
  const totalArea = canvas.width * canvas.height;
  const areaRatio = totalArea > 0 ? area / totalArea : 0;
  const aspect = rect.width / Math.max(1, rect.height);
  const centerY = (rect.y + rect.height * 0.5) / Math.max(1, canvas.height);

  if (aspect < 0.55 || aspect > 1.7) {
    return false;
  }
  if (areaRatio < 0.00025 || areaRatio > 0.65) {
    return false;
  }
  if (centerY > 0.86) {
    return false;
  }
  if (rect.y > canvas.height * 0.74 && rect.height > canvas.height * 0.18) {
    return false;
  }

  return true;
}

function rankFaceCandidate(rect, canvas, baseScore, variantWeight) {
  const area = rect.width * rect.height;
  const totalArea = Math.max(1, canvas.width * canvas.height);
  const areaRatio = area / totalArea;
  const aspect = rect.width / Math.max(1, rect.height);
  const centerY = (rect.y + rect.height * 0.5) / Math.max(1, canvas.height);
  const aspectScore = Math.max(0, 1 - Math.abs(aspect - 1) / 0.7);
  const sizeScore = Math.max(0, 1 - Math.abs(areaRatio - 0.035) / 0.08);
  const positionScore = centerY < 0.62 ? 1 : centerY < 0.74 ? 0.8 : 0.35;

  return baseScore * 1.45 + aspectScore * 0.85 + sizeScore * 0.4 + positionScore * 0.45 + variantWeight;
}

function suppressLowerRegionFalsePositives(candidates, canvas) {
  if (candidates.length === 0 || canvas.height <= 0) {
    return candidates;
  }

  const hasUpperStrongCandidate = candidates.some((candidate) => {
    const centerY = (candidate.rect.y + candidate.rect.height * 0.5) / canvas.height;
    return centerY < 0.66 && candidate.score > 1.45;
  });

  if (!hasUpperStrongCandidate) {
    return candidates;
  }

  return candidates.map((candidate) => {
    const centerY = (candidate.rect.y + candidate.rect.height * 0.5) / canvas.height;
    if (centerY > FACE_LOWER_REGION_SUPPRESS_Y) {
      return {
        ...candidate,
        score: candidate.score - 0.85,
      };
    }
    return candidate;
  });
}

async function detectFaces(source, confidence, sourceSize) {
  const detector = await ensureFaceDetector(confidence);
  const baseCanvas = createDetectionInputCanvas(source, sourceSize);
  const scanTargets = [{ canvas: baseCanvas, roiMeta: null, weightBoost: 0 }];
  for (const region of FACE_ROI_SCAN_REGIONS) {
    const roi = createRoiScanCanvas(baseCanvas, region);
    if (roi) {
      scanTargets.push({ canvas: roi.canvas, roiMeta: roi, weightBoost: region.weightBoost || 0 });
    }
  }

  const candidates = [];

  for (const target of scanTargets) {
    const variants = getDetectionVariants(target.canvas);
    for (const variant of variants) {
      const result = detector.detect(variant.canvas);
      const detections = result?.detections || [];

      for (const detection of detections) {
        const variantRect = normalizeFaceRect(detection.boundingBox, variant.canvas);
        if (!variantRect) {
          continue;
        }

        const rect = mapRectFromRoiToBase(variantRect, target.roiMeta);
        if (!isLikelyFaceRect(rect, baseCanvas)) {
          continue;
        }

        const candidateScore = rankFaceCandidate(
          rect,
          baseCanvas,
          getDetectionScore(detection),
          variant.weight + target.weightBoost
        );
        candidates.push({ rect, score: candidateScore });
      }
    }
  }

  if (candidates.length === 0) {
    return { faces: [], detectSize: { width: baseCanvas.width, height: baseCanvas.height } };
  }

  const refinedCandidates = suppressLowerRegionFalsePositives(candidates, baseCanvas);

  refinedCandidates.sort((a, b) => b.score - a.score);
  const uniqueRects = [];

  for (const candidate of refinedCandidates) {
    const isDuplicate = uniqueRects.some((kept) => computeRectIoU(kept, candidate.rect) >= FACE_CANDIDATE_IOU_THRESHOLD);
    if (isDuplicate) {
      continue;
    }

    uniqueRects.push(candidate.rect);
    if (uniqueRects.length >= MAX_FACE_CANDIDATES) {
      break;
    }
  }

  return {
    faces: uniqueRects,
    detectSize: {
      width: baseCanvas.width,
      height: baseCanvas.height,
    },
  };
}

function mapRectToCanvas(rect, sourceWidth, sourceHeight, targetCanvas) {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetCanvas.width <= 0 || targetCanvas.height <= 0) {
    return null;
  }

  const scaleX = targetCanvas.width / sourceWidth;
  const scaleY = targetCanvas.height / sourceHeight;
  const mappedRect = {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };

  return fitRectInCanvas(mappedRect, targetCanvas);
}

async function applyFaceEffects(canvas, faceOptions, detectSource, detectSourceSize) {
  const sourceForDetect = detectSource || canvas;
  const sourceSize = detectSourceSize || { width: canvas.width, height: canvas.height };
  const detectionResult = await detectFaces(sourceForDetect, faceOptions.confidence, sourceSize);
  const sourceFaces = detectionResult.faces;
  const detectSize = detectionResult.detectSize;
  const faces = sourceFaces
    .map((rect) => mapRectToCanvas(rect, detectSize.width, detectSize.height, canvas))
    .filter(Boolean);

  if (faces.length === 0) {
    return 0;
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = canvas.width;
  sourceCanvas.height = canvas.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.drawImage(canvas, 0, 0);

  const ctx = canvas.getContext('2d');
  for (const rawRect of faces) {
    const rect = tuneFaceRect(rawRect, canvas, faceOptions.effect);
    if (faceOptions.effect === 'emoji') {
      applyEmojiMask(ctx, rect, faceOptions.emojiStrength);
    } else if (faceOptions.effect === 'pixelate') {
      applyPixelateMask(ctx, sourceCanvas, rect, faceOptions.pixelateStrength);
    } else {
      applyBlurMask(ctx, sourceCanvas, rect, faceOptions.blurStrength);
    }
  }

  return faces.length;
}

async function resizeFile(file, maxEdge, qualityPercent, faceOptions) {
  let image;

  if (isHeicFile(file)) {
    try {
      image = await loadImage(file);
    } catch (nativeError) {
      try {
        const sourceBlob = await convertHeicToJpegBlob(file);
        const inputFile = new File([sourceBlob], file.name, {
          type: sourceBlob.type || 'image/jpeg',
          lastModified: file.lastModified,
        });
        image = await loadImage(inputFile);
      } catch (convertError) {
        try {
          const sourceBlob = await convertHeicWithLibheif(file);
          const inputFile = new File([sourceBlob], file.name, {
            type: 'image/jpeg',
            lastModified: file.lastModified,
          });
          image = await loadImage(inputFile);
        } catch (libheifError) {
          throw new Error(
            `HEIC 暫不支援呢張相片格式：${file.name}（${convertError.message || 'ERR_LIBHEIF'} / ${libheifError.message || 'libheif failed'}）`
          );
        }
      }
    }
  } else {
    image = await loadImage(file);
  }

  const ow = image.width;
  const oh = image.height;

  const scale = Math.min(1, maxEdge / Math.max(ow, oh));
  const nw = Math.max(1, Math.round(ow * scale));
  const nh = Math.max(1, Math.round(oh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, nw, nh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, nw, nh);

  let faceCount = 0;
  if (faceOptions.enabled) {
    faceCount = await applyFaceEffects(
      canvas,
      faceOptions,
      image,
      {
        width: ow,
        height: oh,
      }
    );
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) {
          reject(new Error(`輸出失敗：${file.name}`));
          return;
        }
        resolve(result);
      },
      'image/jpeg',
      qualityPercent / 100
    );
  });

  const url = URL.createObjectURL(blob);
  return {
    originalName: file.name,
    outputName: getOutputName(file.name),
    originalSize: `${ow}x${oh}`,
    outputSize: `${nw}x${nh}`,
    faceCount,
    blob,
    url,
  };
}

function renderResults() {
  resultList.innerHTML = '';

  for (const item of processedItems) {
    const row = document.createElement('article');
    row.className = 'item';

    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = item.url;
    img.alt = item.outputName;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const name = document.createElement('p');
    name.className = 'name';
    name.textContent = item.outputName;

    const info = document.createElement('p');
    info.className = 'info';
    const faceInfo = item.faceCount > 0 ? ` ｜ 面部處理 ${item.faceCount} 處` : '';
    info.textContent = `${item.originalSize} -> ${item.outputSize}${faceInfo}`;

    meta.appendChild(name);
    meta.appendChild(info);

    const download = document.createElement('a');
    download.className = 'download-one';
    download.href = item.url;
    download.download = item.outputName;
    download.textContent = '下載';

    row.appendChild(img);
    row.appendChild(meta);
    row.appendChild(download);
    resultList.appendChild(row);
  }

  countEl.textContent = `${processedItems.length} 個檔案`;
  downloadBtn.disabled = processedItems.length === 0;
}

function clearResults() {
  for (const item of processedItems) {
    URL.revokeObjectURL(item.url);
  }
  processedItems = [];
  renderResults();
  setReport('');
  setStatus('已清空');
}

function clearAll() {
  clearResults();
  selectedFiles = [];
  fileInput.value = '';
  renderQueue();
  setStatus('已清空所有檔案');
}

function syncFaceControls() {
  const disabled = !faceDetectionEnabledInput.checked;
  faceEffectInput.disabled = disabled;
  faceConfidenceInput.disabled = disabled;
  effectStrengthInput.disabled = disabled;
}

function setSliderValueDisplay(valueEl, inputEl, formatter) {
  if (!valueEl || !inputEl) {
    return;
  }
  valueEl.textContent = formatter(Number(inputEl.value));
}

function refreshFaceSliderLabels() {
  setSliderValueDisplay(faceConfidenceValueEl, faceConfidenceInput, (value) => value.toFixed(2));
  setSliderValueDisplay(effectStrengthValueEl, effectStrengthInput, (value) => `${value.toFixed(2)}x`);
}

function syncEffectStrengthUI() {
  const effect = ['blur', 'pixelate', 'emoji'].includes(faceEffectInput.value) ? faceEffectInput.value : 'blur';
  const effectConfig = EFFECT_STRENGTH_CONFIG[effect];
  const rememberedValue = effectStrengthState[effect] ?? effectConfig.defaultValue;
  const normalizedValue = clampNumber(rememberedValue, effectConfig.min, effectConfig.max, effectConfig.defaultValue);

  effectStrengthLabelEl.textContent = effectConfig.label;
  effectStrengthHintEl.textContent = `${effectConfig.hint}（範圍 ${effectConfig.min}x - ${effectConfig.max}x）`;
  effectStrengthInput.min = String(effectConfig.min);
  effectStrengthInput.max = String(effectConfig.max);
  effectStrengthInput.step = String(effectConfig.step);
  effectStrengthInput.value = normalizedValue.toFixed(2);
  effectStrengthState[effect] = normalizedValue;
  refreshFaceSliderLabels();
}

function getFaceDetectorLoadErrorMessage() {
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  if (isAppleMobile) {
    return '未能載入本機人面識別模型。已改用全本機資源；如你用緊 iPhone，請以 http://127.0.0.1 開啟並更新 iOS / Safari 後再試。';
  }

  return '未能載入本機人面識別模型，請重新整理頁面後再試。';
}

function getPreferredTheme() {
  try {
    const savedTheme = localStorage.getItem('photostudio-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
  } catch (error) {
    // ignore localStorage failures
  }

  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function updateThemeToggle(theme) {
  themeToggleBtn.textContent = theme === 'dark' ? '☀️ 白天' : '🌙 黑夜';
  themeToggleBtn.setAttribute('aria-pressed', String(theme === 'dark'));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  updateThemeToggle(theme);

  try {
    localStorage.setItem('photostudio-theme', theme);
  } catch (error) {
    // ignore localStorage failures
  }
}

async function processAll() {
  const files = selectedFiles;
  if (files.length === 0) {
    setStatus('請先拖放或選擇圖片');
    setReport('');
    return;
  }

  const maxEdge = clampNumber(maxEdgeInput.value, 100, 10000, 1200);
  const quality = clampNumber(qualityInput.value, 1, 100, 85);
  const renameOptions = getRenameOptions();
  const faceOptions = getFaceOptions();
  maxEdgeInput.value = String(maxEdge);
  qualityInput.value = String(quality);

  const { supportedFiles, unsupportedFiles } = splitFilesBySupport(files);
  clearResults();
  setReport('');
  processBtn.disabled = true;

  try {
    if (supportedFiles.length === 0) {
      setStatus('全部檔案都不支援，未有可處理圖片');
      setReport(`未處理（不支援格式）：${formatNameList(unsupportedFiles)}`);
      return;
    }

    if (faceOptions.enabled) {
      setStatus('初始化人面識別模型中…');
      try {
        await ensureFaceDetector(faceOptions.confidence);
      } catch (error) {
        throw new Error(getFaceDetectorLoadErrorMessage());
      }
    }

    const failedFiles = [];
    let totalFaceCount = 0;

    for (let i = 0; i < supportedFiles.length; i += 1) {
      const file = supportedFiles[i];
      const outputName = buildOutputName(file, i, renameOptions);
      setStatus(`處理中 ${i + 1}/${supportedFiles.length}: ${file.name}`);

      try {
        const resized = await resizeFile(file, maxEdge, quality, faceOptions);
        resized.outputName = outputName;
        totalFaceCount += resized.faceCount || 0;
        processedItems.push(resized);
        renderResults();
      } catch (error) {
        failedFiles.push({ name: file.name, message: error.message || '未知錯誤' });
      }
    }

    const unsupportedCount = unsupportedFiles.length;
    const failedCount = failedFiles.length;
    const skippedCount = unsupportedCount + failedCount;

    let summary = `完成，共 ${processedItems.length}/${supportedFiles.length} 個支援格式檔案`;
    if (faceOptions.enabled) {
      summary += `，共處理 ${totalFaceCount} 個面部`;
    }
    if (skippedCount > 0) {
      summary += `，另有 ${skippedCount} 個未處理`;
    }
    setStatus(summary);

    const reportParts = [];
    if (unsupportedCount > 0) {
      reportParts.push(`不支援格式未處理：${formatNameList(unsupportedFiles)}`);
    }
    if (failedCount > 0) {
      reportParts.push(`處理失敗未輸出：${failedFiles.map((item) => item.name).join('、')}`);
    }
    if (faceOptions.enabled && totalFaceCount === 0 && processedItems.length > 0) {
      reportParts.push('已啟用人面識別，但今次未偵測到面部。');
    }
    setReport(reportParts.join(' ｜ '));

    if (processedItems.length > 0) {
      renderResults();
    }
  } catch (error) {
    setStatus('處理中止');
    setReport(error.message || '發生未知錯誤');
  } finally {
    processBtn.disabled = false;
  }
}

async function downloadAll() {
  if (processedItems.length === 0) {
    return;
  }

  setStatus(`開始下載 ${processedItems.length} 個檔案`);

  for (let i = 0; i < processedItems.length; i += 1) {
    const item = processedItems[i];
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.outputName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setStatus(`下載中 ${i + 1}/${processedItems.length}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  setStatus(`下載完成，共 ${processedItems.length} 個檔案`);
}

processBtn.addEventListener('click', processAll);
downloadBtn.addEventListener('click', downloadAll);
clearBtn.addEventListener('click', clearAll);
themeToggleBtn.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
});
faceDetectionEnabledInput.addEventListener('change', syncFaceControls);
faceConfidenceInput.addEventListener('input', refreshFaceSliderLabels);
faceEffectInput.addEventListener('change', syncEffectStrengthUI);
effectStrengthInput.addEventListener('input', () => {
  const effect = ['blur', 'pixelate', 'emoji'].includes(faceEffectInput.value) ? faceEffectInput.value : 'blur';
  const effectConfig = EFFECT_STRENGTH_CONFIG[effect];
  const value = clampNumber(effectStrengthInput.value, effectConfig.min, effectConfig.max, effectConfig.defaultValue);
  effectStrengthState[effect] = value;
  effectStrengthInput.value = value.toFixed(2);
  refreshFaceSliderLabels();
});
fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files || []));
  fileInput.value = '';
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

dropZone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length > 0) {
    addFiles(files);
  }
});

applyTheme(getPreferredTheme());
syncEffectStrengthUI();
syncFaceControls();
refreshFaceSliderLabels();
renderQueue();
