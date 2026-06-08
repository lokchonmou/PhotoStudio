#!/bin/bash
# 開啟本機 HTML 圖片調整工具（完全離線，處理不會上傳）

# 切換到腳本所在目錄
cd "$(dirname "$0")"

# 使用本機 HTTP 伺服器，避免 file:// 導致外部解碼器載入失敗
PORT=8123

if ! lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
	python3 -m http.server "$PORT" >/tmp/photoresize_http.log 2>&1 &
fi

# macOS 以預設瀏覽器開啟
open "http://127.0.0.1:$PORT/index.html"

echo "已開啟本機介面：http://127.0.0.1:$PORT/index.html"
