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
const LOCAL_FACE_TASKS_MODULE = './vendor/mediapipe/vision_bundle.mjs';
const LOCAL_FACE_WASM_DIR = './vendor/mediapipe/wasm';
const LOCAL_FACE_MODEL_PATH = './vendor/models/blaze_face_short_range.tflite';
const FACE_DETECTOR_DELEGATES = ['GPU', 'CPU'];

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
  return {
    enabled: faceDetectionEnabledInput.checked,
    effect: ['blur', 'pixelate', 'emoji'].includes(effect) ? effect : 'blur',
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

async function ensureFaceDetector() {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import(LOCAL_FACE_TASKS_MODULE);
      const fileset = await FilesetResolver.forVisionTasks(LOCAL_FACE_WASM_DIR);
      let lastError = null;

      for (const delegate of FACE_DETECTOR_DELEGATES) {
        try {
          return await FaceDetector.createFromOptions(fileset, {
            baseOptions: {
              modelAssetPath: LOCAL_FACE_MODEL_PATH,
              delegate,
            },
            runningMode: 'IMAGE',
            minDetectionConfidence: 0.5,
          });
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error('FACE_DETECTOR_INIT_FAILED');
    })().catch((error) => {
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

function applyBlurMask(ctx, sourceCanvas, rect) {
  const { regionCanvas, sx, sy, sw, sh } = createRegionCanvas(sourceCanvas, rect, 0.2);
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = sw;
  tempCanvas.height = sh;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.filter = `blur(${Math.max(14, Math.round(Math.min(rect.width, rect.height) / 5))}px)`;
  tempCtx.drawImage(regionCanvas, 0, 0, sw, sh);
  ctx.drawImage(tempCanvas, sx, sy);
}

function applyPixelateMask(ctx, sourceCanvas, rect) {
  const sampleCanvas = document.createElement('canvas');
  const sampleScale = Math.max(6, Math.round(Math.min(rect.width, rect.height) / 12));
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

function applyEmojiMask(ctx, rect) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const radiusX = rect.width / 2;
  const radiusY = rect.height / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(28, 38, 57, 0.22)';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `${Math.max(rect.height, rect.width)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🙈', centerX, centerY + rect.height * 0.02);
  ctx.restore();
}

async function detectFaces(canvas) {
  const detector = await ensureFaceDetector();
  const result = detector.detect(canvas);
  const detections = result?.detections || [];
  return detections
    .map((detection) => normalizeFaceRect(detection.boundingBox, canvas))
    .filter(Boolean);
}

async function applyFaceEffects(canvas, effect) {
  const faces = await detectFaces(canvas);

  if (faces.length === 0) {
    return 0;
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = canvas.width;
  sourceCanvas.height = canvas.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  sourceCtx.drawImage(canvas, 0, 0);

  const ctx = canvas.getContext('2d');
  for (const rect of faces) {
    if (effect === 'emoji') {
      applyEmojiMask(ctx, rect);
    } else if (effect === 'pixelate') {
      applyPixelateMask(ctx, sourceCanvas, rect);
    } else {
      applyBlurMask(ctx, sourceCanvas, rect);
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
    faceCount = await applyFaceEffects(canvas, faceOptions.effect);
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
  faceEffectInput.disabled = !faceDetectionEnabledInput.checked;
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
        await ensureFaceDetector();
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
syncFaceControls();
renderQueue();
