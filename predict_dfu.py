"""
Predict Diabetic-Foot vs Normal using the trained YOLOv11 model.

Usage:
    python predict_dfu.py                          # uses default test set
    python predict_dfu.py --source path/to/img.jpg
    python predict_dfu.py --source path/to/folder
"""

import argparse
from pathlib import Path
from ultralytics import YOLO

BASE_DIR   = Path(__file__).parent
MODEL_PATH = BASE_DIR / "runs" / "classify" / "dfu_clf" / "weights" / "best.pt"
TEST_DIR   = BASE_DIR / "Diabetic foot.v1i.grayscale" / "test"

parser = argparse.ArgumentParser(description="DFU Classifier Inference")
parser.add_argument("--model",  default=str(MODEL_PATH), help="Path to best.pt")
parser.add_argument("--source", default=str(TEST_DIR),   help="Image / folder to predict")
parser.add_argument("--conf",   type=float, default=0.5, help="Confidence threshold")
args = parser.parse_args()

source_path = Path(args.source)
image_files = []

if source_path.is_file():
    image_files.append(source_path)
elif source_path.is_dir():
    # Recursively find all supported images
    valid_exts = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
    for ext in valid_exts:
        image_files.extend(source_path.rglob(f"*{ext}"))
        image_files.extend(source_path.rglob(f"*{ext.upper()}"))
    image_files = sorted(list(set(image_files)))

if not image_files:
    print(f"❌ No images found in: {args.source}")
    exit(1)

model = YOLO(args.model)
results = []
for img_path in image_files:
    res = model.predict(
        source  = str(img_path),
        imgsz   = 224,
        conf    = args.conf,
        save    = True,
        workers = 0,
        verbose = False,
    )
    results.extend(res)

print("\n── Predictions ──────────────────────────────────")
for r in results:
    names = r.names                          # {0: 'Diabetic-Foot', 1: 'Normal'}
    probs = r.probs
    top1  = probs.top1                       # index of top class
    conf  = float(probs.top1conf)
    label = names[top1]
    src   = Path(r.path).name if hasattr(r, "path") else "?"
    # Try to extract the original class directory name for verification (e.g. test/Normal vs test/Diabetic-Foot)
    parent_name = Path(r.path).parent.name if hasattr(r, "path") else ""
    truth_prefix = f"[{parent_name}] " if parent_name in ["Diabetic-Foot", "Normal"] else ""
    print(f"  {truth_prefix}{src:40s} → {label:15s}  conf={conf:.3f}")

if results:
    print(f"\n✅ Saved prediction images to: {results[0].save_dir}")

