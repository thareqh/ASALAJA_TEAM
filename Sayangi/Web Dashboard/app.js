// Firebase Realtime Database Config
const FIREBASE_URL = "https://sayangi-614e3-default-rtdb.asia-southeast1.firebasedatabase.app";

// Local State
let currentRecord = null;
let currentPatient = null;
let activeTab = 'split'; 
let speakEnabled = true;

// Active Kiosk Session state (replacing server-side session)
let kioskSession = {
    state: "IDLE",
    currentPatient: null,
    heartRate: null,
    spo2: null,
    bodyTemp: null,
    thermalGrid: null,
    thermalAnalysis: null,
    geminiSummary: null,
    priorityStatus: "NORMAL"
};

// DOM Elements
const connStatus = document.getElementById('conn-status');
const patientFeed = document.getElementById('patient-feed');
const patientHistory = document.getElementById('patient-history');
const detailPanel = document.getElementById('detail-panel');
const kioskScreen = document.getElementById('kiosk-screen');

// Firebase REST API Wrappers
async function firebaseGet(path) {
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Firebase read error at ${path}:`, e);
        return null;
    }
}

async function firebasePut(path, data) {
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Firebase write error at ${path}:`, e);
        return null;
    }
}

// Database Seeding logic (moved from database.py)
async function initDatabase() {
    connStatus.innerHTML = '<span class="status-dot processing"></span> Menghubungkan ke Cloud...';
    
    let patients = await firebaseGet("patients");
    if (!patients) {
        const defaultPatients = {
            1: { id: 1, name: "Pak Ahmad", age: 68, gender: "Laki-laki", qr_code: "PAS-001", phone: "08123456789", address: "Dusun Krajan RT 01/RW 02", medical_history: "Hipertensi ringan", created_at: new Date().toISOString() },
            2: { id: 2, name: "Mbah Sri", age: 72, gender: "Perempuan", qr_code: "PAS-002", phone: "08134567890", address: "Dusun Mawar RT 03/RW 01", medical_history: "Diabetes Melitus Tipe 2, Asam Urat", created_at: new Date().toISOString() },
            3: { id: 3, name: "Pak Sugeng", age: 65, gender: "Laki-laki", qr_code: "PAS-003", phone: "08145678901", address: "Dusun Krajan RT 02/RW 02", medical_history: "Riwayat Penyakit Jantung Koroner", created_at: new Date().toISOString() },
            4: { id: 4, name: "Mbah Aminah", age: 80, gender: "Perempuan", qr_code: "PAS-004", phone: "08156789012", address: "Dusun Kidul RT 05/RW 03", medical_history: "Pernah stroke ringan 2 tahun lalu", created_at: new Date().toISOString() },
            5: { id: 5, name: "Pak Budi", age: 59, gender: "Laki-laki", qr_code: "PAS-005", phone: "08167890123", address: "Dusun Krajan RT 01/RW 02", medical_history: "Kolesterol tinggi", created_at: new Date().toISOString() }
        };
        await firebasePut("patients", defaultPatients);
    }
    
    let records = await firebaseGet("records");
    if (!records) {
        const sri_analysis = {
            "left_foot": {"toes": 28.5, "midfoot": 29.0, "heel": 28.2, "average": 28.56},
            "right_foot": {"toes": 31.8, "midfoot": 29.2, "heel": 28.4, "average": 29.8},
            "asymmetry": {"toes": 3.3, "midfoot": 0.2, "heel": 0.2},
            "hotspots": {"left": [], "right": ["toes"]},
            "coldspots": {"left": ["toes"], "right": []},
            "interpretation": "Ditemukan asimetri suhu kaki yang signifikan (> 2.2°C) pada area jari-jari. Kaki kanan bagian jari terdeteksi mengalami hipertermia (potensi inflamasi), sedangkan kaki kiri bagian jari terdeteksi hipotermia (potensi gangguan sirkulasi)."
        };
        const ahmad_analysis = {
            "left_foot": {"toes": 30.1, "midfoot": 29.8, "heel": 29.5, "average": 29.8},
            "right_foot": {"toes": 30.3, "midfoot": 29.9, "heel": 29.6, "average": 29.93},
            "asymmetry": {"toes": 0.2, "midfoot": 0.1, "heel": 0.1},
            "hotspots": {"left": [], "right": []},
            "coldspots": {"left": [], "right": []},
            "interpretation": "Distribusi suhu kaki normal dan simetris bilateral. Tidak terdeteksi asimetri atau deviasi suhu lokal yang mencurigakan."
        };
        
        const defaultRecords = {
            1: {
                id: 1,
                patient_id: 2,
                heart_rate: 88.0,
                spo2: 96.0,
                body_temp: 36.7,
                thermal_grid: JSON.stringify(generateMockThermalGrid("inflammatory")),
                thermal_analysis: JSON.stringify(sri_analysis),
                gemini_summary: "Mbah Sri (72 th), pemeriksaan 5 hari lalu. HR 88 bpm (normal), SpO2 96% (normal), suhu tubuh 36.7°C (normal). DETEKSI DINI: Terdeteksi asimetri suhu yang sangat signifikan sebesar 3.3°C pada area jari-jari kaki kanan (lebih hangat, potensi inflamasi/pra-ulkus) dibandingkan kaki kiri (lebih dingin, potensi iskemia). Rekomendasi: Segera jadwalkan kunjungan bidan desa untuk mengecek kondisi fisik kaki Mbah Sri secara visual dan palpasi denyut arteri dorsalis pedis.",
                priority_status: "CRITICAL",
                created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
            },
            2: {
                id: 2,
                patient_id: 1,
                heart_rate: 98.0,
                spo2: 94.0,
                body_temp: 37.8,
                thermal_grid: JSON.stringify(generateMockThermalGrid("normal")),
                thermal_analysis: JSON.stringify(ahmad_analysis),
                gemini_summary: "Bapak Ahmad (68 th), pemeriksaan 3 hari lalu. HR 98 bpm (sedikit cepat), SpO2 94% (ringan di bawah normal: waspada hipoksia), suhu dahi 37.8°C (demam ringan). Pemeriksaan thermal kaki dalam batas normal. Rekomendasi: Pasien disarankan istirahat, diberikan kompres hangat, dan dipantau saturasi oksigennya. Jika SpO2 terus menurun di bawah 94%, lakukan konsultasi dengan puskesmas.",
                priority_status: "WARNING",
                created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
            }
        };
        await firebasePut("records", defaultRecords);
    }
    
    connStatus.innerHTML = '<span class="status-dot"></span> Cloud Database';
    connStatus.className = 'sys-status';
}

// Speak indonesian voices
function speak(text) {
    if (!speakEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'id-ID';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const idVoice = voices.find(voice => voice.lang.includes('id') || voice.lang.includes('ID'));
    if (idVoice) utterance.voice = idVoice;
    window.speechSynthesis.speak(utterance);
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
}

// Play notification sound
function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const playChime = (time, freq) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.1, time);
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
            osc.start(time);
            osc.stop(time + 0.3);
        };
        const now = audioCtx.currentTime;
        playChime(now, 523.25); 
        playChime(now + 0.15, 659.25); 
    } catch (e) {
        console.log("Audio contexts blocked");
    }
}

