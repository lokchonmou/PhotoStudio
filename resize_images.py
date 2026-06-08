#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
圖片批次調整大小工具
將 input 資料夾中的所有圖片調整為長邊 1200px 的 JPG 檔案，品質設為 85%
"""

import os
from PIL import Image
import sys

def resize_image(input_path, output_path, max_size=1200, quality=85):
    """
    調整圖片大小，保持比例，長邊調整為指定大小
    
    Args:
        input_path: 輸入圖片路徑
        output_path: 輸出圖片路徑
        max_size: 長邊最大尺寸 (預設 1200px)
        quality: JPG 品質 (預設 85%)
    """
    try:
        # 開啟圖片
        with Image.open(input_path) as img:
            # 如果是 RGBA 模式，轉換為 RGB (去除透明度)
            if img.mode in ('RGBA', 'LA', 'P'):
                # 創建白色背景
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # 獲取原始尺寸
            original_width, original_height = img.size
            
            # 計算新尺寸 (保持比例)
            if original_width >= original_height:
                # 橫向圖片或正方形，以寬度為基準
                new_width = max_size
                new_height = int((original_height * max_size) / original_width)
            else:
                # 縱向圖片，以高度為基準
                new_height = max_size
                new_width = int((original_width * max_size) / original_height)
            
            # 只有在圖片比目標尺寸大時才調整
            if original_width > max_size or original_height > max_size:
                # 使用 LANCZOS 重採樣以獲得較好品質
                resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                print(f"調整 {os.path.basename(input_path)}: {original_width}x{original_height} -> {new_width}x{new_height}")
            else:
                resized_img = img
                print(f"保持 {os.path.basename(input_path)}: {original_width}x{original_height} (已符合尺寸要求)")
            
            # 儲存為 JPG 格式
            resized_img.save(output_path, 'JPEG', quality=quality, optimize=True)
            print(f"已儲存: {os.path.basename(output_path)}")
            
    except Exception as e:
        print(f"處理 {os.path.basename(input_path)} 時發生錯誤: {e}")

def main():
    # 設定路徑
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_dir = os.path.join(script_dir, 'input')
    output_dir = os.path.join(script_dir, 'output')
    
    # 檢查輸入資料夾是否存在
    if not os.path.exists(input_dir):
        print(f"錯誤: 找不到輸入資料夾 {input_dir}")
        return
    
    # 確保輸出資料夾存在
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"已創建輸出資料夾: {output_dir}")
    
    # 支援的圖片格式
    supported_formats = ('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp')
    
    # 獲取所有圖片檔案
    image_files = []
    for file in os.listdir(input_dir):
        if file.lower().endswith(supported_formats):
            image_files.append(file)
    
    if not image_files:
        print("在 input 資料夾中找不到支援的圖片檔案")
        print(f"支援的格式: {', '.join(supported_formats)}")
        return
    
    print(f"找到 {len(image_files)} 個圖片檔案")
    print("=" * 50)
    
    # 處理每個圖片檔案
    processed_count = 0
    for i, filename in enumerate(image_files, 1):
        print(f"[{i}/{len(image_files)}] 處理: {filename}")
        
        input_path = os.path.join(input_dir, filename)
        
        # 輸出檔名 (統一為 .jpg 副檔名)
        base_name = os.path.splitext(filename)[0]
        output_filename = f"{base_name}.jpg"
        output_path = os.path.join(output_dir, output_filename)
        
        resize_image(input_path, output_path)
        processed_count += 1
        print("-" * 30)
    
    print("=" * 50)
    print(f"完成！共處理了 {processed_count} 個檔案")
    print(f"輸出資料夾: {output_dir}")

if __name__ == "__main__":
    main()