const fileInput = document.getElementById('fileInput');
const maxEdgeInput = document.getElementById('maxEdge');
const qualityInput = document.getElementById('quality');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const resultList = document.getElementById('resultList');
const dropZone = document.getElementById('dropZone');
const queueList = document.getElementById('queueList');
const queueCount = document.getElementById('queueCount');

let processedItems = [];
let selectedFiles = [];

function setStatus(text) {
  statusEl.textContent = text;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
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

async function resizeFile(file, maxEdge, qualityPercent) {
  let image;

  if (isHeicFile(file)) {
    try {
      // Safari / 部分系統可直接原生解碼 HEIC，先走原生路線。
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
    info.textContent = `${item.originalSize} -> ${item.outputSize}`;

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
  setStatus('已清空');
}

function clearAll() {
  clearResults();
  selectedFiles = [];
  fileInput.value = '';
  renderQueue();
  setStatus('已清空所有檔案');
}

async function processAll() {
  const files = selectedFiles;
  if (files.length === 0) {
    setStatus('請先拖放或選擇圖片');
    return;
  }

  const maxEdge = clampNumber(maxEdgeInput.value, 100, 10000, 1200);
  const quality = clampNumber(qualityInput.value, 1, 100, 85);
  maxEdgeInput.value = String(maxEdge);
  qualityInput.value = String(quality);

  clearResults();
  processBtn.disabled = true;

  try {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      setStatus(`處理中 ${i + 1}/${files.length}: ${file.name}`);
      const resized = await resizeFile(file, maxEdge, quality);
      processedItems.push(resized);
      renderResults();
    }
    setStatus(`完成，共 ${processedItems.length} 個檔案`);
  } catch (error) {
    setStatus(error.message || '處理失敗');
  } finally {
    processBtn.disabled = false;
  }
}

async function downloadAll() {
  if (processedItems.length === 0) {
    return;
  }

  setStatus(`開始下載 ${processedItems.length} 個檔案`);

  // 用短延遲分批觸發下載，減少瀏覽器阻擋機會。
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

renderQueue();
