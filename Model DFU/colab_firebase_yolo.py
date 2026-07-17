"""
Firebase RTDB MLX90640 YOLOv11 + Angiosome Diagnostic Listener
Designed for Google Colab or local server execution.
"""

import time
import base64
import io
import cv2
import numpy as np
from PIL import Image
from ultralytics import YOLO
import requests
import json
import os
import datetime

# Import the custom thermal analysis utilities
from thermal_analysis_utils import segment_foot, extract_angiosomes, calculate_asymmetry

# ─── Firebase Settings ────────────────────────────────────────────────────────
# Replace with your Firebase Realtime Database URL
FIREBASE_BASE_URL = "https://sayangi-614e3-default-rtdb.asia-southeast1.firebasedatabase.app"

# URL endpoints
SESSION_URL = f"{FIREBASE_BASE_URL}/kiosk_session.json"
PATIENTS_URL = f"{FIREBASE_BASE_URL}/patients"
RECORDS_URL = f"{FIREBASE_BASE_URL}/records"

# ─── Load trained YOLOv11 model ────────────────────────────────────────────────
# Point to your 'best.pt' file. In Google Colab, you can upload best.pt to files.
model_path = "runs/classify/dfu_clf/weights/best.pt"
print(f"Loading YOLOv11 model from {model_path} ...")
model = YOLO(model_path)


def process_thermal_data(temperatures, width=32, height=24, T_min=20.0, T_max=40.0):
    """
    Converts 768 raw temperature values into a consistent, smooth 224x224 grayscale image for the model,
    while returning the BGR image (for angiosome segmentation) and the color JET version as base64 for history.
    """
    temp_grid = np.array(temperatures, dtype=np.float32).reshape((height, width))
    normalized = np.clip(temp_grid, T_min, T_max)
    scaled = ((normalized - T_min) / (T_max - T_min) * 255.0).astype(np.uint8)
    colored_bgr = cv2.applyColorMap(scaled, cv2.COLORMAP_JET)
    resized_bgr = cv2.resize(colored_bgr, (224, 224), interpolation=cv2.INTER_CUBIC)
    resized_gray = cv2.cvtColor(resized_bgr, cv2.COLOR_BGR2GRAY)
    resized_gray_3ch = cv2.merge([resized_gray, resized_gray, resized_gray])
    _, buffer = cv2.imencode('.jpg', resized_bgr)
    b64_image = base64.b64encode(buffer).decode('utf-8')
    return Image.fromarray(resized_gray_3ch), temp_grid, b64_image


def get_offline_summary(patient, heart_rate, spo2, body_temp, thermal_analysis):
    name = patient.get("name", "Pasien")
    age = patient.get("age", 0)
    gender = patient.get("gender", "L/P")
    history = patient.get("medical_history", "Tidak ada")

    vitals_notes = []
    if body_temp > 37.5: vitals_notes.append(f"suhu tubuh {body_temp:.1f}°C (demam/febris)")
    elif body_temp < 35.5: vitals_notes.append(f"suhu tubuh {body_temp:.1f}°C (hipotermia ringan)")
    else: vitals_notes.append(f"suhu tubuh {body_temp:.1f}°C (normal)")

    if spo2 < 95.0: vitals_notes.append(f"saturasi oksigen SpO2 {spo2:.0f}% (hipoksia ringan, normal >=95%)")
    else: vitals_notes.append(f"SpO2 {spo2:.0f}% (normal)")

    if heart_rate > 100.0: vitals_notes.append(f"detak jantung {heart_rate:.0f} bpm (takikardia ringan/sedang)")
    elif heart_rate < 60.0: vitals_notes.append(f"detak jantung {heart_rate:.0f} bpm (bradikardia, waspada)")
    else: vitals_notes.append(f"detak jantung {heart_rate:.0f} bpm (normal)")

    vitals_summary = f"{name} ({age} th, {gender}) dengan riwayat {history}. Hasil vital sign: {', '.join(vitals_notes)}."
    priority = thermal_analysis.get("priority_status", "NORMAL")
    foot_notes = thermal_analysis.get("interpretation", "")

    recommendations = []
    if priority == "CRITICAL":
        recommendations.append("Prioritaskan pemeriksaan fisik langsung pada kaki pasien oleh nakes/bidan desa dalam 48 jam.")
        recommendations.append("Cek apakah terdapat mikro-luka, kemerahan, atau penebalan kulit (callus) pada area jari/telapak kaki.")
        recommendations.append("Edukasi pasien untuk tidak berjalan tanpa alas kaki dan menjaga kebersihan kaki.")
    elif priority == "WARNING":
        recommendations.append("Pantau perkembangan suhu kaki pada pemeriksaan bulan depan.")
        recommendations.append("Edukasi perawatan kaki mandiri (membersihkan kaki dan memberikan pelembab).")

    if spo2 < 95.0: recommendations.append("Pantau saturasi oksigen berkala. Sarankan istirahat cukup.")
    if body_temp > 37.5: recommendations.append("Sarankan kompres hangat dan pantau terus suhu badan.")
    if heart_rate > 100.0: recommendations.append("Edukasi untuk relaksasi dan batasi kafein.")

    if not recommendations:
        recommendations.append("Kondisi umum stabil. Lanjutkan kontrol rutin bulanan di SehatDesa Station Balai Desa.")

    return f"{vitals_summary} {foot_notes} Rekomendasi Klinis: {' '.join(recommendations)}"


