import os
import glob
import cv2

# Define Paths
source_dir = r"c:\Users\anand\Downloads\Model DFU\ThermoDataBase"
target_dir = r"c:\Users\anand\Downloads\Model DFU\Diabetic foot.v1i.grayscale"

# Map the folder structure from the new dataset to the old dataset
mapping = {
    r"train\Control Group": r"train\Normal",
    r"train\DM Group": r"train\Diabetic-Foot",
    r"val\Control Group": r"valid\Normal",
    r"val\DM Group": r"valid\Diabetic-Foot"
}

added_count = 0

print(f"Starting Dataset Merge...")
print(f"Source: {source_dir}")
print(f"Target: {target_dir}\n")

for src_rel, tgt_rel in mapping.items():
    src_path = os.path.join(source_dir, src_rel)
    tgt_path = os.path.join(target_dir, tgt_rel)
    
    if not os.path.exists(src_path):
        print(f"⚠️ Warning: Source folder not found -> {src_path}")
        continue
        
    # Ensure target directory exists
    os.makedirs(tgt_path, exist_ok=True)
    
    # Grab all images
    files = glob.glob(os.path.join(src_path, "*.*"))
    print(f"Processing {len(files)} files from '{src_rel}' -> '{tgt_rel}'")
    
    for file in files:
        # Read the image (whether it is Color, JET, IRON, etc.)
        img = cv2.imread(file)
        if img is None: 
            continue
            
        # Convert to perfectly mapped Grayscale to match the original dataset
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Merge back to 3-channel Grayscale for YOLOv11 compatibility
        gray_3ch = cv2.merge([gray, gray, gray])
        
        # Create a unique filename so it doesn't overwrite existing images
        basename = os.path.basename(file)
        new_name = f"added_thermo_{basename}"
        
        if not new_name.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp')):
            new_name += ".jpg"
            
        out_file = os.path.join(tgt_path, new_name)
        
        # Save into the training folder
        cv2.imwrite(out_file, gray_3ch)
        added_count += 1

print(f"\n✅ SUCCESS! {added_count} new images were converted to Grayscale and safely merged into your training dataset.")
print(f"You can now run 'python train_yolo11_cls.py' to train on the massive combined dataset!")
