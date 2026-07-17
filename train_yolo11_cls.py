"""
YOLOv11 Classification — Diabetic Foot vs Normal
Dataset : Diabetic foot.v1i.folder  (323 images, 224×224)
Classes : Diabetic-Foot | Normal
"""

import os
from pathlib import Path
from ultralytics import YOLO

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
DATA_DIR   = BASE_DIR / "Diabetic foot.v1i.grayscale"
OUTPUT_DIR = BASE_DIR / "runs" / "classify"

# ─── Verify dataset structure ─────────────────────────────────────────────────
for split in ("train", "valid", "test"):
    for cls in ("Diabetic-Foot", "Normal"):
        p = DATA_DIR / split / cls
        n = len(list(p.glob("*.*"))) if p.exists() else 0
        print(f"  {split:5s} / {cls:15s} : {n} images")

# ─── Model ────────────────────────────────────────────────────────────────────
# yolo11n-cls  → nano   (fastest, smallest)
# yolo11s-cls  → small
# yolo11m-cls  → medium (good balance)
MODEL_NAME = "yolo11n-cls.pt"

model = YOLO(MODEL_NAME)

# ─── Training ─────────────────────────────────────────────────────────────────
results = model.train(
    data    = str(DATA_DIR),   # root with train/ valid/ test/ subfolders
    epochs  = 100,
    imgsz   = 224,
    batch   = 16,
    lr0     = 1e-3,
    patience= 15,              # early-stopping patience
    project = str(OUTPUT_DIR),
    name    = "dfu_clf",
    exist_ok= True,
    plots   = True,            # save confusion matrix, curves, etc.
    save    = True,
    device  = "cpu",           # CPU (no CUDA GPU detected); change to 0 if you have a GPU
    workers = 0,               # 0 = use main thread (safe on Windows)
    amp     = True,            # mixed-precision for speed
    # augmentation (geometric augmentations only since input is grayscale)
    flipud  = 0.5,
    fliplr  = 0.5,
    degrees = 15,
    translate= 0.1,
    scale   = 0.3,
    shear   = 5,
    perspective= 0.0005,
    hsv_h   = 0.0,
    hsv_s   = 0.0,
    hsv_v   = 0.0,
)

print("\n[+] Training complete!")
print(f"   Best model : {results.save_dir}/weights/best.pt")

# ─── Validation on test split ─────────────────────────────────────────────────
print("\n[*] Evaluating on test set ...")
best_model = YOLO(str(Path(results.save_dir) / "weights" / "best.pt"))
metrics    = best_model.val(
    data    = str(DATA_DIR),
    split   = "test",
    imgsz   = 224,
    batch   = 16,
    workers = 0,
    project = str(OUTPUT_DIR),
    name    = "dfu_clf_test",
    exist_ok= True,
)

# Classification metrics keys
top1 = getattr(metrics, "top1", None)
top5 = getattr(metrics, "top5", None)
print(f"\n   Top-1 Accuracy : {top1:.4f}" if top1 is not None else "   Top-1: (check runs folder)")
print(f"   Top-5 Accuracy : {top5:.4f}" if top5 is not None else "   Top-5: (check runs folder)")

# ─── Export to ONNX (optional, uncomment if needed) ──────────────────────────
# print("\n[*] Exporting to ONNX ...")
# best_model.export(format="onnx", imgsz=224, simplify=True)

print("\n[+] All outputs saved to:", OUTPUT_DIR / "dfu_clf")
