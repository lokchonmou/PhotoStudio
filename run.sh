#!/bin/bash
# 開啟本機 HTML 圖片調整工具（完全離線，處理不會上傳）

set -e

# 切換到腳本所在目錄
cd "$(dirname "$0")"
PROJECT_DIR="$(pwd -P)"

# 使用本機 HTTP 伺服器，避免 file:// 導致外部解碼器載入失敗
PORT=8123

existing_pid="$(lsof -ti tcp:"$PORT" | head -n 1 || true)"
need_start=1

if [ -n "$existing_pid" ]; then
	existing_cmd="$(ps -p "$existing_pid" -o command= | cat)"
	existing_cwd="$(lsof -a -p "$existing_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"

	if [ "$existing_cwd" = "$PROJECT_DIR" ] && echo "$existing_cmd" | grep -q "http.server"; then
		need_start=0
	else
		# 只接管 python http.server，避免誤殺其他服務
		if echo "$existing_cmd" | grep -q "http.server"; then
			kill "$existing_pid"
			sleep 0.2
		else
			echo "錯誤：Port $PORT 已被其他程式使用（PID $existing_pid）"
			echo "請先停止該程式，或改 run.sh 內 PORT。"
			exit 1
		fi
	fi
fi

if [ "$need_start" -eq 1 ]; then
	python3 -m http.server "$PORT" >/tmp/photoresize_http.log 2>&1 &
fi

# macOS 以預設瀏覽器開啟
open "http://127.0.0.1:$PORT/index.html"

echo "已開啟本機介面：http://127.0.0.1:$PORT/index.html"