// Handle local Kiosk state changes
function handleStateUpdate(state, patient, vitals, thermalGrid, record) {
    document.querySelectorAll('.kiosk-state-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    const displayElement = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    
    switch (state) {
        case 'IDLE':
            document.getElementById('kiosk-idle').classList.add('active');
            break;
            
        case 'PATIENT_IDENTIFIED':
            document.getElementById('kiosk-patient').classList.add('active');
            if (patient) {
                displayElement('kiosk-pat-name', patient.name);
                displayElement('kiosk-pat-age', `${patient.age} tahun`);
                displayElement('kiosk-pat-history', patient.medical_history || 'Tidak ada riwayat');
                speak(`Selamat datang, Mbah ${patient.name}. Pemeriksaan dimulai. Silakan tempelkan dahi ke sensor suhu, dan masukkan jari telunjuk ke lubang sensor jantung.`);
                
                const simSelect = document.getElementById('sim-patient-select');
                if (simSelect) simSelect.value = patient.qr_code;
            }
            break;
            
        case 'READING_VITALS':
            document.getElementById('kiosk-vitals').classList.add('active');
            speak("Membaca vital sign. Tahan posisi jari dan dahi Anda.");
            break;
            
        case 'READING_THERMAL':
            document.getElementById('kiosk-thermal').classList.add('active');
            if (vitals) {
                displayElement('kiosk-vit-hr', Math.round(vitals.heart_rate));
                displayElement('kiosk-vit-spo2', Math.round(vitals.spo2));
                displayElement('kiosk-vit-temp', vitals.body_temp.toFixed(1));
            }
            speak("Suhu dahi dan detak jantung terekam. Sekarang, silakan berdiri tegak tanpa alas kaki di atas pijakan kaki termal.");
            break;
            
        case 'PROCESSING':
            document.getElementById('kiosk-processing').classList.add('active');
            speak("Pemeriksaan selesai. Data Anda sedang dianalisis oleh Gemini A I.");
            break;
            
        case 'COMPLETED':
            document.getElementById('kiosk-completed').classList.add('active');
            if (record) {
                displayElement('kiosk-res-hr', Math.round(record.heart_rate));
                displayElement('kiosk-res-spo2', Math.round(record.spo2));
                displayElement('kiosk-res-temp', record.body_temp.toFixed(1));
                
                let advise = "Kondisi kaki terdeteksi normal.";
                if (record.priority_status === 'CRITICAL') {
                    advise = "Peringatan: Ditemukan asimetri termal kaki yang signifikan. Prioritaskan kunjungan medis.";
                } else if (record.priority_status === 'WARNING') {
                    advise = "Peringatan: Terdapat deviasi suhu ringan pada kaki Anda.";
                }
                displayElement('kiosk-res-advise', advise);
                
                speak(`Pemeriksaan selesai, Mbah ${record.name}. Hasil vital sign: detak jantung ${Math.round(record.heart_rate)} kali per menit, saturasi oksigen ${Math.round(record.spo2)} persen, suhu tubuh ${record.body_temp.toFixed(1)} derajat celsius. Data sudah dikirimkan langsung ke Ibu Bidan. Terima kasih, Mbah!`);
                
                currentRecord = record;
                renderRecordDetail(record);
            }
            break;
    }
}

// Load registered patients
async function loadPatients() {
    try {
        const patientsObj = await firebaseGet("patients") || {};
        const patients = Object.values(patientsObj).filter(Boolean);
        
        const simSelect = document.getElementById('sim-patient-select');
        if (simSelect) {
            simSelect.innerHTML = '<option value="">-- Pilih Kartu QR Pasien --</option>';
            patients.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.qr_code;
                opt.textContent = `${p.name} (${p.age} th) - ${p.qr_code}`;
                simSelect.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('Failed to load patients', e);
    }
}

// Load check-up records
async function loadRecords(filterPriority = 'ALL') {
    try {
        const recordsObj = await firebaseGet("records") || {};
        const patientsObj = await firebaseGet("patients") || {};
        
        let records = [];
        for (let r of Object.values(recordsObj).filter(Boolean)) {
            const patient = patientsObj[r.patient_id] || {};
            records.push({
                ...r,
                name: patient.name || "Unknown",
                age: patient.age || 0,
                gender: patient.gender || "-",
                qr_code: patient.qr_code || "-",
                phone: patient.phone || "",
                address: patient.address || "",
                medical_history: patient.medical_history || ""
            });
        }
        
        // Sort DESC
        records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        let filtered = records;
        if (filterPriority !== 'ALL') {
            filtered = records.filter(r => r.priority_status === filterPriority);
        }
        
        renderPatientList(filtered);
        
        if (filtered.length > 0 && !currentRecord) {
            currentRecord = filtered[0];
            renderRecordDetail(currentRecord);
        }
    } catch (e) {
        console.error('Failed to load records', e);
    }
}

// Render records feed list
function renderPatientList(records) {
    if (records.length === 0) {
        patientFeed.innerHTML = '<div class="empty-placeholder"><p>Belum ada data pemeriksaan</p></div>';
        return;
    }
    
    patientFeed.innerHTML = '';
    records.forEach(r => {
        const card = document.createElement('div');
        card.className = `patient-card ${r.priority_status}`;
        if (currentRecord && currentRecord.id === r.id) {
            card.classList.add('active');
        }
        
        const date = new Date(r.created_at);
        const timeStr = date.toLocaleString('id-ID', { 
            day: 'numeric', 
            month: 'short', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        card.innerHTML = `
            <div class="patient-card-header">
                <span class="patient-name">${r.name}</span>
                <span class="patient-priority-badge ${r.priority_status}">${r.priority_status}</span>
            </div>
            <div class="patient-meta">
                <span>${r.age} th</span> • <span>${r.gender}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                Vitals: ${Math.round(r.heart_rate)} bpm | ${Math.round(r.spo2)}% | ${r.body_temp.toFixed(1)}°C
            </div>
            <div class="patient-time">${timeStr}</div>
        `;
        
        card.addEventListener('click', () => {
            document.querySelectorAll('.patient-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            currentRecord = r;
            renderRecordDetail(r);
        });
        
        patientFeed.appendChild(card);
    });
}

// Render detailed medical profile of selected record
function renderRecordDetail(record) {
    if (!record) {
        detailPanel.innerHTML = `
            <div class="empty-placeholder">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
                <p>Pilih salah satu pasien di daftar sebelah kiri untuk melihat rekam medis lengkap.</p>
            </div>
        `;
        return;
    }
    
    const analysis = JSON.parse(record.thermal_analysis);
    const date = new Date(record.created_at);
    const dateStr = date.toLocaleString('id-ID', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const hrAlert = (record.heart_rate > 100 || record.heart_rate < 60) ? 'ALERT' : '';
    const spo2Alert = (record.spo2 < 95) ? 'ALERT' : '';
    const tempAlert = (record.body_temp > 37.5 || record.body_temp < 35.5) ? 'ALERT' : '';
    
    let priorityLabel = "NORMAL";
    if (record.priority_status === 'CRITICAL') priorityLabel = "KRITIS / PRIORITAS UTAMA";
    else if (record.priority_status === 'WARNING') priorityLabel = "PERINGATAN";

    detailPanel.innerHTML = `
        <div class="detail-view">
            <!-- Header detail -->
            <div class="glass-panel" style="padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; border-color: rgba(255,255,255,0.06);">
                <div>
                    <h2 style="font-size: 20px; color:#ffffff;">${record.name}</h2>
                    <span style="font-size: 12px; color: var(--text-secondary);">Waktu Pemindaian: ${dateStr}</span>
                </div>
                <span class="patient-priority-badge ${record.priority_status}" style="font-size: 12px; padding: 6px 14px; border-radius: 8px;">
                    ${priorityLabel}
                </span>
            </div>
            
            <div class="detail-grid">
                <!-- Patient Profile Block -->
                <div class="glass-panel" style="padding: 20px;">
                    <h3 style="font-size: 14px; color: var(--primary); text-transform: uppercase; margin-bottom: 14px; display:flex; align-items:center; gap:6px;">
                        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"></path></svg>
                        Profil & Riwayat Pasien
                    </h3>
                    <div class="patient-profile-section">
                        <div class="profile-item">
                            <span class="profile-label">Nama Lengkap</span>
                            <span class="profile-value">${record.name}</span>
                        </div>
                        <div class="profile-item">
                            <span class="profile-label">Nomor QR</span>
                            <span class="profile-value" style="display:flex; align-items:center; gap:6px;">
                                ${record.qr_code}
                                <button class="btn btn-outline" onclick="showQRModal('${record.qr_code}', '${record.name.replace(/'/g, "\\'")}')" style="padding: 2px 6px; font-size: 10px; line-height: 1; min-height: unset; margin: 0; display: inline-flex; align-items: center; gap: 3px; width: auto; height: auto;">
                                    🔍 QR
                                </button>
                            </span>
                        </div>
                        <div class="profile-item">
                            <span class="profile-label">Umur / Gender</span>
                            <span class="profile-value">${record.age} th / ${record.gender}</span>
                        </div>
                        <div class="profile-item">
                            <span class="profile-label">Telepon</span>
                            <span class="profile-value">${record.phone || '-'}</span>
                        </div>
                        <div class="profile-item" style="grid-column: span 2;">
                            <span class="profile-label">Alamat Tinggal</span>
                            <span class="profile-value">${record.address || '-'}</span>
                        </div>
                        <div class="profile-item history" style="grid-column: span 2;">
                            <span class="profile-label">Riwayat Penyakit</span>
                            <span class="profile-value" style="color: #fca5a5;">${record.medical_history || 'Tidak ada riwayat'}</span>
                        </div>
                    </div>
                </div>
                
                <!-- Vital Signs Block -->
                <div class="glass-panel" style="padding: 20px;">
                    <h3 style="font-size: 14px; color: var(--primary); text-transform: uppercase; margin-bottom: 14px; display:flex; align-items:center; gap:6px;">
                        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75"></path></svg>
                        Tanda Vital Sign
                    </h3>
                    <div class="vitals-grid">
                        <div class="vital-card ${hrAlert}">
                            <div class="vital-icon heart">
                                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24" style="animation: heartBeat ${60 / record.heart_rate}s infinite ease-in-out;"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                            </div>
                            <span class="vital-val">${Math.round(record.heart_rate)}</span>
                            <span class="vital-unit">bpm</span>
                            <span class="vital-lbl">Detak Jantung</span>
                        </div>
                        
                        <div class="vital-card ${spo2Alert}">
                            <div class="vital-icon spo2">
                                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" /></svg>
                            </div>
                            <span class="vital-val">${Math.round(record.spo2)}</span>
                            <span class="vital-unit">%</span>
                            <span class="vital-lbl">Saturasi Oksigen</span>
                        </div>
                        
                        <div class="vital-card ${tempAlert}">
                            <div class="vital-icon temp">
                                <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18m0-18a9 9 0 019 9 9 9 0 01-9 9m0-18a9 9 0 00-9 9 9 9 0 009 9m-9-9h18" /></svg>
                            </div>
                            <span class="vital-val">${record.body_temp.toFixed(1)}</span>
                            <span class="vital-unit">°C</span>
                            <span class="vital-lbl">Suhu Dahi</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Foot Thermal Imaging Panel -->
            <div class="glass-panel thermal-panel">
                <h3 style="font-size: 14px; color: var(--primary); text-transform: uppercase; margin-bottom: 14px; display:flex; align-items:center; gap:6px;">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                    Peta Termal Kaki (Diabetic Foot Thermal Screening)
                </h3>
                
                <div class="thermal-display-container">
                    <div class="thermal-image-wrapper" style="display:flex; gap:12px; align-items:stretch; padding: 8px; background: #fafafa; border: 1px solid #e2e8f0; width: 100%;">
                        <canvas id="thermal-detail-canvas" width="320" height="240" style="flex:1; border-radius:6px; background:#1e293b; cursor:crosshair; min-width: 0;"></canvas>
                        <div class="thermal-legend" style="display:flex; flex-direction:column; align-items:center; justify-content:space-between; width:34px; padding: 4px 0; font-size:9px; color:var(--text-secondary); background:#ffffff; border-radius:4px; border:1px solid #cbd5e1; flex-shrink: 0;">
                            <span style="color:#ef4444; font-weight:bold;">34°C</span>
                            <div style="flex:1; width:8px; margin: 4px 0; border-radius:4px; background: linear-gradient(to bottom, #ef4444, #eab308, #22c55e, #3b82f6); border:1px solid #cbd5e1;"></div>
                            <span style="color:#3b82f6; font-weight:bold;">22°C</span>
                        </div>
                    </div>
                    
                    <div class="thermal-stats-table">
                        <div class="table-row th">
                            <span>Zona</span>
                            <span>Kiri (°C)</span>
                            <span>Kanan (°C)</span>
                            <span>Selisih</span>
                        </div>
                        <div class="table-row">
                            <span>Jari-jari</span>
                            <span>${analysis.left_foot.toes}°C</span>
                            <span>${analysis.right_foot.toes}°C</span>
                            <span class="asym-val ${analysis.asymmetry.toes > 2.2 ? 'critical' : (analysis.asymmetry.toes > 1.5 ? 'warning' : '')}">${analysis.asymmetry.toes}°C</span>
                        </div>
                        <div class="table-row">
                            <span>Tengah</span>
                            <span>${analysis.left_foot.midfoot}°C</span>
                            <span>${analysis.right_foot.midfoot}°C</span>
                            <span class="asym-val ${analysis.asymmetry.midfoot > 2.2 ? 'critical' : (analysis.asymmetry.midfoot > 1.5 ? 'warning' : '')}">${analysis.asymmetry.midfoot}°C</span>
                        </div>
                        <div class="table-row">
                            <span>Tumit</span>
                            <span>${analysis.left_foot.heel}°C</span>
                            <span>${analysis.right_foot.heel}°C</span>
                            <span class="asym-val ${analysis.asymmetry.heel > 2.2 ? 'critical' : (analysis.asymmetry.heel > 1.5 ? 'warning' : '')}">${analysis.asymmetry.heel}°C</span>
                        </div>
                        <div class="table-row" style="border-top: 1px solid rgba(255,255,255,0.04); font-weight:600; background:rgba(255,255,255,0.015);">
                            <span>Rata-rata</span>
                            <span>${analysis.left_foot.average}°C</span>
                            <span>${analysis.right_foot.average}°C</span>
                            <span>-</span>
                        </div>
                    </div>
                </div>
                
                <div style="margin-top: 12px; font-size:12px; line-height:1.5; color: var(--text-secondary); background: rgba(255,255,255,0.02); padding: 10px 14px; border-radius: 8px; border:1px solid rgba(255,255,255,0.04);">
                    <strong>Interpretasi Thermal:</strong> ${analysis.interpretation}
                </div>
            </div>
            
            <!-- Gemini AI Clinical Summary -->
            <div class="gemini-summary-box">
                <div class="gemini-badge">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                    Ringkasan Gemini AI
                </div>
                <div class="gemini-content">
                    ${record.gemini_summary}
                </div>
            </div>
            
            <!-- Nakes Action Buttons -->
            <div class="nakes-actions">
                <button class="btn btn-outline" onclick="alert('SMS/WhatsApp Notifikasi dijadwalkan untuk dikirim ke keluarga pasien.')">
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 9.75a.625.625 0 1 1-1.25 0 .625.625 0 0 1 1.25 0zm0 0H12v.008H8.625V9.75zm0-2.25a.625.625 0 1 1-1.25 0 .625.625 0 0 1 1.25 0zm0 0H15v.008H8.625V7.5zm0-2.25a.625.625 0 1 1-1.25 0 .625.625 0 0 1 1.25 0zm0 0H12v.008H8.625V5.25zM12 21a9.003 9.003 0 0 0 8.354-5.646 9.003 9.003 0 0 0-8.354.346 9.003 9.003 0 0 0-8.354-.346A9.003 9.003 0 0 0 12 21z" /></svg>
                    Kirim Notifikasi Keluarga
                </button>
                <button class="btn btn-primary" onclick="alert('Surat rujukan digital terbuat dan dikirim ke Puskesmas Kecamatan.')">
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Rujuk Ke Puskesmas
                </button>
            </div>
        </div>
    `;
    
    // Draw thermal canvas
    const canvas = document.getElementById('thermal-detail-canvas');
    if (canvas) {
        const gridData = record.thermal_grid ? JSON.parse(record.thermal_grid) : generateMockThermalGrid(record.id === 1 ? "inflammatory" : "normal");
        drawThermalMap(canvas, gridData);
    }
    
    loadPatientHistory(record.patient_id);
}

// Fetch historical entries of specific patient
async function loadPatientHistory(patientId) {
    try {
        const recordsObj = await firebaseGet("records") || {};
        const records = Object.values(recordsObj).filter(Boolean).filter(r => r.patient_id === patientId);
        
        patientHistory.innerHTML = '';
        
        if (records.length <= 1) {
            patientHistory.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:10px;">Belum ada riwayat bulan sebelumnya.</div>';
            return;
        }
        
        // Sort DESC
        records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        records.slice(1, 6).forEach(r => {
            const date = new Date(r.created_at);
            const dateStr = date.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
            
            const row = document.createElement('div');
            row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.03); font-size:12px;";
            
            row.innerHTML = `
                <span style="color:var(--text-secondary);">${dateStr}</span>
                <span style="color:var(--text-primary); font-weight:500;">
                    ${Math.round(r.heart_rate)} bpm | ${Math.round(r.spo2)}% | ${r.body_temp.toFixed(1)}°C
                </span>
                <span class="patient-priority-badge ${r.priority_status}" style="font-size:9px; padding:1px 4px;">${r.priority_status}</span>
            `;
            patientHistory.appendChild(row);
        });
    } catch (e) {
        console.error('Failed to load patient history', e);
    }
}

// Thermal Colormap Drawing Utilities
function getColormapColor(temp) {
    let t = (temp - 22.0) / (34.0 - 22.0);
    t = Math.max(0, Math.min(1, t));
    
    let r = 0, g = 0, b = 0;
    if (t < 0.25) {
        b = 255;
        g = Math.round(t * 4 * 255);
    } else if (t < 0.5) {
        b = Math.round((0.5 - t) * 4 * 255);
        g = 255;
    } else if (t < 0.75) {
        g = 255;
        r = Math.round((t - 0.5) * 4 * 255);
    } else {
        g = Math.round((1.0 - t) * 4 * 255);
        r = 255;
    }
    return { r, g, b };
}

let currentThermalGrid = null;

function drawThermalMap(canvas, gridList) {
    if (!canvas) return;
    
    let grid = [];
    if (gridList.length === 768) {
        for (let r = 0; r < 24; r++) {
            grid.push(gridList.slice(r * 32, (r + 1) * 32));
        }
    } else if (Array.isArray(gridList) && gridList.length === 24 && Array.isArray(gridList[0])) {
        grid = gridList;
    } else {
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Tidak ada data termal', canvas.width / 2, canvas.height / 2);
        }
        return;
    }
    
    currentThermalGrid = grid;
    drawThermalMapBase(canvas, grid);
    
    if (!canvas.dataset.listenerInstalled) {
        canvas.dataset.listenerInstalled = 'true';
        
        canvas.addEventListener('mousemove', (e) => {
            if (!currentThermalGrid) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const canvasX = x * scaleX;
            const canvasY = y * scaleY;
            
            const col = Math.floor((canvasX / canvas.width) * 32);
            const row = Math.floor((canvasY / canvas.height) * 24);
            
            if (row >= 0 && row < 24 && col >= 0 && col < 32) {
                const temp = currentThermalGrid[row][col];
                const zone = getZoneName(row, col);
                
                drawThermalMapBase(canvas, currentThermalGrid);
                
                const ctx = canvas.getContext('2d');
                
                // Draw interactive crosshair lines
                ctx.strokeStyle = 'rgba(15, 23, 42, 0.3)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.moveTo(canvasX, 0);
                ctx.lineTo(canvasX, canvas.height);
                ctx.moveTo(0, canvasY);
                ctx.lineTo(canvas.width, canvasY);
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Draw dynamic hover tooltip box
                ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;
                
                const text1 = `${temp.toFixed(1)} °C`;
                const text2 = zone;
                ctx.font = 'bold 11px sans-serif';
                const textWidth = Math.max(ctx.measureText(text1).width, ctx.measureText(text2).width) + 16;
                const boxHeight = 40;
                
                let boxX = canvasX + 10;
                let boxY = canvasY + 10;
                
                if (boxX + textWidth > canvas.width) boxX = canvasX - textWidth - 10;
                if (boxY + boxHeight > canvas.height) boxY = canvasY - boxHeight - 10;
                
                ctx.beginPath();
                ctx.roundRect(boxX, boxY, textWidth, boxHeight, 6);
                ctx.fill();
                ctx.stroke();
                
                ctx.fillStyle = '#0f172a';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(text1, boxX + 8, boxY + 16);
                ctx.fillStyle = '#475569';
                ctx.font = '9px sans-serif';
                ctx.fillText(text2, boxX + 8, boxY + 30);
            }
        });
        
        canvas.addEventListener('mouseleave', () => {
            if (currentThermalGrid) {
                drawThermalMapBase(canvas, currentThermalGrid);
            }
        });
    }
}

function drawThermalMapBase(canvas, grid) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 32;
    tempCanvas.height = 24;
    const tempCtx = tempCanvas.getContext('2d');
    const imgData = tempCtx.createImageData(32, 24);
    
    for (let r = 0; r < 24; r++) {
        for (let c = 0; c < 32; c++) {
            const temp = grid[r][c];
            const color = getColormapColor(temp);
            const idx = (r * 32 + c) * 4;
            imgData.data[idx] = color.r;
            imgData.data[idx + 1] = color.g;
            imgData.data[idx + 2] = color.b;
            imgData.data[idx + 3] = 255;
        }
    }
    tempCtx.putImageData(imgData, 0, 0);
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
    
    // Draw dashed region lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.moveTo(0, canvas.height / 3);
    ctx.lineTo(canvas.width, canvas.height / 3);
    ctx.moveTo(0, (canvas.height * 2) / 3);
    ctx.lineTo(canvas.width, (canvas.height * 2) / 3);
    ctx.stroke();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.fillText('KIRI (L)', 15, 20);
    ctx.textAlign = 'right';
    ctx.fillText('KANAN (R)', canvas.width - 15, 20);
}

function getZoneName(row, col) {
    let side = col < 16 ? "Kiri" : "Kanan";
    let zone = "";
    if (row < 8) zone = "Jari-jari";
    else if (row < 16) zone = "Tengah";
    else zone = "Tumit";
    return `${zone} ${side}`;
}

// Thermal Analysis & Mock Grid generation
function generateMockThermalGrid(caseType = "normal") {
    let grid = [];
    for (let r = 0; r < 24; r++) {
        let row = [];
        for (let c = 0; c < 32; c++) {
            row.push(23.5 + (Math.random() - 0.5) * 0.4);
        }
        grid.push(row);
    }
    
    for (let r = 2; r < 22; r++) {
        let width = (r >= 8 && r <= 14) ? 4 : 5;
        
        let l_center = 8;
        let l_temp = 29.0 + (Math.random() - 0.5) * 0.6;
        for (let c = l_center - width; c <= l_center + width; c++) {
            grid[r][c] = l_temp;
        }
        
        let r_center = 23;
        let r_temp = 29.1 + (Math.random() - 0.5) * 0.6;
        for (let c = r_center - width; c <= r_center + width; c++) {
            grid[r][c] = r_temp;
        }
    }
    
    if (caseType === "inflammatory") {
        for (let r = 2; r <= 7; r++) {
            for (let c = 20; c <= 25; c++) {
                grid[r][c] = 32.8 + (Math.random() - 0.5) * 0.8;
            }
        }
        for (let r = 2; r <= 7; r++) {
            for (let c = 5; c <= 10; c++) {
                grid[r][c] = 28.5 + (Math.random() - 0.5) * 0.6;
            }
        }
    } else if (caseType === "ischemic") {
        for (let r = 12; r <= 21; r++) {
            for (let c = 5; c <= 11; c++) {
                grid[r][c] = 24.8 + (Math.random() - 0.5) * 0.6;
            }
        }
    } else if (caseType === "neuropathic") {
        for (let r = 8; r <= 11; r++) {
            for (let c = 5; c <= 10; c++) {
                grid[r][c] = 32.4 + (Math.random() - 0.5) * 0.8;
            }
            for (let c = 20; c <= 25; c++) {
                grid[r][c] = 32.6 + (Math.random() - 0.5) * 0.8;
            }
        }
    }
    return grid;
}

function analyzeThermalData(grid) {
    let threshold = 26.0;
    
    function getZoneStats(grid, isLeft, rowStart, rowEnd) {
        let sum = 0, count = 0, totalSum = 0, totalCount = 0;
        let colStart = isLeft ? 0 : 16;
        let colEnd = isLeft ? 16 : 32;
        
        for (let r = rowStart; r < rowEnd; r++) {
            for (let c = colStart; c < colEnd; c++) {
                let val = grid[r][c];
                totalSum += val;
                totalCount++;
                if (val > threshold) {
                    sum += val;
                    count++;
                }
            }
        }
        return count > 0 ? (sum / count) : (totalSum / totalCount);
    }
    
    let l_toes = getZoneStats(grid, true, 0, 8);
    let l_midfoot = getZoneStats(grid, true, 8, 16);
    let l_heel = getZoneStats(grid, true, 16, 24);
    let l_avg = (l_toes + l_midfoot + l_heel) / 3.0;
    
    let r_toes = getZoneStats(grid, false, 0, 8);
    let r_midfoot = getZoneStats(grid, false, 8, 16);
    let r_heel = getZoneStats(grid, false, 16, 24);
    let r_avg = (r_toes + r_midfoot + r_heel) / 3.0;
    
    let asym_toes = Math.abs(l_toes - r_toes);
    let asym_midfoot = Math.abs(l_midfoot - r_midfoot);
    let asym_heel = Math.abs(l_heel - r_heel);
    
    let l_hotspots = [];
    let l_coldspots = [];
    if (l_toes > l_avg + 2.0) l_hotspots.push("toes");
    else if (l_toes < l_avg - 2.0) l_coldspots.push("toes");
    if (l_midfoot > l_avg + 2.0) l_hotspots.push("midfoot");
    else if (l_midfoot < l_avg - 2.0) l_coldspots.push("midfoot");
    if (l_heel > l_avg + 2.0) l_hotspots.push("heel");
    else if (l_heel < l_avg - 2.0) l_coldspots.push("heel");
    
    let r_hotspots = [];
    let r_coldspots = [];
    if (r_toes > r_avg + 2.0) r_hotspots.push("toes");
    else if (r_toes < r_avg - 2.0) r_coldspots.push("toes");
    if (r_midfoot > r_avg + 2.0) r_hotspots.push("midfoot");
    else if (r_midfoot < r_avg - 2.0) r_coldspots.push("midfoot");
    if (r_heel > r_avg + 2.0) r_hotspots.push("heel");
    else if (r_heel < r_avg - 2.0) r_coldspots.push("heel");
    
    let interpretations = [];
    let priority = "NORMAL";
    
    let max_asym = Math.max(asym_toes, asym_midfoot, asym_heel);
    if (max_asym > 2.2) {
        priority = "CRITICAL";
        interpretations.push(`Terdeteksi asimetri termal kritis sebesar ${max_asym.toFixed(1)}°C antara kaki kiri dan kanan.`);
    } else if (max_asym > 1.5) {
        priority = "WARNING";
        interpretations.push(`Terdeteksi asimetri termal ringan sebesar ${max_asym.toFixed(1)}°C.`);
    }
    
    if (l_hotspots.length > 0 || r_hotspots.length > 0) {
        priority = priority === "NORMAL" ? "WARNING" : priority;
        let desc = [];
        if (l_hotspots.length > 0) desc.push(`kiri (${l_hotspots.join(", ")})`);
        if (r_hotspots.length > 0) desc.push(`kanan (${r_hotspots.join(", ")})`);
        interpretations.push(`Hotspot lokal terdeteksi pada kaki ${desc.join(" dan ")} - indikasi potensi inflamasi/pra-ulkus.`);
    }
    
    if (l_coldspots.length > 0 || r_coldspots.length > 0) {
        priority = priority === "NORMAL" ? "WARNING" : priority;
        let desc = [];
        if (l_coldspots.length > 0) desc.push(`kiri (${l_coldspots.join(", ")})`);
        if (r_coldspots.length > 0) desc.push(`kanan (${r_coldspots.join(", ")})`);
        interpretations.push(`Area dingin lokal terdeteksi pada kaki ${desc.join(" dan ")} - indikasi potensi iskemia/gangguan sirkulasi.`);
    }
    
    if (interpretations.length === 0) {
        interpretations.push("Distribusi suhu kaki seimbang dan simetris bilateral.");
    }
    
    return {
        left_foot: {
            toes: parseFloat(l_toes.toFixed(2)),
            midfoot: parseFloat(l_midfoot.toFixed(2)),
            heel: parseFloat(l_heel.toFixed(2)),
            average: parseFloat(l_avg.toFixed(2))
        },
        right_foot: {
            toes: parseFloat(r_toes.toFixed(2)),
            midfoot: parseFloat(r_midfoot.toFixed(2)),
            heel: parseFloat(r_heel.toFixed(2)),
            average: parseFloat(r_avg.toFixed(2))
        },
        asymmetry: {
            toes: parseFloat(asym_toes.toFixed(2)),
            midfoot: parseFloat(asym_midfoot.toFixed(2)),
            heel: parseFloat(asym_heel.toFixed(2))
        },
        hotspots: { left: l_hotspots, right: r_hotspots },
        coldspots: { left: l_coldspots, right: r_coldspots },
        interpretation: interpretations.join(" "),
        priority_status: priority
    };
}

// Rules-based clinical summary fallback engine
function getOfflineSummary(patient, heart_rate, spo2, body_temp, thermal_analysis) {
    const name = patient.name || "Pasien";
    const age = patient.age || 0;
    const gender = patient.gender || "L/P";
    const history = patient.medical_history || "Tidak ada";
    
    let vitals_notes = [];
    if (body_temp > 37.5) vitals_notes.push(`suhu tubuh ${body_temp}°C (demam/febris)`);
    else if (body_temp < 35.5) vitals_notes.push(`suhu tubuh ${body_temp}°C (hipotermia ringan)`);
    else vitals_notes.push(`suhu tubuh ${body_temp}°C (normal)`);

    if (spo2 < 95.0) vitals_notes.push(`saturasi oksigen SpO2 ${spo2}% (hipoksia ringan, normal >=95%)`);
    else vitals_notes.push(`SpO2 ${spo2}% (normal)`);

    if (heart_rate > 100.0) vitals_notes.push(`detak jantung ${heart_rate} bpm (takikardia ringan/sedang)`);
    else if (heart_rate < 60.0) vitals_notes.push(`detak jantung ${heart_rate} bpm (bradikardia, waspada)`);
    else vitals_notes.push(`detak jantung ${heart_rate} bpm (normal)`);

    let vitals_summary = `${name} (${age} th, ${gender}) dengan riwayat ${history}. Hasil vital sign: ` + vitals_notes.join(", ") + ".";
    
    const priority = thermal_analysis.priority_status || "NORMAL";
    const foot_notes = thermal_analysis.interpretation || "";
    
    let recommendations = [];
    if (priority === "CRITICAL") {
        recommendations.push("Prioritaskan pemeriksaan fisik langsung pada kaki pasien oleh nakes/bidan desa dalam 48 jam.");
        recommendations.push("Cek apakah terdapat mikro-luka, kemerahan, atau penebalan kulit (callus) pada area jari/telapak kaki.");
        recommendations.push("Edukasi pasien untuk tidak berjalan tanpa alas kaki dan menjaga kebersihan kaki.");
    } else if (priority === "WARNING") {
        recommendations.push("Pantau perkembangan suhu kaki pada pemeriksaan bulan depan.");
        recommendations.push("Edukasi perawatan kaki mandiri (membersihkan kaki dan memberikan pelembab).");
    }
    
    if (spo2 < 95.0) recommendations.push("Pantau saturasi oksigen berkala. Sarankan istirahat cukup.");
    if (body_temp > 37.5) recommendations.push("Sarankan kompres hangat dan pantau terus suhu badan.");
    if (heart_rate > 100.0) recommendations.push("Edukasi untuk relaksasi dan batasi kafein.");
    
    if (recommendations.length === 0) {
        recommendations.push("Kondisi umum stabil. Lanjutkan kontrol rutin bulanan di SehatDesa Station Balai Desa.");
    }
    
    return vitals_summary + " " + foot_notes + " Rekomendasi Klinis: " + recommendations.join(" ");
}

// Direct Gemini API REST client
async function generateMedicalSummary(patient, heart_rate, spo2, body_temp, thermal_analysis) {
    const apiKey = localStorage.getItem("GEMINI_API_KEY");
    if (!apiKey) {
        return getOfflineSummary(patient, heart_rate, spo2, body_temp, thermal_analysis);
    }
    
    const prompt = `
    Kamu adalah sistem AI Asisten Medis untuk program 'SehatDesa Station' di Indonesia.
    Tugasmu adalah menganalisis data pemeriksaan mandiri lansia di Balai Desa dan memberikan ringkasan klinis singkat, padat, dan terstruktur untuk dibaca oleh Bidan Desa atau Tenaga Medis Puskesmas.

    DATA PASIEN:
    Nama: ${patient.name}
    Umur: ${patient.age} tahun
    Jenis Kelamin: ${patient.gender}
    Riwayat Penyakit: ${patient.medical_history || 'Tidak ada'}

    HASIL SENSOR VITAL SIGN:
    - Detak Jantung: ${heart_rate} bpm (Normal: 60-100 bpm)
    - Saturasi Oksigen (SpO2): ${spo2}% (Normal: >= 95%)
    - Suhu Tubuh (Dahi): ${body_temp}°C (Normal: 36.0-37.3°C)

    HASIL DETEKSI FOOT THERMAL (Skrining Kaki Diabetes):
    - Status Analisis: ${thermal_analysis.priority_status}
    - Rata-rata Suhu Kaki Kiri: ${thermal_analysis.left_foot.average}°C
    - Rata-rata Suhu Kaki Kanan: ${thermal_analysis.right_foot.average}°C
    - Asimetri per Zona (Kiri vs Kanan):
      * Jari (Toes): ${thermal_analysis.asymmetry.toes}°C (Kritis jika >2.2°C)
      * Tengah (Midfoot): ${thermal_analysis.asymmetry.midfoot}°C
      * Tumit (Heel): ${thermal_analysis.asymmetry.heel}°C
    - Hotspots (Potensi Inflamasi/Pre-ulkus): ${JSON.stringify(thermal_analysis.hotspots)}
    - Coldspots (Potensi Iskemia/Sirkulasi buruk): ${JSON.stringify(thermal_analysis.coldspots)}
    - Interpretasi Awal: ${thermal_analysis.interpretation}

    Format output yang di inginkan (TULIS DALAM BAHASA INDONESIA, MAKSIMAL 3-4 KALIMAT, langsung ke poin klinis penting):
    [Nama Pasien] ([Umur] th), [Keluhan/Riwayat]. Pemeriksaan menunjukkan [Ringkasan status vital sign]. [Ringkasan kondisi termal kaki: sebutkan jika ada asimetri >2.2C atau hotspot/coldspot]. Rekomendasi: [Tindakan taktis konkret untuk bidan desa].

    Ingat: Jangan berikan diagnosis medis final, gunakan terminologi screening seperti 'potensi', 'indikasi', 'risiko', 'sarankan pemeriksaan lanjutan'.
    `;
    
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        if (res.ok) {
            const data = await res.json();
            return data.candidates[0].content.parts[0].text.trim();
        }
    } catch (e) {
        console.error("Gemini API error:", e);
    }
    return getOfflineSummary(patient, heart_rate, spo2, body_temp, thermal_analysis);
}

// Simulator triggers (client-side execution)
async function triggerSimQR() {
    const select = document.getElementById('sim-patient-select');
    const qrCode = select.value;
    if (!qrCode) {
        alert("Harap pilih kartu QR pasien terlebih dahulu!");
        return;
    }
    
    const patientsObj = await firebaseGet("patients") || {};
    let patient = null;
    for (let p of Object.values(patientsObj)) {
        if (p.qr_code === qrCode) {
            patient = p;
            break;
        }
    }
    
    if (!patient) {
        alert(`QR Code ${qrCode} tidak terdaftar!`);
        return;
    }
    
    kioskSession.state = "PATIENT_IDENTIFIED";
    kioskSession.currentPatient = patient;
    kioskSession.heartRate = null;
    kioskSession.spo2 = null;
    kioskSession.bodyTemp = null;
    kioskSession.thermalGrid = null;
    kioskSession.thermalAnalysis = null;
    kioskSession.geminiSummary = null;
    kioskSession.priorityStatus = "NORMAL";
    
    broadcastStateUpdate();
}

async function triggerSimVitals() {
    if (kioskSession.state !== "PATIENT_IDENTIFIED") {
        alert("Harap scan kartu QR pasien terlebih dahulu!");
        return;
    }
    
    const hr = parseFloat(document.getElementById('sim-hr').value);
    const spo2 = parseFloat(document.getElementById('sim-spo2').value);
    const temp = parseFloat(document.getElementById('sim-temp').value);
    
    kioskSession.heartRate = hr;
    kioskSession.spo2 = spo2;
    kioskSession.bodyTemp = temp;
    kioskSession.state = "READING_THERMAL";
    
    broadcastStateUpdate();
}

async function triggerSimThermal() {
    if (kioskSession.state !== "READING_THERMAL") {
        alert("Harap selesaikan pemindaian vital sign terlebih dahulu!");
        return;
    }
    
    kioskSession.state = "PROCESSING";
    broadcastStateUpdate();
    
    const activeChip = document.querySelector('.preset-chip[data-case].active');
    const caseType = activeChip ? activeChip.getAttribute('data-case') : 'normal';
    
    // Simulate grid local creation
    const grid = generateMockThermalGrid(caseType);
    kioskSession.thermalGrid = grid;
    
    const analysis = analyzeThermalData(grid);
    kioskSession.thermalAnalysis = analysis;
    kioskSession.priorityStatus = analysis.priority_status;
    
    // Overall Priority status check
    let vitalsPriority = "NORMAL";
    if (kioskSession.spo2 < 92.0 || kioskSession.bodyTemp > 38.5 || kioskSession.heartRate > 110.0 || kioskSession.heartRate < 50.0) {
        vitalsPriority = "CRITICAL";
    } else if (kioskSession.spo2 < 95.0 || kioskSession.bodyTemp > 37.5 || kioskSession.heartRate > 100.0 || kioskSession.heartRate < 60.0) {
        vitalsPriority = "WARNING";
    }
    
    const priorityOrder = { "NORMAL": 0, "WARNING": 1, "CRITICAL": 2 };
    if (priorityOrder[vitalsPriority] > priorityOrder[kioskSession.priorityStatus]) {
        kioskSession.priorityStatus = vitalsPriority;
        kioskSession.thermalAnalysis.priority_status = vitalsPriority;
    }
    
    // AI Summary
    const summary = await generateMedicalSummary(
        kioskSession.currentPatient,
        kioskSession.heartRate,
        kioskSession.spo2,
        kioskSession.bodyTemp,
        kioskSession.thermalAnalysis
    );
    kioskSession.geminiSummary = summary;
    
    // Save to Firebase RTDB
    const recordsObj = await firebaseGet("records") || {};
    const validKeys = Object.keys(recordsObj).map(Number).filter(k => !isNaN(k) && k > 0);
    const nextId = validKeys.length > 0 ? Math.max(...validKeys) + 1 : 1;
    
    const newRecord = {
        id: nextId,
        patient_id: kioskSession.currentPatient.id,
        heart_rate: kioskSession.heartRate,
        spo2: kioskSession.spo2,
        body_temp: kioskSession.bodyTemp,
        thermal_grid: JSON.stringify(kioskSession.thermalGrid),
        thermal_analysis: JSON.stringify(kioskSession.thermalAnalysis),
        gemini_summary: kioskSession.geminiSummary,
        priority_status: kioskSession.priorityStatus,
        created_at: new Date().toISOString()
    };
    
    await firebasePut(`records/${nextId}`, newRecord);
    
    kioskSession.state = "COMPLETED";
    broadcastStateUpdate(newRecord);
    
    playNotificationSound();
    loadRecords();
}

function triggerReset() {
    kioskSession.state = "IDLE";
    kioskSession.currentPatient = null;
    kioskSession.heartRate = null;
    kioskSession.spo2 = null;
    kioskSession.bodyTemp = null;
    kioskSession.thermalGrid = null;
    kioskSession.thermalAnalysis = null;
    kioskSession.geminiSummary = null;
    kioskSession.priorityStatus = "NORMAL";
    
    broadcastStateUpdate();
}

function broadcastStateUpdate(record = null) {
    handleStateUpdate(
        kioskSession.state, 
        kioskSession.currentPatient, 
        kioskSession.heartRate ? { heart_rate: kioskSession.heartRate, spo2: kioskSession.spo2, body_temp: kioskSession.bodyTemp } : null, 
        kioskSession.thermalGrid, 
        record
    );
    
    // Keep Firebase in sync
    firebasePut("kiosk_session", {
        state: kioskSession.state,
        patient: kioskSession.currentPatient,
        vitals: kioskSession.heartRate ? { heart_rate: kioskSession.heartRate, spo2: kioskSession.spo2, body_temp: kioskSession.bodyTemp } : null,
        thermalGrid: kioskSession.thermalGrid
    });
}

// Multi-Tab polling sync
async function pollKioskSession() {
    const session = await firebaseGet("kiosk_session");
    if (session && session.state !== kioskSession.state) {
        kioskSession.state = session.state;
        kioskSession.currentPatient = session.patient;
        kioskSession.heartRate = session.vitals ? session.vitals.heart_rate : null;
        kioskSession.spo2 = session.vitals ? session.vitals.spo2 : null;
        kioskSession.bodyTemp = session.vitals ? session.vitals.body_temp : null;
        kioskSession.thermalGrid = session.thermalGrid;
        
        // Fetch new completed record details if applicable
        let record = null;
        if (session.state === "COMPLETED") {
            const recordsObj = await firebaseGet("records") || {};
            const records = Object.values(recordsObj);
            if (records.length > 0) {
                records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                record = records[0];
            }
        }
        
        handleStateUpdate(
            kioskSession.state,
            kioskSession.currentPatient,
            session.vitals,
            kioskSession.thermalGrid,
            record
        );
        
        if (session.state === "COMPLETED") {
            playNotificationSound();
            loadRecords();
        }
    }
}

// Register new patient directly to Firebase RTDB
// Global state for QR code print/download
let lastRegisteredPatient = null;

// Register new patient directly to Firebase RTDB
async function handleRegisterPatient(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const age = parseInt(document.getElementById('reg-age').value);
    const gender = document.getElementById('reg-gender').value;
    const qr_code = document.getElementById('reg-qr').value;
    const phone = document.getElementById('reg-phone').value;
    const address = document.getElementById('reg-address').value;
    const medical_history = document.getElementById('reg-history').value;
    
    try {
        const patientsObj = await firebaseGet("patients") || {};
        const patients = Object.values(patientsObj).filter(Boolean);
        
        for (let p of patients) {
            if (p.qr_code === qr_code) {
                alert(`Pendaftaran gagal: Kode QR ${qr_code} sudah terdaftar!`);
                return;
            }
        }
        
        const nextId = patients.length > 0 ? Math.max(...patients.map(p => p.id)) + 1 : 1;
        const newPatient = {
            id: nextId,
            name,
            age,
            gender,
            qr_code,
            phone,
            address,
            medical_history,
            created_at: new Date().toISOString()
        };
        
        await firebasePut(`patients/${nextId}`, newPatient);
        
        // Hide form, show success QR view
        document.getElementById('register-patient-form').style.display = 'none';
        const successQrDiv = document.getElementById('register-success-qr');
        successQrDiv.style.display = 'flex';
        
        // Render QR Code
        const container = document.getElementById('reg-qrcode-container');
        container.innerHTML = '';
        new QRCode(container, {
            text: qr_code,
            width: 140,
            height: 140,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        
        document.getElementById('reg-success-name').textContent = name;
        document.getElementById('reg-success-id').textContent = qr_code;
        
        lastRegisteredPatient = newPatient;
        
        loadPatients();
    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan koneksi.');
    }
}

// Helper functions for registration QR Code download/print
function downloadRegisteredQR() {
    if (!lastRegisteredPatient) return;
    const canvas = document.querySelector('#reg-qrcode-container canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `QR_Sayangi_${lastRegisteredPatient.name.replace(/\s+/g, '_')}_${lastRegisteredPatient.qr_code}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
}

function printRegisteredQR() {
    if (!lastRegisteredPatient) return;
    const canvas = document.querySelector('#reg-qrcode-container canvas');
    if (!canvas) return;
    const w = window.open('', '_blank');
    w.document.write(`
        <html>
        <head>
            <title>Cetak QR Code Pasien - Sayangi</title>
            <style>
                body {
                    text-align: center;
                    padding: 40px;
                    font-family: system-ui, -apple-system, sans-serif;
                    background: #fff;
                    color: #111827;
                }
                .card {
                    display: inline-block;
                    border: 2px dashed #0d9488;
                    border-radius: 16px;
                    padding: 24px;
                    max-width: 280px;
                }
                h2 { margin: 0 0 4px 0; color: #0d9488; font-size: 20px; }
                h4 { margin: 0 0 16px 0; color: #6b7280; font-size: 13px; font-weight: normal; }
                .name { font-size: 18px; font-weight: bold; margin-top: 14px; }
                .qr-val { font-family: monospace; font-size: 12px; color: #4b5563; margin-top: 4px; }
                .footer-text { font-size: 10px; color: #9ca3af; margin-top: 16px; }
            </style>
        </head>
        <body onload="window.print()">
            <div class="card">
                <h2>SAYANGI</h2>
                <h4>Kios Kesehatan Mandiri Desa</h4>
                <img src="${canvas.toDataURL('image/png')}" style="width:160px; height:160px;">
                <div class="name">${lastRegisteredPatient.name}</div>
                <div class="qr-val">${lastRegisteredPatient.qr_code}</div>
                <div class="footer-text">Tempelkan QR Code ini ke kamera Sayangi Station untuk memulai pemeriksaan mandiri.</div>
            </div>
        </body>
        </html>
    `);
    w.document.close();
}

function resetRegistrationForm() {
    document.getElementById('register-patient-form').style.display = 'flex';
    document.getElementById('register-success-qr').style.display = 'none';
    document.getElementById('register-patient-form').reset();
    
    // Generate new unique QR Code ID with 5 digits
    const regQrInput = document.getElementById('reg-qr');
    if (regQrInput) {
        regQrInput.value = 'PAS-' + String(Math.floor(10000 + Math.random() * 90000));
    }
}

// Modal QR viewer functions
function showQRModal(qrCode, name) {
    const container = document.getElementById('modal-qrcode-container');
    container.innerHTML = '';
    
    document.getElementById('modal-qr-name').textContent = name;
    document.getElementById('modal-qr-id').textContent = qrCode;
    
    new QRCode(container, {
        text: qrCode,
        width: 140,
        height: 140,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
    
    document.getElementById('qr-viewer-modal').style.display = 'flex';
}

function closeQRModal() {
    document.getElementById('qr-viewer-modal').style.display = 'none';
}

function downloadModalQR() {
    const canvas = document.querySelector('#modal-qrcode-container canvas');
    const name = document.getElementById('modal-qr-name').textContent;
    const qrCode = document.getElementById('modal-qr-id').textContent;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `QR_Sayangi_${name.replace(/\s+/g, '_')}_${qrCode}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
}

function printModalQR() {
    const canvas = document.querySelector('#modal-qrcode-container canvas');
    const name = document.getElementById('modal-qr-name').textContent;
    const qrCode = document.getElementById('modal-qr-id').textContent;
    if (!canvas) return;
    const w = window.open('', '_blank');
    w.document.write(`
        <html>
        <head>
            <title>Cetak QR Code Pasien - Sayangi</title>
            <style>
                body {
                    text-align: center;
                    padding: 40px;
                    font-family: system-ui, -apple-system, sans-serif;
                    background: #fff;
                    color: #111827;
                }
                .card {
                    display: inline-block;
                    border: 2px dashed #0d9488;
                    border-radius: 16px;
                    padding: 24px;
                    max-width: 280px;
                }
                h2 { margin: 0 0 4px 0; color: #0d9488; font-size: 20px; }
                h4 { margin: 0 0 16px 0; color: #6b7280; font-size: 13px; font-weight: normal; }
                .name { font-size: 18px; font-weight: bold; margin-top: 14px; }
                .qr-val { font-family: monospace; font-size: 12px; color: #4b5563; margin-top: 4px; }
                .footer-text { font-size: 10px; color: #9ca3af; margin-top: 16px; }
            </style>
        </head>
        <body onload="window.print()">
            <div class="card">
                <h2>SAYANGI</h2>
                <h4>Kios Kesehatan Mandiri Desa</h4>
                <img src="${canvas.toDataURL('image/png')}" style="width:160px; height:160px;">
                <div class="name">${name}</div>
                <div class="qr-val">${qrCode}</div>
                <div class="footer-text">Tempelkan QR Code ini ke kamera Sayangi Station untuk memulai pemeriksaan mandiri.</div>
            </div>
        </body>
        </html>
    `);
    w.document.close();
}

// Preset vital chip loader
function loadVitalsPreset(type) {
    document.querySelectorAll('[data-vpreset]').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    const hrSlider = document.getElementById('sim-hr');
    const spo2Slider = document.getElementById('sim-spo2');
    const tempSlider = document.getElementById('sim-temp');
    
    switch (type) {
        case 'normal':
            hrSlider.value = 76;
            spo2Slider.value = 98;
            tempSlider.value = 36.4;
            break;
        case 'fever':
            hrSlider.value = 102;
            spo2Slider.value = 96;
            tempSlider.value = 38.2;
            break;
        case 'hypoxia':
            hrSlider.value = 88;
            spo2Slider.value = 91;
            tempSlider.value = 35.9;
            break;
    }
    
    hrSlider.dispatchEvent(new Event('input'));
    spo2Slider.dispatchEvent(new Event('input'));
    tempSlider.dispatchEvent(new Event('input'));
}

// Auto run demo flow helper
async function runDemoWorkflow() {
    const select = document.getElementById('sim-patient-select');
    if (!select.value) {
        select.value = 'PAS-002';
    }
    
    triggerSimQR();
    await new Promise(r => setTimeout(r, 2500));
    
    const hrSlider = document.getElementById('sim-hr');
    const spo2Slider = document.getElementById('sim-spo2');
    const tempSlider = document.getElementById('sim-temp');
    
    hrSlider.value = 85;
    spo2Slider.value = 97;
    tempSlider.value = 36.6;
    
    hrSlider.dispatchEvent(new Event('input'));
    spo2Slider.dispatchEvent(new Event('input'));
    tempSlider.dispatchEvent(new Event('input'));
    
    triggerSimVitals();
    await new Promise(r => setTimeout(r, 2500));
    
    const presetBtn = document.querySelector('[data-case="inflammatory"]');
    if (presetBtn) {
        document.querySelectorAll('[data-case]').forEach(b => b.classList.remove('active'));
        presetBtn.classList.add('active');
    }
    
    triggerSimThermal();
}

// Switch tabs layout
function switchTab(tabName) {
    activeTab = tabName;

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeTabBtn = document.querySelector(`.tab-btn[onclick="switchTab('${tabName}')"]`);
    if (activeTabBtn) activeTabBtn.classList.add('active');

    const kioskPanel    = document.getElementById('kiosk-view-panel');
    const leftSide      = document.getElementById('split-left-side');
    const dashboardPanel = document.getElementById('nakes-dashboard-panel');
    const workspace     = document.querySelector('.main-workspace');

    if (tabName === 'split') {
        workspace.className = 'main-workspace split-layout';
        if (leftSide) leftSide.style.display = 'flex';
        kioskPanel.style.display    = 'flex';
        dashboardPanel.style.display = 'flex';
    } else {
        workspace.className = 'main-workspace';
        if (leftSide) leftSide.style.display = 'none';
        kioskPanel.style.display    = tabName === 'kiosk' ? 'flex' : 'none';
        dashboardPanel.style.display = tabName === 'nakes' ? 'flex' : 'none';
    }
}

function testSpeech() {
    speak("Sistem panduan suara Sehat Desa Station aktif. Siap memandu lansia.");
}

// Page Load Initializations
document.addEventListener('DOMContentLoaded', async () => {
    // Gemini key setup from localStorage
    const keyInput = document.getElementById('gemini-key-input');
    if (keyInput) {
        keyInput.value = localStorage.getItem("GEMINI_API_KEY") || "";
        keyInput.addEventListener('change', (e) => {
            localStorage.setItem("GEMINI_API_KEY", e.target.value.trim());
        });
    }

    const regQrInput = document.getElementById('reg-qr');
    if (regQrInput) {
        regQrInput.value = 'PAS-' + String(Math.floor(10000 + Math.random() * 90000));
    }
    
    document.querySelectorAll('[data-feed-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-feed-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.getAttribute('data-feed-filter');
            loadRecords(filter);
        });
    });
    
    const regForm = document.getElementById('register-patient-form');
    if (regForm) {
        regForm.addEventListener('submit', handleRegisterPatient);
    }
    
    // Initialize Database in Firebase & local cache
    await initDatabase();
    
    // Load initial views
    loadPatients();
    loadRecords();
    
    // Start polling sync
    setInterval(pollKioskSession, 2000);
    
    // Wire up simulator sliders to live-value display
    const wireSlider = (id, valId, decimals = 0) => {
        const slider = document.getElementById(id);
        const label  = document.getElementById(valId);
        if (slider && label) {
            const update = () => label.textContent = parseFloat(slider.value).toFixed(decimals);
            slider.addEventListener('input', update);
            update();
        }
    };
    wireSlider('sim-hr',   'sim-hr-val',   0);
    wireSlider('sim-spo2', 'sim-spo2-val', 0);
    wireSlider('sim-temp', 'sim-temp-val', 1);

    switchTab('split');
});