def generate_medical_summary(patient, heart_rate, spo2, body_temp, thermal_analysis):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return get_offline_summary(patient, heart_rate, spo2, body_temp, thermal_analysis)

    prompt = f"""
    Kamu adalah sistem AI Asisten Medis untuk program 'SehatDesa Station' di Indonesia.
    Tugasmu adalah menganalisis data pemeriksaan mandiri lansia di Balai Desa dan memberikan ringkasan klinis singkat, padat, dan terstruktur untuk dibaca oleh Bidan Desa atau Tenaga Medis Puskesmas.

    DATA PASIEN:
    Nama: {patient.get('name', 'Pasien')}
    Umur: {patient.get('age', 0)} tahun
    Jenis Kelamin: {patient.get('gender', 'L/P')}
    Riwayat Penyakit: {patient.get('medical_history', 'Tidak ada')}

    HASIL SENSOR VITAL SIGN:
    - Detak Jantung: {heart_rate} bpm (Normal: 60-100 bpm)
    - Saturasi Oksigen (SpO2): {spo2}% (Normal: >= 95%)
    - Suhu Tubuh (Dahi): {body_temp}°C (Normal: 36.0-37.3°C)

    HASIL DETEKSI FOOT THERMAL (Skrining Kaki Diabetes):
    - Status Analisis: {thermal_analysis['priority_status']}
    - Rata-rata Suhu Kaki Kiri: {thermal_analysis['left_foot']['average']}°C
    - Rata-rata Suhu Kaki Kanan: {thermal_analysis['right_foot']['average']}°C
    - Asimetri per Zona (Kiri vs Kanan):
      * Jari (Toes): {thermal_analysis['asymmetry']['toes']}°C (Kritis jika >2.2°C)
      * Tengah (Midfoot): {thermal_analysis['asymmetry']['midfoot']}°C
      * Tumit (Heel): {thermal_analysis['asymmetry']['heel']}°C
    - Hotspots (Potensi Inflamasi/Pre-ulkus): {thermal_analysis['hotspots']}
    - Coldspots (Potensi Iskemia/Sirkulasi buruk): {thermal_analysis['coldspots']}
    - Interpretasi Awal: {thermal_analysis['interpretation']}

    Format output yang di inginkan (TULIS DALAM BAHASA INDONESIA, MAKSIMAL 3-4 KALIMAT, langsung ke poin klinis penting):
    [Nama Pasien] ([Umur] th), [Keluhan/Riwayat]. Pemeriksaan menunjukkan [Ringkasan status vital sign]. [Ringkasan kondisi termal kaki: sebutkan jika ada asimetri >2.2C atau hotspot/coldspot]. Rekomendasi: [Tindakan taktis konkret untuk bidan desa].

    Ingat: Jangan berikan diagnosis medis final, gunakan terminologi screening seperti 'potensi', 'indikasi', 'risiko', 'sarankan pemeriksaan lanjutan'.
    """
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
        res = requests.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=10)
        if res.status_code == 200:
            data = res.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        print(f"Gemini API error: {e}")
    return get_offline_summary(patient, heart_rate, spo2, body_temp, thermal_analysis)


