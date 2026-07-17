"""
Convert the Diabetic Foot dataset to Grayscale (3-channel RGB where R=G=B).
This removes colormap variation and forces the YOLO model to learn thermal intensity patterns.
"""

import os
import glob
import cv2
from pathlib import Path

SRC_DIR = Path("Diabetic foot.v1i.folder")
DST_DIR = Path("Diabetic foot.v1i.grayscale")

print("[*] Converting dataset to grayscale...")

# Copy directory structure and convert images
for split in ["train", "valid", "test"]:
    for cls in ["Diabetic-Foot", "Normal"]:
        src_path = SRC_DIR / split / cls
        dst_path = DST_DIR / split / cls
        dst_path.mkdir(parents=True, exist_ok=True)
        
        images = list(src_path.glob("*.jpg")) + list(src_path.glob("*.png"))
        for img_path in images:
            # Read image
            img = cv2.imread(str(img_path))
            if img is None:
                continue
                
            # Convert to grayscale
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Convert back to 3-channel BGR (so standard YOLO weights work out of the box)
            gray_3ch = cv2.merge([gray, gray, gray])
            
            # Save to destination
            cv2.imwrite(str(dst_path / img_path.name), gray_3ch)

print("[+] Grayscale dataset created successfully at:", DST_DIR)
