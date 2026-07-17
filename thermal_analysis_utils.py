"""
Thermal Angiosome Segmentation & Temperature Indexing
Designed to run on Google Colab or local Python server.

Features:
1. Background Segmentation: Isolates the foot from background ambient temperatures.
2. Angiosome Splitting: Divides the plantar region into 4 anatomical zones:
   - Forefoot & Toes (Anterior Tibial angiosome)
   - Medial Midfoot (Medial Plantar angiosome)
   - Lateral Midfoot (Lateral Plantar angiosome)
   - Heel (Calcaneal angiosome)
3. Index Computation: Computes Mean, Max, and Asymmetry scores for clinical diagnosis.
"""

import cv2
import numpy as np

def segment_foot(temp_grid, T_bg=25.0):
    """
    Creates a binary mask of the foot by thresholding out background temperatures.
    Typically, ambient room temperature is < 25C, and the human foot is > 28C.
    """
    # Create binary mask where pixels above T_bg are 1, rest are 0
    mask = (temp_grid > T_bg).astype(np.uint8)
    
    # Clean up mask using morphological operations (remove small noise)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    
    return mask

def extract_angiosomes(temp_grid, mask):
    """
    Crops the foot using its bounding box and segments it into 4 primary plantar angiosomes
    based on proportional vertical/horizontal grids.
    
    Returns a dictionary of temperature statistics for each angiosome zone.
    """
    # Apply mask to keep only foot temperatures (set background to NaN or 0)
    foot_temps = np.where(mask == 1, temp_grid, np.nan)
    
    # Get bounding box of the foot
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not np.any(rows) or not np.any(cols):
        return None  # No foot detected
        
    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    
    cropped_foot = foot_temps[ymin:ymax+1, xmin:xmax+1]
    h, w = cropped_foot.shape
    
    # Divide the foot proportionally (from top/toes to bottom/heel):
    # - Forefoot & Toes: Top 35% of the foot height
    # - Midfoot (Medial/Lateral): Middle 40% of the foot height (split 50/50 horizontally)
    # - Heel: Bottom 25% of the foot height
    
    y_forefoot_end = int(h * 0.35)
    y_midfoot_end = int(h * 0.75)
    x_mid = int(w * 0.5)
    
    angiosomes = {
        "forefoot": cropped_foot[0:y_forefoot_end, :],
        "midfoot_medial": cropped_foot[y_forefoot_end:y_midfoot_end, :x_mid],
        "midfoot_lateral": cropped_foot[y_forefoot_end:y_midfoot_end, x_mid:],
        "heel": cropped_foot[y_midfoot_end:, :]
    }
    
    # Compute metrics for each zone
    stats = {}
    for name, region in angiosomes.items():
        valid_temps = region[~np.isnan(region)]
        if len(valid_temps) > 0:
            stats[name] = {
                "mean": float(np.mean(valid_temps)),
                "max": float(np.max(valid_temps)),
                "min": float(np.min(valid_temps)),
                "std": float(np.std(valid_temps))
            }
        else:
            stats[name] = {"mean": 0.0, "max": 0.0, "min": 0.0, "std": 0.0}
            
    return stats

def calculate_asymmetry(left_stats, right_stats):
    """
    Computes the temperature asymmetry (Left minus Right) for each corresponding angiosome.
    An asymmetry absolute value > 2.2C (4F) flags a clinical hotspot / warning.
    """
    asymmetry_report = {}
    for zone in ["forefoot", "midfoot_medial", "midfoot_lateral", "heel"]:
        l_mean = left_stats.get(zone, {}).get("mean", 0.0)
        r_mean = right_stats.get(zone, {}).get("mean", 0.0)
        diff = l_mean - r_mean
        
        asymmetry_report[zone] = {
            "left_mean": l_mean,
            "right_mean": r_mean,
            "difference": diff,
            "status": "warning" if abs(diff) >= 2.2 else "normal"
        }
    return asymmetry_report