def process_session_and_predict():
    print(f"\n🚀 Listening/Polling Firebase kiosk_session at {SESSION_URL}...")

    while True:
        try:
            # Fetch active session state from Firebase
            response = requests.get(SESSION_URL)
            if response.status_code != 200 or not response.content:
                time.sleep(2)
                continue

            session_data = response.json()
            if not session_data or not isinstance(session_data, dict):
                time.sleep(2)
                continue

            # Read state and status
            status_val = session_data.get("status", "")
            state_val = session_data.get("state", "")
            patient = session_data.get("patient") or {}
            patient_id = patient.get("id") or session_data.get("patient_id") or "UNKNOWN_PATIENT"

            # Read thermalGrid array and Base64 image uploaded by ESP32
            temperatures = session_data.get("thermalGrid") or session_data.get("temperatures")
            b64_img_str = session_data.get("image")

            # The ESP32 captures BOTH feet at once and sets status to 'pending'
            if (status_val == "pending" or state_val == "pending") and b64_img_str and temperatures:
                if len(temperatures) != 768:
                    print(f"⚠️ Invalid temperature array length: {len(temperatures)}")
                    time.sleep(2)
                    continue

                print(f"\n👣 Processing for Patient: {patient.get('name', patient_id)}...")

                # --- 1. DECODE ESP32 BASE64 IMAGE FOR YOLO ---
                if b64_img_str.startswith("data:image"):
                    raw_b64 = b64_img_str.split(",")[1]
                else:
                    raw_b64 = b64_img_str

                img_data = base64.b64decode(raw_b64)
                np_arr = np.frombuffer(img_data, np.uint8)
                img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

                # YOLO model was trained on grayscale images.
                # Convert the ESP32 JET Color BMP back to Grayscale while keeping the exact dynamic scaling from the ESP32.
                img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
                img_gray_3ch = cv2.merge([img_gray, img_gray, img_gray])
                img_pil = Image.fromarray(img_gray_3ch)

                # --- 2. RUN YOLO PREDICTION ---
                results = model.predict(source=img_pil, imgsz=224, verbose=False)
                pred_label = "Unknown"
                pred_conf = 0.0
                if results:
                    probs = results[0].probs
                    pred_label = results[0].names[probs.top1]
                    pred_conf = float(probs.top1conf)

                print(f"   -> YOLO Prediction: {pred_label} ({pred_conf:.2f} conf)")

                # --- 3. COMPUTE ANGIOSOMES FROM RAW THERMAL GRID ---
                temp_grid = np.array(temperatures, dtype=np.float32).reshape((24, 32))
                # The ESP32 splits left (cols 0-15) and right (cols 16-31)
                left_grid = temp_grid[:, :16]
                right_grid = temp_grid[:, 16:]

                # The segment_foot function expects a centered 24x32 grid.
                # We pad the 16x24 grids to 32x24 so we can reuse the library functions perfectly.
                padded_left = np.zeros((24, 32), dtype=np.float32)
                padded_left[:, 8:24] = left_grid
                left_mask = segment_foot(padded_left)
                left_stats = extract_angiosomes(padded_left, left_mask)

                padded_right = np.zeros((24, 32), dtype=np.float32)
                padded_right[:, 8:24] = right_grid
                right_mask = segment_foot(padded_right)
                right_stats = extract_angiosomes(padded_right, right_mask)

                left_foot_stats = {
                    "toes": float(round(left_stats["forefoot"]["mean"], 2)),
                    "midfoot": float(round((left_stats["midfoot_medial"]["mean"] + left_stats["midfoot_lateral"]["mean"]) / 2.0, 2)),
                    "heel": float(round(left_stats["heel"]["mean"], 2)),
                    "average": float(round(np.mean(left_grid[left_grid > 26.0]) if np.any(left_grid > 26.0) else np.mean(left_grid), 2))
                }

                right_foot_stats = {
                    "toes": float(round(right_stats["forefoot"]["mean"], 2)),
                    "midfoot": float(round((right_stats["midfoot_medial"]["mean"] + right_stats["midfoot_lateral"]["mean"]) / 2.0, 2)),
                    "heel": float(round(right_stats["heel"]["mean"], 2)),
                    "average": float(round(np.mean(right_grid[right_grid > 26.0]) if np.any(right_grid > 26.0) else np.mean(right_grid), 2))
                }

                asymmetry = {
                    "toes": float(round(abs(left_foot_stats["toes"] - right_foot_stats["toes"]), 2)),
                    "midfoot": float(round(abs(left_foot_stats["midfoot"] - right_foot_stats["midfoot"]), 2)),
                    "heel": float(round(abs(left_foot_stats["heel"] - right_foot_stats["heel"]), 2))
                }

                max_asym = max(asymmetry["toes"], asymmetry["midfoot"], asymmetry["heel"])
                priority_status = "NORMAL"
                if max_asym > 2.2 or pred_label == "Diabetic-Foot":
                    priority_status = "CRITICAL"
                elif max_asym > 1.5:
                    priority_status = "WARNING"

                # Check vitals priority
                vitals = session_data.get("vitals") or {}
                heart_rate = float(vitals.get("heart_rate") or 75.0)
                spo2 = float(vitals.get("spo2") or 98.0)
                body_temp = float(vitals.get("body_temp") or 36.5)

                vitals_priority = "NORMAL"
                if spo2 < 92.0 or body_temp > 38.5 or heart_rate > 110.0 or heart_rate < 50.0:
                    vitals_priority = "CRITICAL"
                elif spo2 < 95.0 or body_temp > 37.5 or heart_rate > 100.0 or heart_rate < 60.0:
                    vitals_priority = "WARNING"

                priority_order = {"NORMAL": 0, "WARNING": 1, "CRITICAL": 2}
                if priority_order[vitals_priority] > priority_order[priority_status]:
                    priority_status = vitals_priority

                # Interpretations
                interpretations = []
                if pred_label == "Diabetic-Foot":
                    interpretations.append("YOLOv11 mendeteksi indikasi resiko Diabetic Foot.")
                if max_asym > 2.2:
                    interpretations.append(f"Terdeteksi asimetri termal kritis sebesar {max_asym:.1f}°C antara kaki kiri dan kanan.")
                elif max_asym > 1.5:
                    interpretations.append(f"Terdeteksi asimetri termal ringan sebesar {max_asym:.1f}°C.")
                else:
                    if pred_label != "Diabetic-Foot":
                        interpretations.append("Distribusi suhu kaki seimbang dan tidak ada indikasi resiko tinggi.")

                interpretation_str = " ".join(interpretations)

                thermal_analysis = {
                    "left_foot": left_foot_stats,
                    "right_foot": right_foot_stats,
                    "asymmetry": asymmetry,
                    "hotspots": {"left": [], "right": []},
                    "coldspots": {"left": [], "right": []},
                    "interpretation": interpretation_str,
                    "priority_status": priority_status,
                    "ai_prediction": pred_label,
                    "ai_confidence": pred_conf
                }

                # --- 4. GENERATE AI SUMMARY AND SAVE ---
                summary = generate_medical_summary(patient, heart_rate, spo2, body_temp, thermal_analysis)

                # Fetch records to determine the next ID
                records_res = requests.get(f"{RECORDS_URL}.json")
                next_id = 1
                if records_res.status_code == 200 and records_res.content:
                    records_data = records_res.json()
                    if records_data and isinstance(records_data, dict):
                        valid_keys = [int(k) for k in records_data.keys() if k.isdigit()]
                        if valid_keys:
                            next_id = max(valid_keys) + 1

                iso_now = datetime.datetime.utcnow().isoformat() + "Z"

                new_record = {
                    "id": next_id,
                    "patient_id": patient_id,
                    "heart_rate": heart_rate,
                    "spo2": spo2,
                    "body_temp": body_temp,
                    "thermal_grid": json.dumps(temperatures),
                    "thermal_analysis": json.dumps(thermal_analysis),
                    "gemini_summary": summary,
                    "priority_status": priority_status,
                    "image": b64_img_str,
                    "created_at": iso_now
                }

                # Save final record to /records
                requests.put(f"{RECORDS_URL}/{next_id}.json", json=new_record)

                # Reset active session state to completed
                session_update = {
                    "status": "COMPLETED",
                    "state": "COMPLETED",
                    "thermalGrid": temperatures,
                    "vitals": vitals,
                    "patient": patient,
                    "image": b64_img_str
                }
                requests.put(SESSION_URL, json=session_update)

                # If precheck citizen (starts with SEHATDESA:), increment scan count
                if str(patient_id).startswith("PAS-") == False:
                    p_res = requests.get(f"{FIREBASE_BASE_URL}/peserta/{patient_id}.json")
                    if p_res.status_code == 200 and p_res.content:
                        p_data = p_res.json()
                        if p_data:
                            scan_count = p_data.get("scan_count", 0) + 1
                            requests.patch(f"{FIREBASE_BASE_URL}/peserta/{patient_id}.json", json={
                                "scan_count": scan_count,
                                "last_scan_at": iso_now,
                                "last_scan_source": "hardware"
                            })

                print(f"✅ Final Diagnostic Record {next_id} saved under /records")
                print("✅ Active session updated to COMPLETED.")

        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()

        time.sleep(1)

if __name__ == "__main__":
    process_session_and_predict()