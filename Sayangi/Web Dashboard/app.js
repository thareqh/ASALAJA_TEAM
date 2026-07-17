// Firebase Realtime Database Config
const FIREBASE_URL = "https://sayangi-614e3-default-rtdb.asia-southeast1.firebasedatabase.app";

// Local State
let currentRecord = null;
let currentPatient = null;
let activeTab = 'split'; 
let speakEnabled = false;

// Active Booth Session state (replacing server-side session)
let boothSession = {
    state: "IDLE",
    currentPatient: null,
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
const kioskScreen = document.getElementById('booth-screen');

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
    if (!window.navigator.onLine) {
        offlineQueue.push({ method: 'PUT', path: path, data: data, timestamp: new Date().toISOString() });
        localStorage.setItem("SAYANGI_OFFLINE_QUEUE", JSON.stringify(offlineQueue));
        updateOfflineSyncStatus();
        console.log(`Saved offline (PUT) to: ${path}`);
        return data;
    }
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
            "PAS-001": { id: "PAS-001", name: "Pak Ahmad", age: 68, gender: "Laki-laki", qr_code: "PAS-001", phone: "08123456789", address: "Dusun Krajan RT 01/RW 02", medical_history: "Hipertensi ringan", created_at: new Date().toISOString() },
            "PAS-002": { id: "PAS-002", name: "Mbah Sri", age: 72, gender: "Perempuan", qr_code: "PAS-002", phone: "08134567890", address: "Dusun Mawar RT 03/RW 01", medical_history: "Diabetes Melitus Tipe 2, Asam Urat", created_at: new Date().toISOString() },
            "PAS-003": { id: "PAS-003", name: "Pak Sugeng", age: 65, gender: "Laki-laki", qr_code: "PAS-003", phone: "08145678901", address: "Dusun Krajan RT 02/RW 02", medical_history: "Riwayat Penyakit Jantung Koroner", created_at: new Date().toISOString() },
            "PAS-004": { id: "PAS-004", name: "Mbah Aminah", age: 80, gender: "Perempuan", qr_code: "PAS-004", phone: "08156789012", address: "Dusun Kidul RT 05/RW 03", medical_history: "Pernah stroke ringan 2 tahun lalu", created_at: new Date().toISOString() },
            "PAS-005": { id: "PAS-005", name: "Pak Budi", age: 59, gender: "Laki-laki", qr_code: "PAS-005", phone: "08167890123", address: "Dusun Krajan RT 01/RW 02", medical_history: "Kolesterol tinggi", created_at: new Date().toISOString() }
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
                body_temp: 36.7,
                thermal_grid: JSON.stringify(generateMockThermalGrid("inflammatory")),
                thermal_analysis: JSON.stringify(sri_analysis),
                gemini_summary: "Mbah Sri (72 th), pemeriksaan 5 hari lalu. Suhu tubuh 36.7°C (normal). DETEKSI DINI: Terdeteksi asimetri suhu yang sangat signifikan sebesar 3.3°C pada area jari-jari kaki kanan (lebih hangat, potensi inflamasi/pra-ulkus) dibandingkan kaki kiri (lebih dingin, potensi iskemia). Rekomendasi: Segera jadwalkan kunjungan bidan desa untuk mengecek kondisi fisik kaki Mbah Sri secara visual dan palpasi denyut arteri dorsalis pedis.",
                priority_status: "CRITICAL",
                created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
            },
            2: {
                id: 2,
                patient_id: 1,
                body_temp: 37.8,
                thermal_grid: JSON.stringify(generateMockThermalGrid("normal")),
                thermal_analysis: JSON.stringify(ahmad_analysis),
                gemini_summary: "Bapak Ahmad (68 th), pemeriksaan 3 hari lalu. Suhu dahi 37.8°C (demam ringan). Pemeriksaan thermal kaki dalam batas normal. Rekomendasi: Pasien disarankan istirahat, diberikan kompres hangat. Jika demam terus meningkat, lakukan konsultasi dengan puskesmas.",
                priority_status: "WARNING",
                created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
            }
        };
        await firebasePut("records", defaultRecords);
    }
    
    // Seed default admin in Firebase RTDB if none exists
    let admins = await firebaseGet("admins");
    if (!admins) {
        await firebasePut("admins/admin", {
            username: "admin",
            password: "admin123",
            name: "Bidan Siti"
        });
    }
    
    connStatus.innerHTML = '<span class="status-dot"></span> Cloud Database';
    connStatus.className = 'sys-status';
}

// Speak indonesian voices (Disabled to prevent accent issues and unexpected sound)
function speak(text) {
    // No-op
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
}

// Play notification sound
function playNotificationSound() {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
        return;
    }
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

// Handle local Booth state changes
function handleStateUpdate(state, patient, vitals, thermalGrid, record) {
    document.querySelectorAll('.booth-state-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    
    const displayElement = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };
    
    switch (state) {
        case 'IDLE':
            document.getElementById('booth-idle').classList.add('active');
            break;
            
        case 'PATIENT_IDENTIFIED':
            document.getElementById('booth-patient').classList.add('active');
            if (patient) {
                displayElement('booth-pat-name', patient.name);
                displayElement('booth-pat-age', `${patient.age} tahun`);
                displayElement('booth-pat-history', patient.medical_history || 'Tidak ada riwayat');
                speak(`Selamat datang, Mbah ${patient.name}. Pemeriksaan dimulai. Silakan tempelkan dahi ke sensor suhu, dan masukkan jari telunjuk ke lubang sensor jantung.`);
                
                const simSelect = document.getElementById('sim-patient-select');
                if (simSelect) simSelect.value = patient.qr_code;
            }
            break;
            
        case 'READING_VITALS':
            document.getElementById('booth-vitals').classList.add('active');
            speak("Membaca suhu tubuh. Tahan posisi dahi Anda.");
            break;
            
        case 'READING_THERMAL':
        case 'waiting_for_left':
        case 'pending_left':
            document.getElementById('booth-thermal').classList.add('active');
            if (vitals) {
                displayElement('booth-vit-temp', vitals.body_temp.toFixed(1));
            }
            const instrLeft = document.querySelector('#booth-thermal .booth-instruction');
            if (state === 'pending_left') {
                if (instrLeft) instrLeft.innerHTML = "Memproses scan <strong>Kaki Kiri</strong>. Harap tetap berdiri di tempat...";
            } else {
                if (instrLeft) instrLeft.innerHTML = "Suhu tubuh tercatat! Silakan <strong>berdiri dengan KAKI KIRI</strong> di atas pijakan thermal.";
                speak("Suhu dahi terekam. Sekarang, silakan berdiri tegak tanpa alas kaki dengan kaki kiri Anda di atas pijakan termal.");
            }
            break;
            
        case 'waiting_for_right':
        case 'pending_right':
            document.getElementById('booth-thermal').classList.add('active');
            if (vitals) {
                displayElement('booth-vit-temp', vitals.body_temp.toFixed(1));
            }
            const instrRight = document.querySelector('#booth-thermal .booth-instruction');
            if (state === 'pending_right') {
                if (instrRight) instrRight.innerHTML = "Memproses scan <strong>Kaki Kanan</strong>. Mengirim hasil analisis...";
            } else {
                if (instrRight) instrRight.innerHTML = "Kaki Kiri selesai! Sekarang silakan <strong>berdiri dengan KAKI KANAN</strong> di atas pijakan.";
                speak("Kaki kiri Anda selesai dipindai. Sekarang, silakan berdiri dengan kaki kanan Anda di atas pijakan termal.");
            }
            break;
            
        case 'PROCESSING':
            document.getElementById('booth-processing').classList.add('active');
            speak("Pemeriksaan selesai. Data Anda sedang dianalisis oleh Gemini A I.");
            break;
            
        case 'COMPLETED':
            document.getElementById('booth-completed').classList.add('active');
            if (record) {
                displayElement('booth-res-temp', record.body_temp.toFixed(1));
                
                let advise = "Kondisi kaki terdeteksi normal.";
                if (record.priority_status === 'CRITICAL') {
                    advise = "Peringatan: Ditemukan asimetri termal kaki yang signifikan. Prioritaskan kunjungan medis.";
                } else if (record.priority_status === 'WARNING') {
                    advise = "Peringatan: Terdapat deviasi suhu ringan pada kaki Anda.";
                }
                displayElement('booth-res-advise', advise);
                
                speak(`Pemeriksaan selesai, Mbah ${record.name}. Hasil vital sign: suhu tubuh ${record.body_temp.toFixed(1)} derajat celsius. Data sudah dikirimkan langsung ke Ibu Bidan. Terima kasih, Mbah!`);
                
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
        
        // Fetch precheck peserta
        const pesertaObj = await precheckGet("peserta") || {};
        const peserta = Object.values(pesertaObj).filter(Boolean);
        
        const simSelect = document.getElementById('sim-patient-select');
        if (simSelect) {
            simSelect.innerHTML = '<option value="">-- Pilih Kartu QR Pasien --</option>';
            
            // Standard patients
            patients.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.qr_code;
                opt.textContent = `${p.name} (${p.age} th) - ${p.qr_code}`;
                simSelect.appendChild(opt);
            });
            
            // Precheck peserta
            peserta.forEach(p => {
                if (p.firebase_id) {
                    const age = p.tgl_lahir ? calculateAge(p.tgl_lahir) : 0;
                    const opt = document.createElement('option');
                    opt.value = 'SEHATDESA:' + p.firebase_id;
                    opt.textContent = `[PRECHECK] ${p.nama} (${age} th) - SEHATDESA:${p.firebase_id}`;
                    simSelect.appendChild(opt);
                }
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
        const pesertaObj = await precheckGet("peserta") || {};
        
        let records = [];
        for (let r of Object.values(recordsObj).filter(Boolean)) {
            let patient = patientsObj[r.patient_id];
            
            // If patient is not found in normal patients, check precheck /peserta
            if (!patient && pesertaObj[r.patient_id]) {
                const p = pesertaObj[r.patient_id];
                patient = {
                    id: r.patient_id,
                    name: p.nama,
                    age: p.tgl_lahir ? calculateAge(p.tgl_lahir) : 0,
                    gender: p.jenis_kelamin,
                    qr_code: 'SEHATDESA:' + r.patient_id,
                    phone: p.no_hp,
                    address: p.alamat,
                    medical_history: p.keluhan
                };
            }
            
            if (!patient) patient = {};
            
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
        
        // Find patients who have NO visits in records yet
        const recordedPatientIds = new Set(records.map(r => r.patient_id || r.qr_code));
        for (let p of Object.values(patientsObj).filter(Boolean)) {
            if (!recordedPatientIds.has(p.id) && !recordedPatientIds.has(p.qr_code)) {
                records.push({
                    id: 'WAITING_' + p.qr_code,
                    patient_id: p.id,
                    name: p.name,
                    age: p.age,
                    gender: p.gender,
                    qr_code: p.qr_code,
                    phone: p.phone || '',
                    address: p.address || '',
                    medical_history: p.medical_history || '',
                    body_temp: 0,
                    priority_status: p.status === 'PENDING' ? 'PENDING_ACC' : 'BELUM_DIPERIKSA',
                    created_at: p.created_at || new Date().toISOString(),
                    is_dummy: true
                });
            }
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
        
        let badgeLabel = r.priority_status;
        if (r.priority_status === 'PENDING_ACC') badgeLabel = "VERIFIKASI";
        else if (r.priority_status === 'BELUM_DIPERIKSA') badgeLabel = "WAITING";
        
        let screeningText = `Skrining: Suhu ${r.body_temp != null ? r.body_temp.toFixed(1) : '-'}°C`;
        if (r.is_dummy) {
            screeningText = `Status: ${r.priority_status === 'PENDING_ACC' ? 'Pendaftaran Baru' : 'Siap Pemeriksaan'}`;
        }
        
        card.innerHTML = `
            <div class="patient-card-header">
                <span class="patient-name">${r.name}</span>
                <span class="patient-priority-badge ${r.priority_status}">${badgeLabel}</span>
            </div>
            <div class="patient-meta">
                <span>${r.age} th</span> • <span>${r.gender}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${screeningText}
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

    if (record.is_dummy) {
        let statusBadgeClass = 'pending';
        let statusLabel = 'Menunggu Persetujuan';
        let statusDesc = 'Akun warga ini baru didaftarkan secara mandiri dan membutuhkan persetujuan (ACC) dari Bidan sebelum dapat melakukan skrining di Booth Balai Desa.';
        let actionButtons = '';
        
        if (record.priority_status === 'PENDING_ACC') {
            statusBadgeClass = 'pending';
            statusLabel = 'Menunggu Verifikasi (PENDING)';
            actionButtons = `
                <button class="btn btn-primary" onclick="approvePatient('${record.patient_id}')" style="background:var(--green); border-color:var(--green); font-size:12px; padding:10px 18px; height:auto; width:auto; display:flex; align-items:center; gap:6px; margin:0;">
                    ✓ Setujui &amp; Aktifkan QR Code Pasien
                </button>
            `;
        } else {
            statusBadgeClass = 'approved';
            statusLabel = 'Warga Terverifikasi (APPROVED)';
            statusDesc = 'Akun warga terverifikasi. Pasien ini siap melakukan pemindaian suhu tubuh non-kontak dan termal telapak kaki di Booth SehatDesa.';
            actionButtons = `
                <button class="btn btn-primary" onclick="identifyPatient('${record.qr_code}')" style="font-size:12px; padding:10px 18px; height:auto; width:auto; display:flex; align-items:center; gap:6px; margin:0;">
                    ⚡ Panggil ke Booth / Mulai Skrining
                </button>
            `;
        }
        
        detailPanel.innerHTML = `
            <div class="detail-view">
                <!-- Header detail -->
                <div class="glass-panel" style="padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; border-color: rgba(255,255,255,0.06);">
                    <div>
                        <h2 style="font-size: 20px; color:#ffffff; margin:0 0 4px 0;">${record.name}</h2>
                        <span style="font-size: 11px; color: var(--text-secondary);">Waktu Pendaftaran: ${new Date(record.created_at).toLocaleString('id-ID')}</span>
                    </div>
                    <span class="verify-badge ${statusBadgeClass}" style="font-size: 11px; padding: 6px 14px; border-radius: 8px; font-weight:bold;">
                        ${statusLabel}
                    </span>
                </div>
                
                <div style="display:flex; flex-direction:column; gap:14px; margin-top:14px;">
                    <!-- Patient Profile Block -->
                    <div class="glass-panel" style="padding: 20px;">
                        <h3 style="font-size: 14px; color: var(--primary); text-transform: uppercase; margin-bottom: 14px; display:flex; align-items:center; gap:6px;">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"></path></svg>
                            Profil &amp; Pendaftaran Warga
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
                                    <button class="btn btn-outline" onclick="showQRModal('${record.qr_code}', '${(record.name || '').replace(/'/g, "\\'")}')" style="padding: 2px 6px; font-size: 10px; line-height: 1; min-height: unset; margin: 0; display: inline-flex; align-items: center; gap: 3px; width: auto; height: auto;">
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
                    
                    <!-- Verifikasi & Booth Actions -->
                    <div class="glass-panel" style="padding: 20px; display:flex; flex-direction:column; gap:12px;">
                        <h3 style="font-size: 13px; color: var(--teal); text-transform: uppercase; font-weight:700; margin:0;">
                            Status Skrining &amp; Verifikasi
                        </h3>
                        <p style="font-size: 12px; color: var(--text-secondary); line-height:1.5; margin:0;">
                            ${statusDesc}
                        </p>
                        <div style="display:flex; gap:10px; margin-top:8px;">
                            ${actionButtons}
                        </div>
                    </div>
                </div>
            </div>
        `;
        return;
    }
    
    let analysis = {
        left_foot: { toes: 0, midfoot: 0, heel: 0, average: 0 },
        right_foot: { toes: 0, midfoot: 0, heel: 0, average: 0 },
        asymmetry: { toes: 0, midfoot: 0, heel: 0 },
        interpretation: "Tidak ada data termal."
    };
    if (record.thermal_analysis) {
        try {
            analysis = JSON.parse(record.thermal_analysis);
        } catch (e) {
            console.error("Failed to parse thermal analysis JSON:", e);
        }
    }
    const date = new Date(record.created_at);
    const dateStr = date.toLocaleString('id-ID', { 
        day: 'numeric', 
        month: 'long', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
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
                                <button class="btn btn-outline" onclick="showQRModal('${record.qr_code}', '${(record.name || '').replace(/'/g, "\\'")}')" style="padding: 2px 6px; font-size: 10px; line-height: 1; min-height: unset; margin: 0; display: inline-flex; align-items: center; gap: 3px; width: auto; height: auto;">
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
            
            <!-- Diagnostik Multimodal: Termal & Visual AI -->
            <div class="glass-panel" style="padding: 16px;">
                <div style="display:flex; gap:6px; border-bottom:1px solid var(--border-soft); padding-bottom:8px; margin-bottom:12px;">
                    <button class="preset-chip active" id="tab-btn-thermal" onclick="switchDetailTab('thermal')" style="font-size:11px; padding:4px 10px; margin:0; height:28px;">🔥 Peta Termal Kaki</button>
                    <button class="preset-chip" id="tab-btn-visual" onclick="switchDetailTab('visual')" style="font-size:11px; padding:4px 10px; margin:0; height:28px;">📸 Kamera Visual &amp; AI Ulkus</button>
                </div>
                
                <!-- Tab 1: Peta Termal Kaki -->
                <div id="detail-tab-thermal" style="display:block;">
                    <h3 style="font-size: 11px; color: var(--primary); text-transform: uppercase; margin-bottom: 12px; display:flex; align-items:center; gap:6px; font-weight:700;">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
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
                    </div>
                    
                    <div style="margin-top: 12px; font-size:12px; line-height:1.5; color: var(--text-secondary); background: rgba(255,255,255,0.02); padding: 10px 14px; border-radius: 8px; border:1px solid rgba(255,255,255,0.04);">
                        <strong>Interpretasi Thermal:</strong> ${analysis.interpretation}
                    </div>
                </div>
                
                <!-- Tab 2: Kamera Visual & AI Ulkus -->
                <div id="detail-tab-visual" style="display:none;">
                    <h3 style="font-size: 11px; color: var(--primary); text-transform: uppercase; margin-bottom: 12px; display:flex; align-items:center; gap:6px; font-weight:700;">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                        Skrining Visual &amp; Komputer Vision (Roboflow AI)
                    </h3>
                    
                    <div style="display:grid; grid-template-columns: 1.2fr 1fr; gap:14px; align-items:start;">
                        <div class="glass-panel" style="padding:10px; display:flex; flex-direction:column; gap:8px; border-color:var(--border-soft); background:var(--bg);">
                            <div class="camera-stream-wrapper" style="position:relative; width:100%; aspect-ratio:4/3; border-radius:6px; background:#1e293b; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px dashed var(--border);">
                                <canvas id="visual-detail-canvas" width="320" height="240" style="width:100%; height:100%; display:none; border-radius:6px;"></canvas>
                                <img id="visual-stream-img" style="width:100%; height:100%; object-fit:cover; display:none;" alt="Camera stream">
                                <div id="visual-cam-placeholder" style="color:var(--text-3); font-size:11px; text-align:center; padding:20px; line-height:1.5;">
                                     🎥 Umpan kamera belum aktif.<br>Masukkan IP ESP32-CAM di atas lalu nyalakan stream.
                                </div>
                            </div>
                            <div style="display:flex; gap:6px; width:100%;">
                                <button class="btn btn-outline" onclick="toggleVisualStream()" id="btn-toggle-stream" style="font-size:10px; padding:4px 8px; margin:0; height:28px; line-height:1; flex:1;">
                                    🎥 Live Stream
                                </button>
                                <button class="btn btn-primary" onclick="captureFootPhoto()" id="btn-capture-photo" style="font-size:10px; padding:4px 8px; margin:0; height:28px; line-height:1; flex:1;" disabled>
                                    📸 Potret Kaki
                                </button>
                                <input type="file" id="visual-file-input" style="display:none;" accept="image/*" onchange="handleManualVisualUpload(event)">
                                <button class="btn btn-outline" onclick="document.getElementById('visual-file-input').click()" style="font-size:10px; padding:4px 8px; margin:0; height:28px; line-height:1; flex:none; width:auto; font-weight:bold;">
                                    📁 Upload
                                </button>
                            </div>
                        </div>
                        
                        <div class="glass-panel" style="padding:10px; display:flex; flex-direction:column; gap:6px; font-size:11px; height:100%; background:var(--bg); border-color:var(--border-soft);">
                            <h4 style="font-size:10px; text-transform:uppercase; font-weight:700; color:var(--text-2); border-bottom:1px solid var(--border); padding-bottom:4px; margin-bottom:4px; margin-top:0;">
                                Deteksi Objek Luka AI
                            </h4>
                            <div id="roboflow-status-box" style="padding:6px; border-radius:4px; font-weight:bold; text-align:center; background:var(--surface); border:1px solid var(--border-soft); color:var(--text-3); margin-bottom:6px;">
                                Menunggu Masukan Citra...
                            </div>
                            <div id="roboflow-predictions-list" style="display:flex; flex-direction:column; gap:4px; max-height:100px; overflow-y:auto;">
                                <div style="color:var(--text-3); text-align:center; font-style:italic; padding:10px 0;">Belum ada hasil pindai.</div>
                            </div>
                            <button class="btn btn-primary" onclick="runRoboflowAnalysis()" id="btn-run-roboflow" style="font-size:10.5px; height:28px; margin-top:8px; width:100%;" disabled>
                                🧠 Analisis Luka AI (Roboflow)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Gemini AI Clinical Summary -->
            <div class="gemini-summary-box" style="margin-bottom: 12px; padding: 14px; border-radius: 12px; background: rgba(14, 165, 233, 0.05); border: 1px solid rgba(14, 165, 233, 0.15);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(14, 165, 233, 0.1); padding-bottom: 8px;">
                    <span style="font-size: 11px; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px;">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
                        Rekomendasi Klinis &amp; Analisis AI
                    </span>
                    <span class="gemini-badge" style="font-size: 10px; font-weight: bold; background: #0ea5e9; color: #ffffff; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; position: static;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                        Ringkasan Gemini AI
                    </span>
                </div>
                <div class="gemini-content" style="font-size: 12.5px; line-height: 1.6; color: var(--text-1);">
                    ${parseMarkdownToHTML(record.gemini_summary)}
                </div>
            </div>

            <!-- Interactive AI Clinical Assistant -->
            <div class="glass-panel" style="padding: 16px; margin-bottom: 12px; border-color: var(--teal-border); background: rgba(13,148,136,0.02);">
                <h3 style="font-size: 11px; color: var(--teal); text-transform: uppercase; margin-bottom: 10px; display:flex; align-items:center; gap:6px; font-weight:700;">
                    💬 Konsultasi Asisten Medis AI (Gemini)
                </h3>
                <div id="ai-chat-messages" style="display:flex; flex-direction:column; gap:8px; max-height:160px; overflow-y:auto; padding:10px; background:var(--bg); border-radius:8px; border:1px solid var(--border); margin-bottom:10px;">
                    <div style="font-size:11px; color:var(--text-2); text-align:center; padding:6px;">
                        Tanyakan kondisi pasien atau klik mic untuk mendiktekan keluhan SOAP Mbah <strong>${record.name}</strong>.
                    </div>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <button id="ai-mic-btn" class="btn btn-outline" onclick="startVoiceDictation()" style="flex:none; padding:0; margin:0; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; border-color:var(--border);" title="Mulai dikte suara nakes">
                        🎙️
                    </button>
                    <input type="text" id="ai-chat-input" class="sim-input" placeholder="Tanyakan saran klinis atau ucapkan keluhan..." style="flex:1; height:32px;" onkeydown="if(event.key==='Enter')sendAIChatMessage()">
                    <button class="btn btn-primary" onclick="sendAIChatMessage()" style="flex:none; width:auto; padding:0 12px; margin:0; height:32px; line-height:32px;">
                        Kirim
                    </button>
                </div>
                <div id="ai-chat-status" style="font-size:9.5px; color:var(--text-3); margin-top:4px; display:none; padding-left:4px;"></div>
            </div>
            
            <!-- Nakes Action Buttons -->
            <div class="nakes-actions">
                <button class="btn btn-outline" onclick="populateWaModal(); openWaModal()">
                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 9.75a.625.625 0 1 1-1.25 0 .625.625 0 0 1 1.25 0zm0 0H12v.008H8.625V9.75zm0-2.25a.625.625 0 1 1-1.25 0 .625.625 0 0 1 1.25 0zm0 0H15v.008H8.625V7.5zm0-2.25a.625.625 0 1 1-1.25 0 .625.625 0 0 1 1.25 0zm0 0H12v.008H8.625V5.25zM12 21a9.003 9.003 0 0 0 8.354-5.646 9.003 9.003 0 0 0-8.354.346 9.003 9.003 0 0 0-8.354-.346A9.003 9.003 0 0 0 12 21z" /></svg>
                    Kirim Notifikasi Keluarga
                </button>
                <button class="btn btn-primary" onclick="populateReferralModal(); openReferralModal()">
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
                    Suhu: ${r.body_temp.toFixed(1)}°C
                </span>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="patient-priority-badge ${r.priority_status}" style="font-size:9px; padding:1px 4px; margin:0;">${r.priority_status}</span>
                    <button class="btn btn-outline" style="padding: 2px 6px; font-size: 9px; line-height: 1; min-height: unset; margin: 0; display: inline-flex; align-items: center; width: auto; height: auto; font-weight:bold; border-color:var(--teal-border); color:var(--teal);" onclick="enterCompareMode(${currentRecord.id}, ${r.id})">
                        ⚖️ Bandingkan
                    </button>
                </div>
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
    
    const W = canvas.width;
    const H = canvas.height;
    
    // Create ImageData for destination size (upscaled bilinear interpolation)
    const imgData = ctx.createImageData(W, H);
    
    const srcW = 32;
    const srcH = 24;
    
    for (let y = 0; y < H; y++) {
        const srcY = y * (srcH - 1) / (H - 1);
        const y1 = Math.floor(srcY);
        const y2 = Math.min(y1 + 1, srcH - 1);
        const ty = srcY - y1;
        
        for (let x = 0; x < W; x++) {
            const srcX = x * (srcW - 1) / (W - 1);
            const x1 = Math.floor(srcX);
            const x2 = Math.min(x1 + 1, srcW - 1);
            const tx = srcX - x1;
            
            // Bilinear interpolation math
            const c00 = grid[y1][x1];
            const c10 = grid[y1][x2];
            const c01 = grid[y2][x1];
            const c11 = grid[y2][x2];
            
            const top = c00 * (1 - tx) + c10 * tx;
            const bottom = c01 * (1 - tx) + c11 * tx;
            const val = top * (1 - ty) + bottom * ty;
            
            // Map interpolated value to HSL/Jet colormap
            const color = getColormapColor(val);
            const idx = (y * W + x) * 4;
            imgData.data[idx]     = color.r;
            imgData.data[idx + 1] = color.g;
            imgData.data[idx + 2] = color.b;
            imgData.data[idx + 3] = 255;
        }
    }
    
    // Draw the smooth thermal map
    ctx.putImageData(imgData, 0, 0);
    
    // Scan for critical hotspots (> 2.2C asymmetry) and draw warning indicator rings
    const analysis = analyzeThermalData(grid);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    
    if (analysis.asymmetry.toes > 2.2) {
        if (analysis.hotspots.left.includes("toes")) {
            ctx.strokeStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(W * 8 / 32, H * 4 / 24, 25, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText("RADANG KIRI", W * 8 / 32 - 30, H * 4 / 24 - 32);
        }
        if (analysis.hotspots.right.includes("toes")) {
            ctx.strokeStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(W * 23 / 32, H * 4 / 24, 25, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText("RADANG KANAN", W * 23 / 32 - 38, H * 4 / 24 - 32);
        }
    }
    
    if (analysis.asymmetry.midfoot > 2.2) {
        if (analysis.hotspots.left.includes("midfoot")) {
            ctx.strokeStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(W * 8 / 32, H * 12 / 24, 25, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText("RADANG KIRI", W * 8 / 32 - 30, H * 12 / 24 - 32);
        }
        if (analysis.hotspots.right.includes("midfoot")) {
            ctx.strokeStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(W * 23 / 32, H * 12 / 24, 25, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText("RADANG KANAN", W * 23 / 32 - 38, H * 12 / 24 - 32);
        }
    }
    
    if (analysis.asymmetry.heel > 2.2) {
        if (analysis.hotspots.left.includes("heel")) {
            ctx.strokeStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(W * 8 / 32, H * 19 / 24, 25, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText("RADANG KIRI", W * 8 / 32 - 30, H * 19 / 24 - 32);
        }
        if (analysis.hotspots.right.includes("heel")) {
            ctx.strokeStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(W * 23 / 32, H * 19 / 24, 25, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = '#ef4444';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText("RADANG KANAN", W * 23 / 32 - 38, H * 19 / 24 - 32);
        }
    }
    
    // Draw dashed region dividers
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.moveTo(0, H / 3);
    ctx.lineTo(W, H / 3);
    ctx.moveTo(0, (H * 2) / 3);
    ctx.lineTo(W, (H * 2) / 3);
    ctx.stroke();
    
    // Draw text overlays with text shadow
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.setLineDash([]);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 4;
    ctx.textAlign = 'left';
    ctx.fillText('KIRI (L)', 15, 20);
    ctx.textAlign = 'right';
    ctx.fillText('KANAN (R)', W - 15, 20);
    
    // Reset shadow parameters for subsequent drawing
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
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
function getOfflineSummary(patient, body_temp, thermal_analysis) {
    const name = patient.name || "Pasien";
    const age = patient.age || 0;
    const gender = patient.gender || "L/P";
    const history = patient.medical_history || "Tidak ada";
    
    let vitals_notes = [];
    if (body_temp > 37.5) vitals_notes.push(`suhu tubuh ${body_temp}°C (demam/febris)`);
    else if (body_temp < 35.5) vitals_notes.push(`suhu tubuh ${body_temp}°C (hipotermia ringan)`);
    else vitals_notes.push(`suhu tubuh ${body_temp}°C (normal)`);

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
    
    if (body_temp > 37.5) recommendations.push("Sarankan kompres hangat dan pantau terus suhu badan.");
    
    if (recommendations.length === 0) {
        recommendations.push("Kondisi umum stabil. Lanjutkan kontrol rutin bulanan di SehatDesa Station Balai Desa.");
    }
    
    return vitals_summary + " " + foot_notes + " Rekomendasi Klinis: " + recommendations.join(" ");
}

// Direct Gemini API REST client
async function generateMedicalSummary(patient, body_temp, thermal_analysis) {
    const apiKey = localStorage.getItem("GEMINI_API_KEY");
    if (!apiKey) {
        return getOfflineSummary(patient, body_temp, thermal_analysis);
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
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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
    return getOfflineSummary(patient, body_temp, thermal_analysis);
}

// Simulator triggers (client-side execution)
async function triggerSimQR() {
    const select = document.getElementById('sim-patient-select');
    const qrCode = select.value;
    if (!qrCode) {
        alert("Harap pilih kartu QR pasien terlebih dahulu!");
        return;
    }
    
    let patient = null;
    if (qrCode.startsWith('SEHATDESA:')) {
        const id = qrCode.replace('SEHATDESA:', '');
        const p = await precheckGet(`peserta/${id}`);
        if (p) {
            patient = {
                id: id,
                name: p.nama,
                age: p.tgl_lahir ? calculateAge(p.tgl_lahir) : 0,
                gender: p.jenis_kelamin,
                qr_code: qrCode,
                phone: p.no_hp,
                address: p.alamat,
                medical_history: p.keluhan || 'Tidak ada riwayat',
                created_at: p.terdaftar_at
            };
        }
    } else {
        const patientsObj = await firebaseGet("patients") || {};
        for (let p of Object.values(patientsObj)) {
            if (p.qr_code === qrCode) {
                patient = p;
                break;
            }
        }
    }
    
    if (!patient) {
        alert(`QR Code ${qrCode} tidak terdaftar!`);
        return;
    }
    
    if (patient.status && patient.status === 'PENDING') {
        speak("Maaf, pendaftaran Anda belum disetujui oleh Bidan Desa. Silakan hubungi petugas untuk verifikasi.");
        alert("Pemeriksaan Ditolak: Kartu QR ini belum disetujui (PENDING) oleh Bidan Desa!");
        triggerReset();
        return;
    }
    
    boothSession.state = "PATIENT_IDENTIFIED";
    boothSession.currentPatient = patient;
    boothSession.bodyTemp = null;
    boothSession.thermalGrid = null;
    boothSession.thermalAnalysis = null;
    boothSession.geminiSummary = null;
    boothSession.priorityStatus = "NORMAL";
    
    broadcastStateUpdate();
}

async function triggerSimVitals() {
    if (boothSession.state !== "PATIENT_IDENTIFIED") {
        alert("Harap scan kartu QR pasien terlebih dahulu!");
        return;
    }
    
    const temp = parseFloat(document.getElementById('sim-temp').value);
    
    boothSession.bodyTemp = temp;
    boothSession.state = "READING_THERMAL";
    
    broadcastStateUpdate();
}

async function triggerSimThermal() {
    if (boothSession.state !== "READING_THERMAL") {
        alert("Harap selesaikan pemindaian vital sign terlebih dahulu!");
        return;
    }
    
    boothSession.state = "PROCESSING";
    broadcastStateUpdate();
    
    const activeChip = document.querySelector('.preset-chip[data-case].active');
    const caseType = activeChip ? activeChip.getAttribute('data-case') : 'normal';
    
    // Simulate grid local creation
    const grid = generateMockThermalGrid(caseType);
    boothSession.thermalGrid = grid;
    
    const analysis = analyzeThermalData(grid);
    boothSession.thermalAnalysis = analysis;
    boothSession.priorityStatus = analysis.priority_status;
    
    // Overall Priority status check
    let vitalsPriority = "NORMAL";
    if (boothSession.bodyTemp > 38.5) {
        vitalsPriority = "CRITICAL";
    } else if (boothSession.bodyTemp > 37.5) {
        vitalsPriority = "WARNING";
    }
    
    const priorityOrder = { "NORMAL": 0, "WARNING": 1, "CRITICAL": 2 };
    if (priorityOrder[vitalsPriority] > priorityOrder[boothSession.priorityStatus]) {
        boothSession.priorityStatus = vitalsPriority;
        boothSession.thermalAnalysis.priority_status = vitalsPriority;
    }
    
    // AI Summary
    const summary = await generateMedicalSummary(
        boothSession.currentPatient,
        boothSession.bodyTemp,
        boothSession.thermalAnalysis
    );
    boothSession.geminiSummary = summary;
    
    // Save to Firebase RTDB
    const recordsObj = await firebaseGet("records") || {};
    const validKeys = Object.keys(recordsObj).map(Number).filter(k => !isNaN(k) && k > 0);
    const nextId = validKeys.length > 0 ? Math.max(...validKeys) + 1 : 1;
    
    const newRecord = {
        id: nextId,
        patient_id: boothSession.currentPatient.id,
        body_temp: boothSession.bodyTemp,
        thermal_grid: JSON.stringify(boothSession.thermalGrid),
        thermal_analysis: JSON.stringify(boothSession.thermalAnalysis),
        gemini_summary: boothSession.geminiSummary,
        priority_status: boothSession.priorityStatus,
        created_at: new Date().toISOString()
    };
    
    await firebasePut(`records/${nextId}`, newRecord);
    
    boothSession.state = "COMPLETED";
    broadcastStateUpdate(newRecord);
    
    playNotificationSound();
    loadRecords();
}

function triggerReset() {
    boothSession.state = "IDLE";
    boothSession.currentPatient = null;
    boothSession.bodyTemp = null;
    boothSession.thermalGrid = null;
    boothSession.thermalAnalysis = null;
    boothSession.geminiSummary = null;
    boothSession.priorityStatus = "NORMAL";
    
    broadcastStateUpdate();
}

function broadcastStateUpdate(record = null) {
    handleStateUpdate(
        boothSession.state, 
        boothSession.currentPatient, 
        boothSession.bodyTemp ? { body_temp: boothSession.bodyTemp } : null, 
        boothSession.thermalGrid, 
        record
    );
    
    // Keep Firebase in sync (Support both booth_session and kiosk_session for backward compatibility)
    const sessionData = {
        state: boothSession.state,
        patient: boothSession.currentPatient,
        vitals: boothSession.bodyTemp ? { body_temp: boothSession.bodyTemp } : null,
        thermalGrid: boothSession.thermalGrid
    };
    firebasePut("booth_session", sessionData);
    firebasePut("kiosk_session", sessionData);
}

function sanitizeThermalGrid(rawGrid) {
    if (!rawGrid) return generateMockThermalGrid("normal");
    
    let parsed = rawGrid;
    if (typeof rawGrid === 'string') {
        try {
            parsed = JSON.parse(rawGrid);
        } catch (e) {
            console.error("Error parsing thermal grid JSON:", e);
            return generateMockThermalGrid("normal");
        }
    }
    
    // Check if it is a 2D array of 24x32
    if (Array.isArray(parsed) && parsed.length === 24 && Array.isArray(parsed[0]) && parsed[0].length === 32) {
        return parsed;
    }
    
    // If it's a 1D array of 768 elements (24 * 32 = 768), reshape it!
    if (Array.isArray(parsed) && parsed.length === 768) {
        let grid = [];
        for (let r = 0; r < 24; r++) {
            grid.push(parsed.slice(r * 32, (r + 1) * 32));
        }
        return grid;
    }
    
    return generateMockThermalGrid("normal");
}

async function processFirebaseSessionData(session) {
    if (window.isProcessingSession) return;
    window.isProcessingSession = true;
    
    try {
        console.log("Automatic Firebase Session Processor Triggered:", session);
        const patient = session.patient;
        if (!patient) {
            console.warn("No patient identified in session, aborting processing.");
            window.isProcessingSession = false;
            return;
        }
        
        let body_temp = 36.5;
        if (session.vitals) {
            body_temp = session.vitals.body_temp || session.vitals.suhu_tubuh || 36.5;
        }
        
        const grid = sanitizeThermalGrid(session.thermalGrid);
        const analysis = analyzeThermalData(grid);
        
        let priority = analysis.priority_status || "NORMAL";
        if (body_temp > 38.5) {
            priority = "CRITICAL";
        } else if (body_temp > 37.5) {
            priority = "WARNING";
        }
        analysis.priority_status = priority;
        
        const summary = await generateMedicalSummary(patient, body_temp, analysis);
        
        const recordsObj = await firebaseGet("records") || {};
        const validKeys = Object.keys(recordsObj).map(Number).filter(k => !isNaN(k) && k > 0);
        const nextId = validKeys.length > 0 ? Math.max(...validKeys) + 1 : 1;
        
        const newRecord = {
            id: nextId,
            patient_id: patient.id,
            name: patient.name,
            age: patient.age,
            gender: patient.gender,
            phone: patient.phone || '',
            qr_code: patient.qr_code || '',
            address: patient.address || 'Alamat tinggal -',
            medical_history: patient.medical_history || 'Tidak ada riwayat',
            body_temp: body_temp,
            thermal_grid: JSON.stringify(grid),
            thermal_analysis: JSON.stringify(analysis),
            gemini_summary: summary,
            priority_status: priority,
            created_at: new Date().toISOString()
        };
        
        await firebasePut(`records/${nextId}`, newRecord);
        
        const completedSession = {
            state: "COMPLETED",
            patient: patient,
            vitals: { body_temp: body_temp },
            thermalGrid: grid
        };
        await firebasePut("booth_session", completedSession);
        await firebasePut("kiosk_session", completedSession);
        
        console.log("Automatic Session Processing Completed successfully.");
    } catch (e) {
        console.error("Error in processFirebaseSessionData:", e);
    } finally {
        window.isProcessingSession = false;
    }
}

// Multi-Tab polling sync
async function pollBoothSession() {
    const session = await firebaseGet("booth_session") || await firebaseGet("kiosk_session");
    
    // Dynamically update Warga portal booth availability status badge
    const wargaBadge = document.getElementById('warga-booth-status');
    if (wargaBadge && session) {
        if (session.state === "IDLE" || session.state === "COMPLETED") {
            wargaBadge.innerHTML = `<span class="status-dot green" style="width:6px; height:6px; background:#16a34a; border-radius:50%; display:inline-block;"></span> TERSEDIA`;
            wargaBadge.style.cssText = "display:flex; align-items:center; gap:6px; background:#f0fdf4; border:1px solid #bbf7d0; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:700; color:#16a34a;";
        } else {
            wargaBadge.innerHTML = `<span class="status-dot warning" style="width:6px; height:6px; background:#d97706; border-radius:50%; display:inline-block; animation: pulse 2s infinite;"></span> DIGUNAKAN`;
            wargaBadge.style.cssText = "display:flex; align-items:center; gap:6px; background:#fffbeb; border:1px solid #fef3c7; padding:4px 10px; border-radius:12px; font-size:10px; font-weight:700; color:#d97706;";
        }
    }
    
    if (session && session.state !== boothSession.state) {
        boothSession.state = session.state;
        boothSession.currentPatient = session.patient;
        boothSession.bodyTemp = session.vitals ? session.vitals.body_temp : null;
        boothSession.thermalGrid = session.thermalGrid;
        
        // Fetch new completed record details if applicable
        let record = null;
        if (session.state === "COMPLETED") {
            const recordsObj = await firebaseGet("records") || {};
            const records = Object.values(recordsObj).filter(r => r && r.created_at);
            if (records.length > 0) {
                records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                const rawRec = records[0];
                
                // Populate patient details to prevent undefined display
                const patientsObj = await firebaseGet("patients") || {};
                const pesertaObj = await precheckGet("peserta") || {};
                let patient = patientsObj[rawRec.patient_id];
                if (!patient && pesertaObj[rawRec.patient_id]) {
                    const p = pesertaObj[rawRec.patient_id];
                    patient = {
                        id: rawRec.patient_id,
                        name: p.nama,
                        age: p.tgl_lahir ? calculateAge(p.tgl_lahir) : 0,
                        gender: p.jenis_kelamin,
                        qr_code: 'SEHATDESA:' + rawRec.patient_id,
                        phone: p.no_hp,
                        address: p.alamat,
                        medical_history: p.keluhan
                    };
                }
                if (!patient) patient = {};
                
                record = {
                    ...rawRec,
                    name: rawRec.name || patient.name || "Unknown",
                    age: rawRec.age || patient.age || 0,
                    gender: rawRec.gender || patient.gender || "-",
                    qr_code: rawRec.qr_code || patient.qr_code || "-",
                    phone: rawRec.phone || patient.phone || "",
                    address: rawRec.address || patient.address || "",
                    medical_history: rawRec.medical_history || patient.medical_history || ""
                };
            }
        }
        
        handleStateUpdate(
            boothSession.state,
            boothSession.currentPatient,
            session.vitals,
            boothSession.thermalGrid,
            record
        );
        
        if (session.state === "COMPLETED") {
            playNotificationSound();
            loadRecords();
        }
        
        if (session.state === "PROCESSING") {
            processFirebaseSessionData(session);
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
        
        const newPatient = {
            id: qr_code,
            name,
            age,
            gender,
            qr_code,
            phone,
            address,
            medical_history,
            status: "APPROVED",
            created_at: new Date().toISOString()
        };
        
        await firebasePut(`patients/${qr_code}`, newPatient);
        
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
                <h4>Booth Kesehatan Mandiri Desa</h4>
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
                <h4>Booth Kesehatan Mandiri Desa</h4>
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
    
    const tempSlider = document.getElementById('sim-temp');
    
    switch (type) {
        case 'normal':
            tempSlider.value = 36.4;
            break;
        case 'fever':
            tempSlider.value = 38.2;
            break;
    }
    
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
    
    const tempSlider = document.getElementById('sim-temp');
    tempSlider.value = 36.6;
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

    // Update tab buttons active state
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-tab-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Update page title
    const titleText = {
        'dashboard': 'Dashboard Medis Balai Desa',
        'symptoms': 'Symptoms AI Assistant',
        'diagnosis': 'Pusat Diagnosis & Booth Scanner',
        'appointments': 'Jadwal & Antrean Kunjungan',
        'patients': 'Database Rekam Medis Warga'
    };
    const pageTitle = document.getElementById('current-page-title');
    if (pageTitle && titleText[tabName]) {
        pageTitle.textContent = titleText[tabName];
    }

    const mainWorkspace = document.getElementById('main-admin-workspace');
    const leftSide = document.getElementById('split-left-side');

    // Toggle panels visibility
    const panels = {
        'dashboard': document.getElementById('nakes-dashboard-panel'),
        'symptoms': document.getElementById('symptoms-ai-panel'),
        'appointments': document.getElementById('precheck-view-panel'),
        'patients': document.getElementById('patients-view-panel')
    };

    // Dashboard tab takes full width; Diagnosis scanner tab shows booth panel at full width
    if (tabName === 'dashboard') {
        if (mainWorkspace) mainWorkspace.classList.remove('split-layout');
        if (leftSide) leftSide.style.setProperty('display', 'none', 'important');
    } else if (tabName === 'diagnosis') {
        if (mainWorkspace) mainWorkspace.classList.remove('split-layout');
        if (leftSide) leftSide.style.setProperty('display', 'flex', 'important');
    } else {
        if (mainWorkspace) mainWorkspace.classList.remove('split-layout');
        if (leftSide) leftSide.style.setProperty('display', 'none', 'important');
    }

    Object.keys(panels).forEach(key => {
        const panel = panels[key];
        if (panel) {
            if (key === tabName) {
                panel.style.setProperty('display', 'flex', 'important');
            } else {
                panel.style.setProperty('display', 'none', 'important');
            }
        }
    });

    // Load corresponding data
    if (tabName === 'patients') {
        loadPatientsListTable();
    } else if (tabName === 'appointments') {
        loadPesertaList();
        populateExistingWargaDropdown();
    } else if (tabName === 'dashboard' || tabName === 'symptoms') {
        loadRecords();
        loadPatients();
    } else if (tabName === 'diagnosis') {
        loadPatients();
    }
}

// Load citizen directory database table
async function loadPatientsListTable() {
    const tbody = document.getElementById('patients-list-tbody');
    const countText = document.getElementById('patients-count');
    const loading = document.getElementById('patients-loading-indicator');
    const empty = document.getElementById('patients-empty-indicator');
    const tableContainer = document.getElementById('patients-table-container');

    if (loading) loading.style.display = 'block';
    if (empty) empty.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'none';

    try {
        const patientsObj = await firebaseGet("patients") || {};
        const patients = Object.values(patientsObj).filter(Boolean).reverse();

        if (countText) countText.textContent = `Total Warga: ${patients.length}`;

        if (tbody) {
            tbody.innerHTML = '';
            patients.forEach((p, idx) => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border-soft)';
                
                const qrText = p.qr_code || '-';
                const status = p.status || 'APPROVED';
                const statusBadge = status === 'APPROVED'
                    ? '<span class="verify-badge approved">Terverifikasi</span>'
                    : '<span class="verify-badge pending">Pending</span>';
                
                let approveBtn = '';
                if (status === 'PENDING') {
                    approveBtn = `
                        <button class="btn btn-primary" style="padding:4px 8px; font-size:10px; min-height:unset; margin:0; background:var(--green); border-color:var(--green);" onclick="approvePatient('${p.id}')">
                            ✓ ACC
                        </button>
                    `;
                }
                
                tr.innerHTML = `
                    <td style="padding:10px 8px; font-weight:bold;">${idx + 1}</td>
                    <td style="padding:10px 8px; font-weight:600; color:var(--text-1);">${p.name || '-'}</td>
                    <td style="padding:10px 8px;">${p.age || '-'} th / ${p.gender || '-'}</td>
                    <td style="padding:10px 8px; font-family:monospace; font-size:11px; font-weight:bold; color:var(--teal);">${qrText}</td>
                    <td style="padding:10px 8px;">${statusBadge}</td>
                    <td style="padding:10px 8px; color:var(--text-2); font-size:11px;">${p.phone || '-'}</td>
                    <td style="padding:10px 8px; color:var(--text-2); font-size:11px;">${p.address || '-'}</td>
                    <td style="padding:10px 8px; color:var(--text-2); font-size:11px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${p.medical_history || ''}">${p.medical_history || '-'}</td>
                    <td style="padding:10px 8px; text-align:center; display:flex; gap:6px; justify-content:center;">
                        ${approveBtn}
                        <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; min-height:unset; margin:0;" onclick="showQRModal('${qrText}', '${(p.name || '').replace(/'/g, "\\'")}')">
                            🔍 QR
                        </button>
                        <button class="btn btn-outline" style="padding:4px 8px; font-size:10px; min-height:unset; color:var(--red); border-color:var(--red-border); margin:0;" onclick="deletePatient('${p.id}')">
                            ❌ Hapus
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        if (loading) loading.style.display = 'none';
        if (patients.length === 0) {
            if (empty) empty.style.display = 'block';
        } else {
            if (tableContainer) tableContainer.style.display = 'block';
        }
    } catch (e) {
        console.error("Failed to load patient database table:", e);
        if (loading) {
            loading.style.display = 'none';
            loading.innerHTML = `<span style="color:var(--red);">Gagal memuat: ${e.message}</span>`;
        }
    }
}

async function deletePatient(id) {
    if (!confirm("Apakah Anda yakin ingin menghapus data warga ini?")) return;
    try {
        await fetch(`${FIREBASE_URL}/patients/${id}.json`, { method: "DELETE" });
        alert("Data warga berhasil dihapus.");
        loadPatientsListTable();
        loadPatients(); // update simulation options
    } catch (e) {
        console.error(e);
        alert("Gagal menghapus data warga: " + e.message);
    }
}

function filterPatientsTable() {
    const query = document.getElementById('patients-search-input').value.toLowerCase();
    const rows = document.querySelectorAll('#patients-list-tbody tr');
    
    rows.forEach(row => {
        const nameCell = row.cells[1];
        const qrCell = row.cells[3];
        if (nameCell && qrCell) {
            const name = nameCell.textContent.toLowerCase();
            const qr = qrCell.textContent.toLowerCase();
            if (name.includes(query) || qr.includes(query)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    });
}

// Patient Registration Modal Functions
function openRegistrationModal() {
    // Generate new unique QR Code ID with 5 digits
    const regQrInput = document.querySelector('#patients-reg-modal #reg-qr');
    if (regQrInput) {
        regQrInput.value = 'PAS-' + String(Math.floor(10000 + Math.random() * 90000));
    }
    document.getElementById('register-patient-form-modal').style.display = 'flex';
    document.getElementById('register-success-qr').style.display = 'none';
    document.getElementById('patients-reg-modal').style.display = 'flex';
}

function closeRegistrationModal() {
    document.getElementById('patients-reg-modal').style.display = 'none';
    document.getElementById('register-patient-form-modal').reset();
}

async function handleModalRegisterSubmit(e) {
    e.preventDefault();
    const name = document.querySelector('#patients-reg-modal #reg-name').value;
    const age = parseInt(document.querySelector('#patients-reg-modal #reg-age').value);
    const gender = document.querySelector('#patients-reg-modal #reg-gender').value;
    const qr_code = document.querySelector('#patients-reg-modal #reg-qr').value;
    const phone = document.querySelector('#patients-reg-modal #reg-phone').value;
    const address = document.querySelector('#patients-reg-modal #reg-address').value;
    const medical_history = document.querySelector('#patients-reg-modal #reg-history').value;
    
    try {
        const patientsObj = await firebaseGet("patients") || {};
        const patients = Object.values(patientsObj).filter(Boolean);
        
        for (let p of patients) {
            if (p.qr_code === qr_code) {
                alert(`Pendaftaran gagal: Kode QR ${qr_code} sudah terdaftar!`);
                return;
            }
        }
        
        const newPatient = {
            id: qr_code,
            name,
            age,
            gender,
            qr_code,
            phone,
            address,
            medical_history,
            status: "APPROVED",
            created_at: new Date().toISOString()
        };
        
        await firebasePut(`patients/${qr_code}`, newPatient);
        
        // Hide form, show success QR view
        document.getElementById('register-patient-form-modal').style.display = 'none';
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
        
        loadPatientsListTable();
        loadPatients(); // update simulation options
    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan koneksi.');
    }
}

// ═══ Pre-Check (Pendataan Warga & Antrean) Firebase Logic ══════════════
const PRECHECK_FB_AUTH = "JfNq9H4mZwrnRMbOFu94ClHKlPRFeOxdFiTjttWS";

async function precheckGet(path) {
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json?auth=${PRECHECK_FB_AUTH}`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Firebase Precheck read error at ${path}:`, e);
        return null;
    }
}

async function precheckPost(path, data) {
    if (!window.navigator.onLine) {
        const tempKey = 'OFFLINE_' + String(Math.floor(10000 + Math.random() * 90000));
        offlineQueue.push({ method: 'POST', path: path, data: data, tempKey: tempKey, timestamp: new Date().toISOString() });
        localStorage.setItem("SAYANGI_OFFLINE_QUEUE", JSON.stringify(offlineQueue));
        updateOfflineSyncStatus();
        console.log(`Saved offline (POST) to: ${path}`);
        return { name: tempKey };
    }
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json?auth=${PRECHECK_FB_AUTH}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Firebase Precheck post error at ${path}:`, e);
        return null;
    }
}

async function precheckPatch(path, data) {
    if (!window.navigator.onLine) {
        console.log(`Offline-first precheck patch intercepted.`);
        return data;
    }
    try {
        const res = await fetch(`${FIREBASE_URL}/${path}.json?auth=${PRECHECK_FB_AUTH}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return await res.json();
    } catch (e) {
        console.error(`Firebase Precheck patch error at ${path}:`, e);
        return null;
    }
}

async function checkPrecheckConnection() {
    try {
        const res = await fetch(`${FIREBASE_URL}/patients.json?shallow=true`);
        if (!res.ok) throw new Error("Network response was not ok");
        const dot = document.getElementById('precheck-db-dot');
        const text = document.getElementById('precheck-db-text');
        if (dot && text) {
            dot.className = "status-dot";
            text.textContent = "Cloud Terhubung";
        }
        
        const wDot = document.getElementById('warga-conn-status');
        if (wDot) {
            wDot.innerHTML = '<span class="status-dot"></span> Cloud Terhubung';
        }
    } catch (e) {
        const dot = document.getElementById('precheck-db-dot');
        const text = document.getElementById('precheck-db-text');
        if (dot && text) {
            dot.className = "status-dot disconnected";
            text.textContent = "Cloud Offline";
        }
        const wDot = document.getElementById('warga-conn-status');
        if (wDot) {
            wDot.innerHTML = '<span class="status-dot disconnected"></span> Cloud Offline';
        }
    }
}

async function populateExistingWargaDropdown() {
    const select = document.getElementById('pre-select-existing');
    if (!select) return;
    try {
        const patientsObj = await firebaseGet("patients") || {};
        const patients = Object.values(patientsObj).filter(Boolean);
        
        // Clear previous options except first
        select.innerHTML = '<option value="">-- Pilih Warga (Ketik langsung di bawah jika belum terdaftar) --</option>';
        
        patients.forEach(p => {
            const opt = document.createElement('option');
            opt.value = encodeURIComponent(JSON.stringify(p));
            opt.textContent = `${p.name} (${p.age} th / ${p.gender}) - ${p.qr_code || ''}`;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error("Failed to populate existing warga dropdown:", e);
    }
}

function autofillPrecheckForm() {
    const select = document.getElementById('pre-select-existing');
    if (!select) return;
    const val = select.value;
    if (!val) {
        // Clear form
        document.getElementById('pre-nama').value = '';
        document.getElementById('pre-nik').value = '';
        document.getElementById('pre-tgl-lahir').value = '';
        document.getElementById('pre-jk').value = '';
        document.getElementById('pre-hp').value = '';
        document.getElementById('pre-alamat').value = '';
        return;
    }
    
    try {
        const patient = JSON.parse(decodeURIComponent(val));
        document.getElementById('pre-nama').value = patient.name || '';
        document.getElementById('pre-nik').value = patient.qr_code || '';
        
        // Calculate a birth date based on age
        const birthYear = new Date().getFullYear() - (patient.age || 60);
        document.getElementById('pre-tgl-lahir').value = `${birthYear}-01-01`;
        
        document.getElementById('pre-jk').value = patient.gender || '';
        document.getElementById('pre-hp').value = patient.phone || '';
        document.getElementById('pre-alamat').value = patient.address || '';
    } catch(e) {
        console.error("Autofill error:", e);
    }
}

let lastPrecheckKey = null;
let lastPrecheckName = null;

async function handlePrecheckRegister(e) {
    e.preventDefault();
    const btn = document.getElementById('pre-submit-btn');
    const txt = document.getElementById('pre-submit-text');
    if (btn && txt) {
        btn.disabled = true;
        txt.innerHTML = '<span class="status-dot processing"></span> Mendaftarkan...';
    }

    const nama = document.getElementById('pre-nama').value.trim();
    const nik = document.getElementById('pre-nik').value.trim();
    const tgl_lahir = document.getElementById('pre-tgl-lahir').value;
    const jenis_kelamin = document.getElementById('pre-jk').value;
    const no_hp = document.getElementById('pre-hp').value.trim();
    const alamat = document.getElementById('pre-alamat').value.trim();
    const keluhan = document.getElementById('pre-keluhan').value.trim();

    const data = {
        nama,
        nik,
        tgl_lahir,
        jenis_kelamin,
        no_hp,
        alamat,
        keluhan,
        terdaftar_at: new Date().toISOString(),
        scan_count: 0
    };

    try {
        const res = await precheckPost('peserta', data);
        if (res && res.name) {
            const key = res.name;
            lastPrecheckKey = key;
            lastPrecheckName = nama;

            await precheckPatch(`peserta/${key}`, { firebase_id: key });
            
            // Generate QR Code
            const qrRaw = 'SAYANGI:' + key;
            const qrCard = document.getElementById('precheck-qr-card');
            const qrContainer = document.getElementById('precheck-qrcode-container');
            
            if (qrCard && qrContainer) {
                qrContainer.innerHTML = '';
                new QRCode(qrContainer, {
                    text: qrRaw,
                    width: 140,
                    height: 140,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                
                document.getElementById('precheck-qr-name').textContent = nama;
                document.getElementById('precheck-qr-id').textContent = 'ID: ' + key;
                qrCard.style.display = 'flex';
            }
            
            alert('Pendaftaran antrean pemeriksaan berhasil!');
            loadPesertaList();
            loadPatients(); // update simulator select options
        }
    } catch (err) {
        console.error(err);
        alert('Gagal mendaftarkan peserta: ' + err.message);
    } finally {
        if (btn && txt) {
            btn.disabled = false;
            txt.textContent = '✨ Daftarkan & Buat QR';
        }
    }
}

function resetPrecheckForm() {
    document.getElementById('precheck-reg-form').reset();
    const qrCard = document.getElementById('precheck-qr-card');
    if (qrCard) qrCard.style.display = 'none';
}

function downloadPrecheckQR() {
    if (!lastPrecheckKey) return;
    const canvas = document.querySelector('#precheck-qrcode-container canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `QR_Precheck_${lastPrecheckName.replace(/\s+/g, '_')}_${lastPrecheckKey}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
}

function printPrecheckQR() {
    if (!lastPrecheckKey) return;
    const canvas = document.querySelector('#precheck-qrcode-container canvas');
    if (!canvas) return;
    const w = window.open('', '_blank');
    w.document.write(`
        <html>
        <head>
            <title>Cetak QR Code Antrean - Sayangi</title>
            <style>
                body { text-align: center; padding: 40px; font-family: sans-serif; }
                .card { display: inline-block; border: 2px dashed #0d9488; border-radius: 12px; padding: 20px; max-width: 260px; }
                h2 { margin: 0 0 4px 0; color: #0d9488; font-size: 18px; }
                .name { font-size: 16px; font-weight: bold; margin-top: 12px; }
                .qr-val { font-family: monospace; font-size: 11px; color: #4b5563; margin-top: 4px; }
            </style>
        </head>
        <body onload="window.print()">
            <div class="card">
                <h2>SAYANGI PRE-CHECK</h2>
                <img src="${canvas.toDataURL('image/png')}" style="width:150px; height:150px;">
                <div class="name">${lastPrecheckName}</div>
                <div class="qr-val">SAYANGI:${lastPrecheckKey}</div>
            </div>
        </body>
        </html>
    `);
    w.document.close();
}

async function loadPesertaList() {
    const loading = document.getElementById('pre-loading-indicator');
    const empty = document.getElementById('pre-empty-indicator');
    const tableContainer = document.getElementById('pre-table-container');
    const tbody = document.getElementById('pre-queue-tbody');
    const countText = document.getElementById('pre-queue-count');

    if (loading) loading.style.display = 'block';
    if (empty) empty.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'none';

    try {
        const data = await precheckGet('peserta');
        checkPrecheckConnection();
        if (!data) {
            if (loading) loading.style.display = 'none';
            if (empty) empty.style.display = 'block';
            if (countText) countText.textContent = "Total: 0";
            return;
        }

        const entries = Object.entries(data).reverse();
        if (countText) countText.textContent = `Total: ${entries.length}`;

        if (tbody) {
            tbody.innerHTML = '';
            entries.forEach(([key, p], i) => {
                const index = entries.length - i;
                const name = p.nama || '-';
                const nik = p.nik || '-';
                const age = p.tgl_lahir ? calculateAge(p.tgl_lahir) : '-';
                const jk = p.jenis_kelamin || '-';
                const hp = p.no_hp || '-';
                const alamat = p.alamat || '-';
                const keluhan = p.keluhan || '-';
                const scanCount = p.scan_count || 0;
                
                const scanBadge = scanCount > 0 ? 
                    `<span class="patient-priority-badge NORMAL" style="background:rgba(16,185,129,0.1); color:rgb(16,185,129); font-size:9px; padding:1px 5px; border-radius:10px; font-weight:bold;">${scanCount}x</span>` : 
                    `<span class="patient-priority-badge WARNING" style="background:var(--border-soft); color:var(--text-3); font-size:9px; padding:1px 5px; border-radius:10px; font-weight:bold;">Belum</span>`;

                const row = document.createElement('tr');
                row.style.borderBottom = '1px solid var(--border-soft)';
                row.innerHTML = `
                    <td style="padding:8px 4px; font-weight:bold;">${index}</td>
                    <td style="padding:8px 4px; font-weight:600; color:var(--text-1);">${name}</td>
                    <td style="padding:8px 4px; font-family:monospace; font-size:10px;">${nik}</td>
                    <td style="padding:8px 4px;">${age} th / ${jk}</td>
                    <td style="padding:8px 4px; color:var(--text-2); font-size:10px; line-height:1.2;">
                        <div>${hp}</div>
                        <div style="color:var(--text-3); font-size:9px;">${alamat}</div>
                    </td>
                    <td style="padding:8px 4px; color:var(--red); font-weight:500; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${keluhan}">${keluhan}</td>
                    <td style="padding:8px 4px;">${scanBadge}</td>
                    <td style="padding:8px 4px; text-align:center;">
                        <button class="btn btn-outline" style="padding:3px 8px; font-size:10px; line-height:1; min-height:unset; margin:0;" onclick="showQRModal('SAYANGI:${key}', '${(name || '').replace(/'/g, "\\'")}')">
                            🔍 QR
                        </button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }

        if (loading) loading.style.display = 'none';
        if (tableContainer) tableContainer.style.display = 'block';
    } catch (err) {
        console.error(err);
        if (loading) {
            loading.style.display = 'none';
            loading.innerHTML = `<span style="color:var(--red);">Gagal memuat: ${err.message}</span>`;
        }
    }
}

function calculateAge(dobStr) {
    if (!dobStr) return 0;
    const today = new Date();
    const birthDate = new Date(dobStr);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

async function handlePrecheckSearch() {
    let id = document.getElementById('pre-cari-id').value.trim();
    if (id.startsWith('SAYANGI:')) {
        id = id.replace('SAYANGI:', '');
    }
    if (!id) return;

    try {
        const p = await precheckGet(`peserta/${id}`);
        checkPrecheckConnection();
        if (!p) {
            alert('ID Peserta tidak ditemukan di Firebase.');
            return;
        }

        // Increment scan count
        const newCount = (p.scan_count || 0) + 1;
        await precheckPatch(`peserta/${id}`, {
            scan_count: newCount,
            last_scan_at: new Date().toISOString(),
            last_scan_source: 'web'
        });

        // Show search result card
        const resultDiv = document.getElementById('pre-search-result');
        const qrDiv = document.getElementById('pre-search-qrcode');
        
        document.getElementById('pre-search-name').textContent = p.nama || '-';
        document.getElementById('pre-search-nik').textContent = p.nik || '-';
        document.getElementById('pre-search-dob').textContent = `${p.tgl_lahir || '-'} (${p.tgl_lahir ? calculateAge(p.tgl_lahir) : '-'} th)`;
        document.getElementById('pre-search-gender').textContent = p.jenis_kelamin || '-';
        document.getElementById('pre-search-complaint').textContent = p.keluhan || '-';
        document.getElementById('pre-search-fbid').textContent = id;
        
        const scanBadge = document.getElementById('pre-search-scancount');
        scanBadge.textContent = `${newCount}x`;
        
        if (qrDiv) {
            qrDiv.innerHTML = '';
            new QRCode(qrDiv, {
                text: `SAYANGI:${id}`,
                width: 80,
                height: 80,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        }

        resultDiv.style.display = 'block';
        loadPesertaList();
    } catch (err) {
        console.error(err);
        alert('Terjadi kesalahan saat memverifikasi: ' + err.message);
    }
}



// Page Load Initializations
document.addEventListener('DOMContentLoaded', async () => {
    // Hardcode Gemini API Key as requested by User
    localStorage.setItem("GEMINI_API_KEY", "AQ.Ab8RN6Iegfy40f9c2d0Sb0POlsVPYSJmRNy8r5GIBb5sEvZacw");

    const ipInput = document.getElementById('cam-ip-input');
    if (ipInput) {
        ipInput.value = localStorage.getItem("ESP32_CAM_IP") || "";
        ipInput.addEventListener('change', (e) => {
            localStorage.setItem("ESP32_CAM_IP", e.target.value.trim());
        });
    }

    const roboInput = document.getElementById('roboflow-key-input');
    if (roboInput) {
        roboInput.value = localStorage.getItem("ROBOFLOW_API_KEY") || "";
        roboInput.addEventListener('change', (e) => {
            localStorage.setItem("ROBOFLOW_API_KEY", e.target.value.trim());
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
    
    const regForm = document.getElementById('register-patient-form-modal');
    if (regForm) {
        regForm.addEventListener('submit', handleModalRegisterSubmit);
    }

    const precheckRegForm = document.getElementById('precheck-reg-form');
    if (precheckRegForm) {
        precheckRegForm.addEventListener('submit', handlePrecheckRegister);
    }
    checkPrecheckConnection();
    
    // Initialize Database in Firebase & local cache
    await initDatabase();
    
    // Load initial views
    loadPatients();
    
    // Always start at welcome portal / landing page on reload
    exitToPortal();
    
    // Start polling sync
    setInterval(pollBoothSession, 2000);
    
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
    wireSlider('sim-temp', 'sim-temp-val', 1);

    // Initialize offline sync display
    updateOfflineSyncStatus();
    flushOfflineQueue();
});

// ═══ TELEHEALTH EXTENSIONS (AI Consultation, SOAP Dictation, Charting, Compare Mode, Offline Queue) ═══

let offlineQueue = [];
try {
    offlineQueue = JSON.parse(localStorage.getItem("SAYANGI_OFFLINE_QUEUE")) || [];
} catch(e) {
    offlineQueue = [];
}

function updateOfflineSyncStatus() {
    const statusText = document.getElementById('conn-status');
    if (!statusText) return;
    
    if (!window.navigator.onLine) {
        statusText.innerHTML = `<span class="status-dot disconnected"></span> Offline (${offlineQueue.length} data antre)`;
    } else {
        if (offlineQueue.length > 0) {
            statusText.innerHTML = `<span class="status-dot processing"></span> Menyinkronkan ${offlineQueue.length} data...`;
        } else {
            statusText.innerHTML = `<span class="status-dot"></span> Cloud Database`;
        }
    }
}

async function flushOfflineQueue() {
    if (offlineQueue.length === 0 || !window.navigator.onLine) return;
    
    console.log(`Flushing ${offlineQueue.length} offline records to Firebase...`);
    const tempQueue = [...offlineQueue];
    offlineQueue = [];
    localStorage.setItem("SAYANGI_OFFLINE_QUEUE", JSON.stringify([]));
    
    for (let item of tempQueue) {
        try {
            if (item.method === 'PUT') {
                await fetch(`${FIREBASE_URL}/${item.path}.json`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(item.data)
                });
            } else if (item.method === 'POST') {
                const res = await fetch(`${FIREBASE_URL}/${item.path}.json?auth=${PRECHECK_FB_AUTH}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(item.data)
                });
                if (res.ok) {
                    const resJson = await res.json();
                    const key = resJson.name;
                    await fetch(`${FIREBASE_URL}/peserta/${key}.json?auth=${PRECHECK_FB_AUTH}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ firebase_id: key })
                    });
                }
            }
        } catch(e) {
            console.error("Failed to sync offline item, placing back in queue:", e);
            offlineQueue.push(item);
        }
    }
    
    localStorage.setItem("SAYANGI_OFFLINE_QUEUE", JSON.stringify(offlineQueue));
    updateOfflineSyncStatus();
    
    loadRecords();
    loadPatients();
    loadPatientsListTable();
    loadPesertaList();
}

window.addEventListener('online', () => {
    updateOfflineSyncStatus();
    flushOfflineQueue();
});
window.addEventListener('offline', () => {
    updateOfflineSyncStatus();
});

// --- Chart.js Longitudinal Trends ---
let activeHistoryView = 'list';
let trendChart = null;

function toggleHistoryView(view) {
    activeHistoryView = view;
    const list = document.getElementById('patient-history-list');
    const chartContainer = document.getElementById('patient-history-chart');
    const btnList = document.getElementById('btn-history-list');
    const btnChart = document.getElementById('btn-history-chart');
    
    if (view === 'list') {
        if (list) list.style.display = 'flex';
        if (chartContainer) chartContainer.style.display = 'none';
        if (btnList) btnList.classList.add('active');
        if (btnChart) btnChart.classList.remove('active');
    } else {
        if (list) list.style.display = 'none';
        if (chartContainer) chartContainer.style.display = 'block';
        if (btnList) btnList.classList.remove('active');
        if (btnChart) btnChart.classList.add('active');
        if (currentRecord) {
            renderHealthTrendChart(currentRecord.patient_id);
        }
    }
}

async function renderHealthTrendChart(patientId) {
    try {
        const recordsObj = await firebaseGet("records") || {};
        const records = Object.values(recordsObj).filter(Boolean).filter(r => r.patient_id === patientId || r.qr_code === patientId);
        
        if (records.length === 0) return;
        
        records.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        const labels = records.map(r => {
            const d = new Date(r.created_at);
            return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        });
        
        const tempData = records.map(r => r.body_temp);
        const asymData = records.map(r => {
            try {
                const ta = JSON.parse(r.thermal_analysis);
                return Math.max(ta.asymmetry.toes, ta.asymmetry.midfoot, ta.asymmetry.heel);
            } catch (e) {
                return 0;
            }
        });
        
        const canvas = document.getElementById('health-trend-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (trendChart) {
            trendChart.destroy();
        }
        
        trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Suhu Tubuh (°C)',
                        data: tempData,
                        borderColor: '#d97706',
                        backgroundColor: 'rgba(217, 119, 6, 0.05)',
                        borderWidth: 1.5,
                        tension: 0.2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Asimetri Kaki (°C)',
                        data: asymData,
                        borderColor: '#dc2626',
                        backgroundColor: 'rgba(220, 38, 38, 0.08)',
                        borderWidth: 1.5,
                        borderDash: [3, 3],
                        tension: 0.2,
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 6, font: { size: 9 }, color: '#4b5563' }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#6b7280' } },
                    y: {
                        position: 'left',
                        min: 0,
                        max: 42,
                        ticks: { font: { size: 9 }, color: '#6b7280' },
                        grid: { color: 'rgba(0,0,0,0.03)' }
                    }
                }
            }
        });
    } catch (e) {
        console.error("Failed to render Chart.js trend chart:", e);
    }
}

// --- Voice Recognition & AI Chatbot Dialog ---
let recognition = null;
let isRecording = false;
let chatHistory = [];

function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn("Speech Recognition not supported in this browser.");
        return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'id-ID';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    recognition.onstart = () => {
        isRecording = true;
        const micBtn = document.getElementById('ai-mic-btn');
        if (micBtn) {
            micBtn.textContent = '🔴';
            micBtn.style.animation = 'pulse 1.2s infinite';
        }
        showChatStatus("Mendengarkan...");
    };
    
    recognition.onresult = (e) => {
        const text = e.results[0][0].transcript;
        const chatInput = document.getElementById('ai-chat-input');
        if (chatInput) {
            chatInput.value = text;
        }
        showChatStatus("Suara terdeteksi!");
    };
    
    recognition.onerror = (e) => {
        console.error("Speech Recognition error:", e);
        showChatStatus("Gagal mendengar.");
        resetMicButton();
    };
    
    recognition.onend = () => {
        isRecording = false;
        resetMicButton();
    };
}

function resetMicButton() {
    const micBtn = document.getElementById('ai-mic-btn');
    if (micBtn) {
        micBtn.textContent = '🎙️';
        micBtn.style.animation = 'none';
    }
}

function startVoiceDictation() {
    if (!recognition) {
        initVoiceRecognition();
    }
    if (!recognition) {
        alert("Web Speech API tidak didukung di browser Anda.");
        return;
    }
    if (isRecording) {
        recognition.stop();
    } else {
        recognition.start();
    }
}

async function sendAIChatMessage() {
    const chatInput = document.getElementById('ai-chat-input');
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;
    
    chatInput.value = '';
    appendChatBubble('user', text);
    
    const apiKey = localStorage.getItem("GEMINI_API_KEY");
    if (!apiKey) {
        appendChatBubble('ai', "Silakan masukkan Gemini API Key di bagian atas dashboard untuk mulai berkonsultasi secara interaktif.");
        return;
    }
    
    showChatStatus("Gemini sedang berpikir...");
    
    const currentName = currentRecord.name;
    const currentAge = currentRecord.age;
    const currentGender = currentRecord.gender;
    const currentHistory = currentRecord.medical_history || 'Tidak ada riwayat';
    const currentTemp = currentRecord.body_temp;
    const ta = JSON.parse(currentRecord.thermal_analysis);
    
    const contextPrompt = `Kamu adalah Asisten Medis AI untuk program Booth Kesehatan Lansia 'Sayangi'.
Kamu sedang mendampingi Bidan untuk berkonsultasi mengenai pasien bernama ${currentName} (${currentAge} tahun, ${currentGender}) dengan riwayat medis: ${currentHistory}.

Data Vital Sign Terbaru Pasien:
- Suhu Tubuh dahi: ${currentTemp.toFixed(1)}°C

Data Termal Kaki (Skrining Kaki Diabetes):
- Asimetri per Zona (Kiri vs Kanan):
  * Jari: ${ta.asymmetry.toes}°C
  * Tengah: ${ta.asymmetry.midfoot}°C
  * Tumit: ${ta.asymmetry.heel}°C
- Interpretasi: ${ta.interpretation}
- Tingkat Risiko: ${ta.priority_status}

Catatan Percakapan Sebelumnya:
${chatHistory.map(c => `${c.role === 'user' ? 'Bidan' : 'AI'}: ${c.text}`).join('\n')}

Pertanyaan/Instruksi Baru dari Bidan: "${text}"

Berikan saran asuhan keperawatan taktis, perawatan kaki mandiri, atau peringatan rujukan jika kritis. Berikan jawaban dalam 2-4 kalimat yang padat dan bersahabat dalam Bahasa Indonesia.`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: contextPrompt }] }]
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            const reply = data.candidates[0].content.parts[0].text.trim();
            appendChatBubble('ai', reply);
            chatHistory.push({ role: 'user', text: text });
            chatHistory.push({ role: 'ai', text: reply });
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch(e) {
        console.error("Chatbot API error:", e);
        appendChatBubble('ai', "Maaf, terjadi kesalahan koneksi saat menghubungi asisten AI.");
    } finally {
        showChatStatus(null);
    }
}

function parseMarkdownToHTML(text) {
    if (!text) return "";
    let html = text;
    
    // 1. Horizontal dividers (---) -> clean style line
    html = html.replace(/^[\s]*[\-]{3,}[\s]*$/gm, '<hr style="border:0; border-top:1.5px dashed var(--border); margin:12px 0;">');
    
    // 2. Bold **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // 3. Italic *text*
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // 4. Bullet lists starting with * or -
    html = html.replace(/^[\s]*[\*\-]\s+(.*)/gm, '• $1');
    
    // 5. Failsafe: strip any stray raw asterisks
    html = html.replace(/\*/g, '');
    
    // 6. Newlines to break tags
    html = html.replace(/\n/g, '<br>');
    return html;
}

function appendChatBubble(sender, text) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;
    
    if (container.querySelector('div[style*="text-align:center"]')) {
        container.innerHTML = '';
    }
    
    const bubble = document.createElement('div');
    bubble.style.cssText = sender === 'user' 
        ? "align-self: flex-end; background: var(--teal); color: #fff; padding: 6px 10px; border-radius: 12px 12px 0 12px; font-size: 11px; max-width: 85%; margin-bottom: 4px; word-break: break-word;"
        : "align-self: flex-start; background: var(--surface); color: var(--text-1); border: 1px solid var(--border); padding: 6px 10px; border-radius: 12px 12px 12px 0; font-size: 11px; max-width: 85%; margin-bottom: 4px; word-break: break-word;";
    
    bubble.innerHTML = parseMarkdownToHTML(text);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}

function showChatStatus(text) {
    const status = document.getElementById('ai-chat-status');
    if (!status) return;
    if (text) {
        status.textContent = text;
        status.style.display = 'block';
    } else {
        status.style.display = 'none';
    }
}

// --- Kemenkes Referral Modal Functions ---
function openReferralModal() {
    document.getElementById('referral-modal').style.display = 'flex';
}

function closeReferralModal() {
    document.getElementById('referral-modal').style.display = 'none';
}

function populateReferralModal() {
    if (!currentRecord) return;
    
    const date = new Date(currentRecord.created_at);
    const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    
    document.getElementById('ref-letter-no').textContent = `SR/SAYANGI/2026/0${100 + currentRecord.id}`;
    document.getElementById('ref-pat-name').textContent = currentRecord.name;
    document.getElementById('ref-pat-nik').textContent = currentRecord.qr_code;
    document.getElementById('ref-pat-age-gender').textContent = `${currentRecord.age} tahun / ${currentRecord.gender}`;
    document.getElementById('ref-pat-address').textContent = currentRecord.address || '-';
    document.getElementById('ref-pat-history').textContent = currentRecord.medical_history || 'Tidak ada riwayat';
    
    document.getElementById('ref-vitals-temp').textContent = `${currentRecord.body_temp.toFixed(1)}°C`;
    
    try {
        const ta = JSON.parse(currentRecord.thermal_analysis);
        const maxAsym = Math.max(ta.asymmetry.toes, ta.asymmetry.midfoot, ta.asymmetry.heel);
        let asymText = `Selisih suhu maksimum kaki kaki kiri vs kanan: ${maxAsym.toFixed(1)}°C. `;
        if (currentRecord.priority_status === 'CRITICAL') {
            asymText += `⚠️ KONDISI KRITIS - Terdeteksi hotspot di area: `;
            const parts = [];
            if (ta.hotspots.left.length > 0) parts.push(`Kaki Kiri (${ta.hotspots.left.join(', ')})`);
            if (ta.hotspots.right.length > 0) parts.push(`Kaki Kanan (${ta.hotspots.right.join(', ')})`);
            asymText += parts.join(' & ') + ' (risiko pra-ulkus tinggi).';
        } else if (currentRecord.priority_status === 'WARNING') {
            asymText += `⚠️ PERINGATAN - Deviasi suhu ringan.`;
        } else {
            asymText += `✅ NORMAL - Distribusi suhu simetris.`;
        }
        document.getElementById('ref-thermal-asym').textContent = asymText;
    } catch(e) {
        document.getElementById('ref-thermal-asym').textContent = '-';
    }
    
    document.getElementById('ref-ai-summary').textContent = currentRecord.gemini_summary;
    document.getElementById('ref-date').textContent = dateStr;
}

// --- WhatsApp Dispatcher Functions ---
function openWaModal() {
    document.getElementById('wa-modal').style.display = 'flex';
}

function closeWaModal() {
    document.getElementById('wa-modal').style.display = 'none';
}

function populateWaModal() {
    if (!currentRecord) return;
    
    const phoneInput = document.getElementById('wa-phone');
    if (phoneInput) {
        phoneInput.value = currentRecord.phone || '';
    }
    
    try {
        const ta = JSON.parse(currentRecord.thermal_analysis);
        const maxAsym = Math.max(ta.asymmetry.toes, ta.asymmetry.midfoot, ta.asymmetry.heel);
        const condition = currentRecord.priority_status === 'CRITICAL' 
            ? '⚠️ KRITIS (Risiko Luka Diabetes Tinggi)' 
            : (currentRecord.priority_status === 'WARNING' ? '⚠️ PERINGATAN (Deviasi Suhu Ringan)' : '✅ STABIL/NORMAL');
        
        const msg = `Halo Bapak/Ibu, ini Bidan Desa dari Booth Kesehatan Sayangi.

Hari ini Mbah/Pak *${currentRecord.name}* telah selesai melakukan pemeriksaan berkala. Berikut hasil skrining kesehatan terbarunya:
- Suhu Tubuh: ${currentRecord.body_temp.toFixed(1)}°C
- Skrining Kaki Diabetik: Selisih suhu kaki kiri & kanan mencapai ${maxAsym.toFixed(1)}°C (${condition}).

Saran Asuhan Mandiri:
${currentRecord.priority_status === 'CRITICAL' 
  ? '- Harap pastikan Mbah selalu menggunakan sandal/sepatu pelindung saat berjalan (jangan bertelanjang kaki).\n- Periksa celah jari dan telapak kaki setiap hari.\n- Segera jadwalkan kontrol klinis di Pustu terdekat.' 
  : '- Bersihkan dan keringkan kaki Mbah setelah beraktivitas.\n- Selalu gunakan pelembab pada area kaki kering.'}

Terima kasih atas kerja samanya menjaga kesehatan lansia kita.`;
        document.getElementById('wa-message').value = msg;
    } catch(e) {
        console.error(e);
    }
}

function sendWhatsAppDirect() {
    let phone = document.getElementById('wa-phone').value.trim();
    const msg = document.getElementById('wa-message').value.trim();
    if (!phone) {
        alert("Harap masukkan nomor WhatsApp keluarga!");
        return;
    }
    if (!msg) return;
    
    if (phone.startsWith('0')) {
        phone = '62' + phone.substring(1);
    }
    phone = phone.replace(/[^0-9]/g, '');
    
    const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    closeWaModal();
}

// --- Compare Mode Functions ---
let isCompareMode = false;
let backupRecordDetailHTML = '';

async function enterCompareMode(currentRecordId, historicalRecordId) {
    try {
        const recordsObj = await firebaseGet("records") || {};
        const currentRec = recordsObj[currentRecordId];
        const oldRec = recordsObj[historicalRecordId];
        
        if (!currentRec || !oldRec) {
            alert("Data rekam medis untuk perbandingan gagal dimuat.");
            return;
        }
        
        isCompareMode = true;
        backupRecordDetailHTML = detailPanel.innerHTML;
        
        const dateOld = new Date(oldRec.created_at);
        const dateNew = new Date(currentRec.created_at);
        const dateStrOld = dateOld.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        const dateStrNew = dateNew.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
        
        const tempDelta = currentRec.body_temp - oldRec.body_temp;
        const tempDeltaText = tempDelta === 0 ? '=' : (tempDelta > 0 ? `+${tempDelta.toFixed(1)}` : `${tempDelta.toFixed(1)}`);
        
        const taOld = JSON.parse(oldRec.thermal_analysis);
        const taNew = JSON.parse(currentRec.thermal_analysis);
        const oldMaxAsym = Math.max(taOld.asymmetry.toes, taOld.asymmetry.midfoot, taOld.asymmetry.heel);
        const newMaxAsym = Math.max(taNew.asymmetry.toes, taNew.asymmetry.midfoot, taNew.asymmetry.heel);
        const asymDelta = newMaxAsym - oldMaxAsym;
        const asymDeltaText = asymDelta === 0 ? '=' : (asymDelta > 0 ? `+${asymDelta.toFixed(1)}` : `${asymDelta.toFixed(1)}`);
        
        let compSummary = "Memuat analisis komparasi progresif dari Gemini AI...";
        
        detailPanel.innerHTML = `
            <div class="detail-view">
                <div class="glass-panel" style="padding: 12px 16px; display:flex; justify-content:space-between; align-items:center; border-color:var(--teal-border); background:rgba(13,148,136,0.02);">
                    <div>
                        <h2 style="font-size: 14px; color:var(--text-1); font-weight:700; margin:0;">Mode Perbandingan Sesi</h2>
                        <span style="font-size: 11px; color: var(--text-3);">${currentRec.name} &mdash; Sesi A (${dateStrOld}) vs Sesi B (${dateStrNew})</span>
                    </div>
                    <button class="btn btn-outline" onclick="exitCompareMode()" style="flex:none; padding:4px 12px; margin:0; color:var(--teal); border-color:var(--teal-border); height:28px; line-height:1; font-size:10.5px;">
                        ↩️ Keluar Mode Banding
                    </button>
                </div>
                
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div class="glass-panel" style="padding:10px; display:flex; flex-direction:column; gap:8px;">
                        <h3 style="font-size:10px; color:var(--text-3); text-transform:uppercase; font-weight:bold; margin:0;">Sesi A: ${dateStrOld}</h3>
                        <div class="thermal-image-wrapper" style="padding:4px; background:var(--bg); border-color:var(--border-soft);">
                            <canvas id="thermal-compare-canvas-a" width="280" height="210" style="width:100%; border-radius:4px; background:#1e293b;"></canvas>
                        </div>
                    </div>
                    <div class="glass-panel" style="padding:10px; display:flex; flex-direction:column; gap:8px;">
                        <h3 style="font-size:10px; color:var(--text-3); text-transform:uppercase; font-weight:bold; margin:0;">Sesi B (Terbaru): ${dateStrNew}</h3>
                        <div class="thermal-image-wrapper" style="padding:4px; background:var(--bg); border-color:var(--border-soft);">
                            <canvas id="thermal-compare-canvas-b" width="280" height="210" style="width:100%; border-radius:4px; background:#1e293b;"></canvas>
                        </div>
                    </div>
                </div>
                
                <div class="glass-panel" style="padding:12px;">
                    <h3 style="font-size:10.5px; color:var(--teal); text-transform:uppercase; margin-bottom:8px; font-weight:700;">⚖️ Perbandingan Vital &amp; Termal Kaki</h3>
                    <table style="width:100%; border-collapse:collapse; font-size:11.5px;">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border); text-align:left; color:var(--text-3); font-weight:600;">
                                <th style="padding:4px 0;">Parameter</th>
                                <th style="padding:4px 0;">Sesi A</th>
                                <th style="padding:4px 0;">Sesi B</th>
                                <th style="padding:4px 0;">Perubahan (B - A)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom:1px solid var(--border-soft);">
                                <td style="padding:6px 0; font-weight:500;">Suhu Dahi</td>
                                <td style="padding:6px 0;">${oldRec.body_temp.toFixed(1)} °C</td>
                                <td style="padding:6px 0;">${currentRec.body_temp.toFixed(1)} °C</td>
                                <td style="padding:6px 0; font-weight:bold; color:${tempDelta > 0.5 ? 'var(--red)' : (tempDelta < -0.5 ? 'var(--green)' : 'var(--text-2)')};">${tempDeltaText} °C</td>
                            </tr>
                            <tr style="border-bottom:1px solid var(--border-soft);">
                                <td style="padding:6px 0; font-weight:500;">Asimetri Kaki Maks</td>
                                <td style="padding:6px 0;">${oldMaxAsym.toFixed(1)} °C</td>
                                <td style="padding:6px 0;">${newMaxAsym.toFixed(1)} °C</td>
                                <td style="padding:6px 0; font-weight:bold; color:${asymDelta > 0.3 ? 'var(--red)' : (asymDelta < -0.3 ? 'var(--green)' : 'var(--text-2)')};">${asymDeltaText} °C</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                
                <div class="gemini-summary-box" style="position: relative;">
                    <div class="gemini-badge" style="position: absolute; top: 12px; right: 14px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                        Analisis Progresif Gemini AI
                    </div>
                    <div class="gemini-content" style="margin-top: 6px;" id="compare-ai-summary">
                        ${compSummary}
                    </div>
                </div>
            </div>
        `;
        
        const canvasA = document.getElementById('thermal-compare-canvas-a');
        const canvasB = document.getElementById('thermal-compare-canvas-b');
        
        if (canvasA) drawThermalMapBase(canvasA, JSON.parse(oldRec.thermal_grid));
        if (canvasB) drawThermalMapBase(canvasB, JSON.parse(currentRec.thermal_grid));
        
        const apiKey = localStorage.getItem("GEMINI_API_KEY");
        if (apiKey) {
            const compPrompt = `Kamu adalah Asisten Medis AI program Sayangi.
Bandingkan data pemeriksaan medis pasien bernama ${currentRec.name} di dua sesi kunjungan berbeda:
Sesi A (${dateStrOld}): Suhu ${oldRec.body_temp.toFixed(1)}°C, Maks Asimetri Kaki ${oldMaxAsym.toFixed(1)}°C.
Sesi B (${dateStrNew}): Suhu ${currentRec.body_temp.toFixed(1)}°C, Maks Asimetri Kaki ${newMaxAsym.toFixed(1)}°C.

Analisislah apakah kondisi radang kaki/infeksi kaki diabetes pasien membaik, stabil, atau memburuk, serta apakah vital sign menunjukkan pemulihan atau penurunan kondisi.
Tulis analisis singkat, terstruktur, padat (maksimal 3-4 kalimat) dalam Bahasa Indonesia.`;
            
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: compPrompt }] }]
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    compSummary = data.candidates[0].content.parts[0].text.trim();
                    const aiDiv = document.getElementById('compare-ai-summary');
                    if (aiDiv) aiDiv.textContent = compSummary;
                }
            } catch (e) {
                console.error(e);
            }
        } else {
            const statusImprove = asymDelta < -0.3 ? 'MEMBAIK' : (asymDelta > 0.3 ? 'MEMBURUK' : 'STABIL');
            document.getElementById('compare-ai-summary').textContent = `Perbandingan Offline: Risiko kaki diabetes lansia menunjukkan status ${statusImprove} (perubahan asimetri kaki sebesar ${asymDeltaText}°C). Harap pertahankan kontrol rutin bulanan.`;
        }
        
    } catch(e) {
        console.error(e);
    }
}

function exitCompareMode() {
    isCompareMode = false;
    if (backupRecordDetailHTML) {
        detailPanel.innerHTML = backupRecordDetailHTML;
        if (currentRecord) {
            const canvas = document.getElementById('thermal-detail-canvas');
            if (canvas) {
                const gridData = JSON.parse(currentRecord.thermal_grid);
                drawThermalMap(canvas, gridData);
            }
            loadPatientHistory(currentRecord.patient_id);
        }
    }
}

// --- Visual Foot Scanner UI Tabs & Controls ---
let activeDetailTab = 'thermal';
let capturedImageBlob = null;
let currentVisualBase64 = null;
let isStreaming = false;

function switchDetailTab(tab) {
    activeDetailTab = tab;
    const thermalTab = document.getElementById('detail-tab-thermal');
    const visualTab = document.getElementById('detail-tab-visual');
    const btnThermal = document.getElementById('tab-btn-thermal');
    const btnVisual = document.getElementById('tab-btn-visual');
    
    if (tab === 'thermal') {
        if (thermalTab) thermalTab.style.display = 'block';
        if (visualTab) visualTab.style.display = 'none';
        if (btnThermal) btnThermal.classList.add('active');
        if (btnVisual) btnVisual.classList.remove('active');
        stopVisualStream();
    } else {
        if (thermalTab) thermalTab.style.display = 'none';
        if (visualTab) visualTab.style.display = 'block';
        if (btnThermal) btnThermal.classList.remove('active');
        if (btnVisual) btnVisual.classList.add('active');
        renderSavedVisualImage();
    }
}

function toggleVisualStream() {
    const ip = (localStorage.getItem("ESP32_CAM_IP") || "").trim();
    if (!ip) {
        alert("Harap isi IP Address ESP32-CAM Anda pada pengaturan di bagian atas bar!");
        return;
    }
    
    const streamImg = document.getElementById('visual-stream-img');
    const canvas = document.getElementById('visual-detail-canvas');
    const placeholder = document.getElementById('visual-cam-placeholder');
    const btnStream = document.getElementById('btn-toggle-stream');
    const btnCapture = document.getElementById('btn-capture-photo');
    const streamWrapper = document.querySelector('.camera-stream-wrapper');
    
    if (isStreaming) {
        stopVisualStream();
    } else {
        isStreaming = true;
        if (placeholder) placeholder.style.display = 'none';
        if (canvas) canvas.style.display = 'none';
        if (streamImg) {
            streamImg.src = `http://${ip}/stream`;
            streamImg.style.display = 'block';
        }
        if (btnStream) {
            btnStream.textContent = '⏹️ Hentikan Stream';
            btnStream.classList.add('active');
        }
        if (btnCapture) btnCapture.disabled = false;
        if (streamWrapper) streamWrapper.classList.add('streaming');
    }
}

function stopVisualStream() {
    isStreaming = false;
    const streamImg = document.getElementById('visual-stream-img');
    const btnStream = document.getElementById('btn-toggle-stream');
    const btnCapture = document.getElementById('btn-capture-photo');
    const streamWrapper = document.querySelector('.camera-stream-wrapper');
    
    if (streamImg) {
        streamImg.src = '';
        streamImg.style.display = 'none';
    }
    if (btnStream) {
        btnStream.textContent = '🎥 Live Stream';
        btnStream.classList.remove('active');
    }
    if (btnCapture) btnCapture.disabled = true;
    if (streamWrapper) streamWrapper.classList.remove('streaming');
    
    const canvas = document.getElementById('visual-detail-canvas');
    const placeholder = document.getElementById('visual-cam-placeholder');
    if (canvas && canvas.style.display === 'block') {
        // Keep canvas
    } else if (placeholder) {
        placeholder.style.display = 'flex';
    }
}

async function captureFootPhoto() {
    const ip = (localStorage.getItem("ESP32_CAM_IP") || "").trim();
    if (!ip) return;
    
    const btnCapture = document.getElementById('btn-capture-photo');
    const statusBox = document.getElementById('roboflow-status-box');
    const btnRunRobo = document.getElementById('btn-run-roboflow');
    
    if (statusBox) statusBox.textContent = "Mengambil gambar...";
    if (btnCapture) btnCapture.disabled = true;
    
    try {
        await fetch(`http://${ip}/flash/on`);
        await new Promise(r => setTimeout(r, 400));
    } catch(e) {}
    
    try {
        const response = await fetch(`http://${ip}/capture`);
        if (!response.ok) throw new Error("Gagal mengambil foto");
        
        capturedImageBlob = await response.blob();
        
        try {
            fetch(`http://${ip}/flash/off`);
        } catch(e) {}
        
        drawBlobToCanvas(capturedImageBlob);
        
        if (statusBox) statusBox.textContent = "Foto terambil!";
        if (btnRunRobo) btnRunRobo.disabled = false;
        
        stopVisualStream();
    } catch(e) {
        console.error(e);
        if (statusBox) statusBox.textContent = "Gagal mengambil foto";
        alert("Gagal memanggil REST capture pada ESP32-CAM. Cek IP Anda.");
        
        try {
            fetch(`http://${ip}/flash/off`);
        } catch(err) {}
    } finally {
        if (btnCapture && isStreaming) btnCapture.disabled = false;
    }
}

function handleManualVisualUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    capturedImageBlob = file;
    drawBlobToCanvas(file);
    
    const statusBox = document.getElementById('roboflow-status-box');
    const btnRunRobo = document.getElementById('btn-run-roboflow');
    if (statusBox) statusBox.textContent = "Berkas diunggah";
    if (btnRunRobo) btnRunRobo.disabled = false;
}

function drawBlobToCanvas(blob) {
    const canvas = document.getElementById('visual-detail-canvas');
    const placeholder = document.getElementById('visual-cam-placeholder');
    const streamImg = document.getElementById('visual-stream-img');
    
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const img = new Image();
    img.onload = () => {
        canvas.width = 320;
        canvas.height = 240;
        ctx.drawImage(img, 0, 0, 320, 240);
        
        if (placeholder) placeholder.style.display = 'none';
        if (streamImg) streamImg.style.display = 'none';
        canvas.style.display = 'block';
        
        currentVisualBase64 = canvas.toDataURL('image/jpeg', 0.85);
    };
    img.src = URL.createObjectURL(blob);
}

async function runRoboflowAnalysis() {
    const apiKey = (localStorage.getItem("ROBOFLOW_API_KEY") || "").trim();
    if (!apiKey) {
        alert("Masukkan API Key Roboflow Anda pada input pengaturan di atas bar!");
        return;
    }
    if (!currentVisualBase64) {
        alert("Ambil foto kaki atau upload file terlebih dahulu.");
        return;
    }
    
    const statusBox = document.getElementById('roboflow-status-box');
    const predList = document.getElementById('roboflow-predictions-list');
    const btnRun = document.getElementById('btn-run-roboflow');
    
    if (statusBox) statusBox.textContent = "Menghubungi Roboflow AI...";
    if (btnRun) btnRun.disabled = true;
    if (predList) predList.innerHTML = '<div style="text-align:center; padding:10px 0;">Menganalisis citra...</div>';
    
    const base64Data = currentVisualBase64.split(',')[1];
    const modelEndpoint = "diabetic-foot-ulcer-detection/1"; 
    
    try {
        const response = await fetch(`https://detect.roboflow.com/${modelEndpoint}?api_key=${apiKey}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: base64Data
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        
        if (statusBox) statusBox.textContent = "Analisis selesai!";
        drawRoboflowBoundingBoxes(data.predictions);
        
        if (currentRecord) {
            currentRecord.visual_foot_image = currentVisualBase64;
            currentRecord.visual_predictions = JSON.stringify(data.predictions);
            
            const containsUlcer = data.predictions.some(p => p.class.toLowerCase() === 'ulcer' && p.confidence > 0.6);
            if (containsUlcer) {
                currentRecord.priority_status = 'CRITICAL';
                const badge = document.querySelector('#detail-panel .patient-priority-badge');
                if (badge) {
                    badge.textContent = 'KRITIS / PRIORITAS UTAMA';
                    badge.className = 'patient-priority-badge CRITICAL';
                }
            }
            
            await firebasePut(`records/${currentRecord.id}`, currentRecord);
            loadRecords(); 
        }
    } catch(e) {
        console.error("Roboflow API Failure:", e);
        if (statusBox) statusBox.textContent = "AI Gagal";
        if (predList) predList.innerHTML = '<div style="color:var(--red); text-align:center; padding:10px 0;">Analisis visual gagal. Periksa API Key Anda.</div>';
    } finally {
        if (btnRun) btnRun.disabled = false;
    }
}

function drawRoboflowBoundingBoxes(predictions) {
    const canvas = document.getElementById('visual-detail-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0, 320, 240);
        
        const predList = document.getElementById('roboflow-predictions-list');
        if (predList) predList.innerHTML = '';
        
        if (predictions.length === 0) {
            if (predList) predList.innerHTML = '<div style="color:var(--green); font-weight:600; text-align:center; padding:10px 0;">✅ Kulit Normal/Bebas Ulkus</div>';
            return;
        }
        
        predictions.forEach(pred => {
            const scaleX = 320 / pred.image_width;
            const scaleY = 240 / pred.image_height;
            
            const w = pred.width * scaleX;
            const h = pred.height * scaleY;
            const x = (pred.x - pred.width / 2) * scaleX;
            const y = (pred.y - pred.height / 2) * scaleY;
            
            const color = pred.class.toLowerCase() === 'ulcer' ? '#ef4444' : '#f59e0b';
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.strokeRect(x, y, w, h);
            
            ctx.fillStyle = color;
            ctx.fillRect(x, y - 15, w < 70 ? 70 : w, 15);
            
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9.5px sans-serif';
            ctx.fillText(`${pred.class} ${Math.round(pred.confidence * 100)}%`, x + 3, y - 4);
            
            if (predList) {
                const badge = document.createElement('div');
                badge.className = `pred-badge ${pred.class.toLowerCase() === 'ulcer' ? 'ulcer' : 'callus'}`;
                badge.innerHTML = `
                    <span>🔍 ${pred.class}</span>
                    <span>${Math.round(pred.confidence * 100)}%</span>
                `;
                predList.appendChild(badge);
            }
        });
    };
    img.src = currentVisualBase64;
}

function renderSavedVisualImage() {
    const canvas = document.getElementById('visual-detail-canvas');
    const placeholder = document.getElementById('visual-cam-placeholder');
    const predList = document.getElementById('roboflow-predictions-list');
    const btnRun = document.getElementById('btn-run-roboflow');
    
    if (!canvas) return;
    
    if (currentRecord && currentRecord.visual_foot_image) {
        currentVisualBase64 = currentRecord.visual_foot_image;
        if (placeholder) placeholder.style.display = 'none';
        canvas.style.display = 'block';
        
        const preds = currentRecord.visual_predictions ? JSON.parse(currentRecord.visual_predictions) : [];
        drawRoboflowBoundingBoxes(preds);
        
        if (btnRun) btnRun.disabled = false;
    } else {
        canvas.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        if (predList) predList.innerHTML = '<div style="color:var(--text-3); text-align:center; font-style:italic; padding:10px 0;">Belum ada hasil pindai.</div>';
        if (btnRun) btnRun.disabled = true;
    }
}

// ═══ Welcome Portal & verification modules ═══
let currentSession = null;

// ═══ New Landing Page + Modal Bridge Functions ═══════════════════════

function openLoginModal(role) {
    const modalId = 'login-modal-' + role;
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        // Reset to login screen
        modal.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
        const loginScreen = modal.querySelector('.auth-screen:first-of-type');
        if (loginScreen) loginScreen.classList.add('active');
    }
}

function closeLoginModal(role) {
    const modalId = 'login-modal-' + role;
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

function switchModalScreen(modalRole, screenName) {
    const modalId = 'login-modal-' + modalRole;
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.querySelectorAll('.auth-screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`screen-${screenName}`);
    if (target) target.classList.add('active');
}

function enterRole(role) {
    const appContainer = document.querySelector('.app-container');
    const mainAdmin = document.getElementById('main-admin-workspace');
    const mainWarga = document.getElementById('warga-portal-container');
    const adminTabs = document.getElementById('admin-view-tabs');
    const adminHeaderControls = document.getElementById('admin-header-controls');
    const wargaHeaderControls = document.getElementById('warga-header-controls');

    // Close any open modals
    document.querySelectorAll('.login-modal-overlay').forEach(m => m.classList.remove('active'));

    // Save mock session for demo convenience on reload
    if (role === 'admin') {
        currentSession = { role: 'admin', data: { name: 'Demo Kader Bidan', id: 'DEMO_BIDAN' } };
        sessionStorage.setItem("SAYANGI_SESSION", JSON.stringify(currentSession));
    } else if (role === 'warga') {
        const existing = sessionStorage.getItem("SAYANGI_SESSION");
        if (existing) {
            const parsed = JSON.parse(existing);
            if (parsed.role === 'warga') {
                currentSession = parsed;
            } else {
                currentSession = null;
            }
        } else {
            currentSession = null;
        }
    }

    if (role === 'warga-pending') {
        role = 'warga';
    }

    // Toggle body show-app class (pure CSS state)
    document.body.classList.add('show-app');

    if (role === 'warga') {
        if (appContainer) appContainer.classList.remove('admin-mode');
        
        if (mainAdmin) mainAdmin.style.setProperty('display', 'none', 'important');
        if (mainWarga) mainWarga.style.setProperty('display', 'flex', 'important');
        if (adminTabs) adminTabs.style.setProperty('display', 'none', 'important');
        if (adminHeaderControls) adminHeaderControls.style.setProperty('display', 'none', 'important');
        if (wargaHeaderControls) wargaHeaderControls.style.setProperty('display', 'flex', 'important');

        // Check active citizen session
        if (currentSession && currentSession.role === 'warga' && currentSession.data) {
            const patient = currentSession.data;
            let nik = "";
            if (patient.address) {
                const match = patient.address.match(/\(NIK:\s*(\d{16})\)/);
                if (match) nik = match[1];
            }
            renderWargaPortalDashboard(patient, nik);
        } else {
            // Force show login form
            doWargaPortalLogout();
        }

        checkPrecheckConnection();
    } else {
        if (appContainer) appContainer.classList.add('admin-mode');
        
        if (mainAdmin) mainAdmin.style.removeProperty('display');
        if (mainWarga) mainWarga.style.setProperty('display', 'none', 'important');
        if (adminTabs) adminTabs.style.removeProperty('display');
        if (adminHeaderControls) adminHeaderControls.style.removeProperty('display');
        if (wargaHeaderControls) wargaHeaderControls.style.setProperty('display', 'none', 'important');

        switchTab('dashboard');
    }
}

function exitToPortal() {
    sessionStorage.removeItem("SAYANGI_SESSION");
    currentSession = null;

    const appContainer = document.querySelector('.app-container');
    const mainAdmin = document.getElementById('main-admin-workspace');
    const mainWarga = document.getElementById('warga-portal-container');
    const adminTabs = document.getElementById('admin-view-tabs');
    const adminHeaderControls = document.getElementById('admin-header-controls');
    const wargaHeaderControls = document.getElementById('warga-header-controls');

    // Close any open modals
    document.querySelectorAll('.login-modal-overlay').forEach(m => m.classList.remove('active'));

    // Remove classes to trigger CSS default landing page view
    document.body.classList.remove('show-app');
    if (appContainer) appContainer.classList.remove('admin-mode');

    if (mainAdmin) mainAdmin.style.setProperty('display', 'none', 'important');
    if (mainWarga) mainWarga.style.setProperty('display', 'none', 'important');
    if (adminTabs) adminTabs.style.setProperty('display', 'none', 'important');
    if (adminHeaderControls) adminHeaderControls.style.setProperty('display', 'none', 'important');
    if (wargaHeaderControls) wargaHeaderControls.style.setProperty('display', 'none', 'important');
}

async function approvePatient(id) {
    if (!confirm("Setujui pendaftaran warga ini untuk pemeriksaan Booth?")) return;
    try {
        await firebasePut(`patients/${id}/status`, "APPROVED");
        alert("Pendaftaran berhasil disetujui!");
        
        // Update current local record state if matching
        if (currentRecord && currentRecord.patient_id === id) {
            currentRecord.priority_status = 'BELUM_DIPERIKSA';
            renderRecordDetail(currentRecord);
        }
        
        loadPatientsListTable();
        loadPatients();
        loadRecords();
    } catch (e) {
        console.error(e);
        alert("Gagal menyetujui pendaftaran: " + e.message);
    }
}

// Auth UI screens switcher (still used by some legacy calls)
function showAuthScreen(screenName) {
    document.querySelectorAll('.auth-screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const target = document.getElementById(`screen-${screenName}`);
    if (target) {
        target.classList.add('active');
    }
}

// 1. Warga Login
async function handleWargaLogin(e) {
    e.preventDefault();
    const nik = document.getElementById('wlogin-nik').value.trim();
    const password = document.getElementById('wlogin-password').value;
    
    if (!nik || !password) {
        alert("Harap masukkan NIK dan Password!");
        return;
    }
    
    try {
        const patientsObj = await firebaseGet("patients") || {};
        const patients = Object.values(patientsObj).filter(Boolean);
        
        let foundPatient = null;
        for (let p of patients) {
            if (p.address && p.address.includes(nik)) {
                foundPatient = p;
                break;
            }
        }
        
        if (!foundPatient) {
            alert("NIK Anda belum terdaftar. Silakan daftar terlebih dahulu.");
            return;
        }
        
        if (foundPatient.password !== password) {
            alert("Password yang Anda masukkan salah!");
            return;
        }
        
        currentSession = {
            role: 'warga',
            data: foundPatient
        };
        sessionStorage.setItem("SAYANGI_SESSION", JSON.stringify(currentSession));
        
        if (foundPatient.status === 'APPROVED') {
            enterRole('warga');
            renderWargaDashboard(foundPatient);
        } else {
            enterRole('warga-pending');
        }
    } catch (err) {
        console.error(err);
        alert("Gagal melakukan login.");
    }
}

// 2. Warga Register Account
async function handleWargaRegisterAccount(e) {
    e.preventDefault();
    const name = document.getElementById('wreg-nama').value.trim();
    const age = parseInt(document.getElementById('wreg-umur').value);
    const gender = document.getElementById('wreg-jk').value;
    const nik = document.getElementById('wreg-nik').value.trim();
    const password = document.getElementById('wreg-password').value;
    const phone = document.getElementById('wreg-hp').value.trim();
    const address = document.getElementById('wreg-alamat').value.trim();
    const medical_history = document.getElementById('wreg-keluhan').value.trim();
    
    if (nik.length !== 16 || isNaN(nik)) {
        alert("NIK harus terdiri dari 16 digit angka!");
        return;
    }
    
    try {
        const patientsObj = await firebaseGet("patients") || {};
        const patients = Object.values(patientsObj).filter(Boolean);
        
        for (let p of patients) {
            if (p.address && p.address.includes(nik)) {
                alert("NIK tersebut sudah terdaftar! Silakan login.");
                showAuthScreen('warga-login');
                return;
            }
        }
        
        const qr_code = 'PAS-' + String(Math.floor(10000 + Math.random() * 90000));
        const newPatient = {
            id: qr_code,
            name,
            age,
            gender,
            qr_code,
            phone,
            password,
            address: `${address} (NIK: ${nik})`,
            medical_history,
            status: "PENDING",
            created_at: new Date().toISOString()
        };
        
        await firebasePut(`patients/${qr_code}`, newPatient);
        
        currentSession = {
            role: 'warga',
            data: newPatient
        };
        sessionStorage.setItem("SAYANGI_SESSION", JSON.stringify(currentSession));
        
        alert("Pendaftaran berhasil dikirim! Silakan menunggu persetujuan Bidan Desa.");
        enterRole('warga-pending');
        
        document.getElementById('screen-warga-register').querySelector('form').reset();
    } catch (err) {
        console.error(err);
        alert("Terjadi kesalahan koneksi.");
    }
}

// 3. Admin Login
async function handleAdminLogin(e) {
    e.preventDefault();
    const username = document.getElementById('alogin-username').value.trim().toLowerCase();
    const password = document.getElementById('alogin-password').value;
    
    try {
        const admins = await firebaseGet("admins") || {};
        const adminData = admins[username];
        
        if (!adminData || adminData.password !== password) {
            alert("Username atau Password admin salah!");
            return;
        }
        
        currentSession = {
            role: 'admin',
            data: adminData
        };
        sessionStorage.setItem("SAYANGI_SESSION", JSON.stringify(currentSession));
        
        enterRole('admin');
        loadRecords(); // Load medical record lists for admin
        alert(`Selamat Datang, ${adminData.name}!`);
    } catch (err) {
        console.error(err);
        alert("Koneksi gagal.");
    }
}

// 4. Admin Register Account
async function handleAdminRegisterAccount(e) {
    e.preventDefault();
    const name = document.getElementById('areg-name').value.trim();
    const username = document.getElementById('areg-username').value.trim().toLowerCase();
    const password = document.getElementById('areg-password').value;
    const secretKey = document.getElementById('areg-key').value;
    
    if (secretKey !== "GARUDA2026") {
        alert("Admin Verification Key salah! Anda tidak diizinkan mendaftar sebagai Admin.");
        return;
    }
    
    try {
        const admins = await firebaseGet("admins") || {};
        if (admins[username]) {
            alert("Username admin tersebut sudah terdaftar!");
            return;
        }
        
        const newAdmin = {
            username,
            password,
            name
        };
        
        await firebasePut(`admins/${username}`, newAdmin);
        alert("Admin baru berhasil didaftarkan! Silakan masuk.");
        showAuthScreen('admin-login');
        
        document.getElementById('screen-admin-register').querySelector('form').reset();
    } catch (err) {
        console.error(err);
        alert("Pendaftaran admin gagal.");
    }
}

// 5. Logout Session
function logoutSession() {
    exitToPortal();
}

// 6. Check Verification Status
async function checkVerificationStatus() {
    if (!currentSession || currentSession.role !== 'warga') return;
    const patientId = currentSession.data.id;
    
    try {
        const p = await firebaseGet(`patients/${patientId}`);
        if (p) {
            currentSession.data = p;
            sessionStorage.setItem("SAYANGI_SESSION", JSON.stringify(currentSession));
            
            if (p.status === 'APPROVED') {
                alert("Selamat! Akun Anda telah disetujui Bidan Desa.");
                enterRole('warga');
                renderWargaDashboard(p);
            } else {
                alert("Akun Anda masih berstatus PENDING. Silakan hubungi Bidan Desa.");
            }
        }
    } catch (e) {
        console.error(e);
        alert("Gagal mengecek status.");
    }
}

function renderWargaDashboard(patient) {
    let nik = "";
    if (patient.address) {
        const match = patient.address.match(/\(NIK:\s*(\d{16})\)/);
        if (match) nik = match[1];
    }
    
    const searchInput = document.getElementById('warga-search-nik');
    if (searchInput) {
        searchInput.value = nik;
        handleWargaSearch();
    }
}

// Symptoms AI Consultation Chat
let symptomsChatHistory = [];

async function sendSymptomsChatMessage() {
    const chatInput = document.getElementById('symptoms-chat-input');
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;
    
    chatInput.value = '';
    appendSymptomsChatBubble('user', text);
    
    const apiKey = localStorage.getItem("GEMINI_API_KEY");
    if (!apiKey) {
        appendSymptomsChatBubble('ai', "Silakan hubungkan database atau inisialisasi API key untuk memulai.");
        return;
    }
    
    // Add thinking placeholder
    const thinkingId = 'thinking_' + Date.now();
    const chatBox = document.getElementById('symptoms-chat-box');
    if (chatBox) {
        const thinkingBubble = document.createElement('div');
        thinkingBubble.id = thinkingId;
        thinkingBubble.style.cssText = "align-self: flex-start; display: flex; gap: 8px; align-items: center; font-size: 11px; color: var(--text-3); padding-left: 8px; margin-bottom: 8px;";
        thinkingBubble.innerHTML = `<span class="status-dot processing"></span> Gemini sedang menganalisis gejala...`;
        chatBox.appendChild(thinkingBubble);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    
    const contextPrompt = `Kamu adalah Asisten Analisis Gejala & Sistem Rujukan AI Kesehatan (inspired by AI-HealthCare-Assistant).
Kamu membantu tenaga medis mendeteksi keluhan penyakit pasien, memberikan penilaian risiko awal (Rendah/Sedang/Kritis), saran asuhan keperawatan mandiri, dan rujukan dokter spesialis yang tepat (misalnya: Spesialis Penyakit Dalam, Spesialis Bedah, atau Podiatris).

Percakapan sebelumnya:
${symptomsChatHistory.map(c => `${c.role === 'user' ? 'Pertanyaan' : 'AI'}: ${c.text}`).join('\n')}

Pertanyaan/Keluhan Baru: "${text}"

Berikan jawaban profesional medis yang terchecked dengan format:
1. Analisis Singkat & Tingkat Risiko
2. Saran Asuhan Perawatan Mandiri
3. Rekomendasi Dokter Spesialis Rujukan

Jawablah dengan bahasa Indonesia yang jelas, padat, dan menenangkan dalam 3-4 kalimat per poin.`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: contextPrompt }] }]
            })
        });
        
        // Remove thinking placeholder
        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.remove();
        
        if (res.ok) {
            const data = await res.json();
            const reply = data.candidates[0].content.parts[0].text.trim();
            appendSymptomsChatBubble('ai', reply);
            symptomsChatHistory.push({ role: 'user', text: text });
            symptomsChatHistory.push({ role: 'ai', text: reply });
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch(e) {
        console.error("Symptoms AI error:", e);
        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.remove();
        appendSymptomsChatBubble('ai', "Maaf, terjadi kesalahan koneksi saat memproses gejala Anda.");
    }
}

function appendSymptomsChatBubble(sender, text) {
    const container = document.getElementById('symptoms-chat-box');
    if (!container) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = "display: flex; gap: 10px; align-items: start; margin-bottom: 8px;";
    
    if (sender === 'user') {
        msgDiv.style.justifyContent = "flex-end";
        msgDiv.innerHTML = `
            <div style="background: var(--teal); color: #ffffff; padding: 10px 14px; border-radius: 12px; border-top-right-radius: 0; font-size: 11.5px; line-height: 1.45; max-width: 80%; text-align: left; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                ${parseMarkdownToHTML(text)}
            </div>
        `;
    } else {
        msgDiv.innerHTML = `
            <div style="background: var(--teal-light); color: var(--teal); padding: 8px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--teal-border);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px; height:16px;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a3 3 0 00-3-3H9m3 3h3a3 3 0 003-3h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
            <div style="background: #ffffff; border: 1px solid var(--border-soft); padding: 10px 14px; border-radius: 12px; border-top-left-radius: 0; font-size: 11.5px; line-height: 1.45; color: var(--text-1); max-width: 80%; text-align: left; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                ${parseMarkdownToHTML(text)}
            </div>
        `;
    }
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

// Warga AI Consultation Chat
let wargaChatHistory = [];

async function sendWargaChatMessage() {
    const chatInput = document.getElementById('warga-chat-input');
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;
    
    chatInput.value = '';
    
    // Clear initial placeholder if this is the first message
    const chatBox = document.getElementById('warga-chat-box');
    if (chatBox && wargaChatHistory.length === 0) {
        chatBox.innerHTML = '';
    }
    
    appendWargaChatBubble('user', text);
    
    const apiKey = localStorage.getItem("GEMINI_API_KEY");
    if (!apiKey) {
        appendWargaChatBubble('ai', "Sistem AI sedang offline. Silakan hubungkan database atau periksa API key.");
        return;
    }
    
    // Add thinking placeholder
    const thinkingId = 'warga_thinking_' + Date.now();
    if (chatBox) {
        const thinkingBubble = document.createElement('div');
        thinkingBubble.id = thinkingId;
        thinkingBubble.style.cssText = "align-self: flex-start; display: flex; gap: 8px; align-items: center; font-size: 11px; color: var(--text-3); padding-left: 8px; margin-bottom: 8px;";
        thinkingBubble.innerHTML = `<span class="status-dot processing"></span> Gemini sedang mengetik...`;
        chatBox.appendChild(thinkingBubble);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    
    // Build personalized citizen info context
    let citizenInfo = "Informasi Pasien: Warga umum (belum login).\n";
    if (currentSession && currentSession.role === 'warga' && currentSession.data) {
        const p = currentSession.data;
        citizenInfo = `Informasi Pasien Terautentikasi:
- Nama: ${p.name}
- Umur: ${p.age} tahun
- Jenis Kelamin: ${p.gender}
- Riwayat Penyakit Terdaftar: ${p.medical_history || 'Tidak ada catatan'}
- Status Verifikasi Akun: ${p.status}
`;
        try {
            const recordsObj = await firebaseGet("records") || {};
            const records = Object.values(recordsObj).filter(r => r && (r.qr_code === p.qr_code || r.patient_id === p.id));
            if (records.length > 0) {
                // Sort by created_at desc to get the latest
                records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                const latest = records[0];
                citizenInfo += `- Hasil Skrining Terakhir di Booth (${new Date(latest.created_at).toLocaleDateString('id-ID')}):
  * Suhu Dahi: ${latest.body_temp.toFixed(1)} C
  * Status Risiko Asimetri Kaki: ${latest.priority_status || 'NORMAL'}
  * Saran/Summary Bidan Sebelumnya: ${latest.interpretation || 'Normal'}
`;
            }
        } catch (e) {
            console.error("Error fetching latest record for citizen AI chat:", e);
        }
    }
    
    const contextPrompt = `Kamu adalah Asisten Gejala & Kesehatan Mandiri SehatDesa (inspired by AI-HealthCare-Assistant).
Kamu membantu warga desa memahami keluhan kaki dan dahi mereka secara personal berdasarkan data medis mereka.

${citizenInfo}

Percakapan sebelumnya:
${wargaChatHistory.map(c => `${c.role === 'user' ? 'Warga' : 'AI'}: ${c.text}`).join('\n')}

Keluhan/Pertanyaan Warga Baru: "${text}"

Berikan jawaban yang sangat personal (sapa nama warga secara sopan, misalnya: "Mbah Sumi", "Pak Joyo"), ramah, menenangkan, dan mendidik dengan bahasa Indonesia yang sederhana (hindari istilah medis yang rumit) dalam format:
1. Penjelasan Gejala & Risiko Sederhana (sesuaikan dengan kondisi medis & hasil skrining terakhir mereka di atas)
2. Panduan Tindakan Mandiri di Rumah (misal: perawatan luka ringan, meredakan kesemutan kaki diabetes)
3. Saran Pemeriksaan Lebih Lanjut di Booth Balai Desa jika diperlukan
        
Jawablah secara singkat dan padat (maksimal 3-4 kalimat per poin) agar mudah dibaca oleh warga desa lansia.`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: contextPrompt }] }]
            })
        });
        
        // Remove thinking placeholder
        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.remove();
        
        if (res.ok) {
            const data = await res.json();
            const reply = data.candidates[0].content.parts[0].text.trim();
            appendWargaChatBubble('ai', reply);
            wargaChatHistory.push({ role: 'user', text: text });
            wargaChatHistory.push({ role: 'ai', text: reply });
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch(e) {
        console.error("Warga AI error:", e);
        const thinkingEl = document.getElementById(thinkingId);
        if (thinkingEl) thinkingEl.remove();
        appendWargaChatBubble('ai', "Maaf, asisten AI sedang sibuk. Silakan coba kirim ulang pertanyaan Anda.");
    }
}

function appendWargaChatBubble(sender, text) {
    const container = document.getElementById('warga-chat-box');
    if (!container) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = "display: flex; gap: 8px; align-items: start; margin-bottom: 8px; width: 100%;";
    
    if (sender === 'user') {
        msgDiv.style.justifyContent = "flex-end";
        msgDiv.innerHTML = `
            <div style="background: var(--teal); color: #ffffff; padding: 8px 12px; border-radius: 12px; border-top-right-radius: 0; font-size: 11px; line-height: 1.45; max-width: 85%; text-align: left; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                ${parseMarkdownToHTML(text)}
            </div>
        `;
    } else {
        msgDiv.innerHTML = `
            <div style="background: var(--teal-light); color: var(--teal); padding: 6px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--teal-border);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px; height:14px;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a3 3 0 00-3-3H9m3 3h3a3 3 0 003-3h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>
            <div style="background: #ffffff; border: 1px solid var(--border-soft); padding: 8px 12px; border-radius: 12px; border-top-left-radius: 0; font-size: 11px; line-height: 1.45; color: var(--text-1); max-width: 85%; text-align: left; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                ${parseMarkdownToHTML(text)}
            </div>
        `;
    }
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

// ============================================================
//  LAYANAN MANDIRI WARGA WORKSPACE HANDLERS
// ============================================================

// 1. Warga Register (Booth/Booth mode)
async function handleWargaRegister(e) {
    e.preventDefault();
    const name = document.getElementById('warga-nama').value.trim();
    const age = parseInt(document.getElementById('warga-umur').value);
    const gender = document.getElementById('warga-jk').value;
    const nik = document.getElementById('warga-nik').value.trim();
    const phone = document.getElementById('warga-hp').value.trim();
    const address = document.getElementById('warga-alamat').value.trim();
    const medical_history = document.getElementById('warga-keluhan').value.trim();
    const password = document.getElementById('warga-password').value;

    // Helper: show inline alert in reg form
    function showRegAlert(msg, type) {
        const el = document.getElementById('warga-reg-alert');
        if (!el) return;
        el.textContent = msg;
        el.style.display = msg ? 'block' : 'none';
        if (type === 'error') {
            el.style.cssText = 'display:block; padding:10px 12px; border-radius:8px; font-size:11.5px; font-weight:600; line-height:1.5; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#dc2626;';
        } else if (type === 'success') {
            el.style.cssText = 'display:block; padding:10px 12px; border-radius:8px; font-size:11.5px; font-weight:600; line-height:1.5; background:rgba(22,163,74,0.1); border:1px solid rgba(22,163,74,0.3); color:#16a34a;';
        } else {
            el.style.cssText = 'display:block; padding:10px 12px; border-radius:8px; font-size:11.5px; font-weight:600; line-height:1.5; background:rgba(14,165,233,0.1); border:1px solid rgba(14,165,233,0.3); color:#0284c7;';
        }
    }

    // Validate NIK
    if (!/^\d{16}$/.test(nik)) {
        showRegAlert('NIK harus terdiri dari 16 digit angka!', 'error');
        return;
    }

    if (!password || password.length < 4) {
        showRegAlert('Password minimal 4 karakter!', 'error');
        return;
    }

    // Set loading state
    const submitBtn = document.getElementById('warga-reg-submit-btn');
    const submitBtnText = document.getElementById('warga-reg-btn-text');
    if (submitBtn) submitBtn.disabled = true;
    if (submitBtnText) submitBtnText.textContent = 'Mendaftarkan...';
    showRegAlert('Menyimpan data ke server...', 'info');

    try {
        const patientsObj = await firebaseGet('patients') || {};
        const patients = Object.values(patientsObj).filter(Boolean);

        // Check NIK duplicate using nik field first, then address fallback
        for (let p of patients) {
            const pNik = p.nik || '';
            const pAddr = p.address || '';
            if (pNik === nik || pAddr.includes(`(NIK: ${nik})`)) {
                // Pre-fill login form with this NIK
                const loginNikInput = document.getElementById('warga-login-nik');
                if (loginNikInput) loginNikInput.value = nik;
                showRegAlert('NIK ini sudah terdaftar. Silakan login dengan NIK dan password Anda di kolom tengah.', 'error');
                if (submitBtn) submitBtn.disabled = false;
                if (submitBtnText) submitBtnText.textContent = 'Kirim Pendaftaran & Buat QR Code';
                return;
            }
        }

        const qr_code = 'PAS-' + String(Math.floor(10000 + Math.random() * 90000));
        const newPatient = {
            id: qr_code,
            name,
            age,
            gender,
            nik,
            qr_code,
            phone,
            address: address ? `${address} (NIK: ${nik})` : `(NIK: ${nik})`,
            medical_history,
            status: 'PENDING',
            password,
            created_at: new Date().toISOString()
        };

        await firebasePut(`patients/${qr_code}`, newPatient);

        // Auto-login and show QR card immediately
        currentSession = { role: 'warga', data: newPatient };
        sessionStorage.setItem('SAYANGI_SESSION', JSON.stringify(currentSession));

        showRegAlert('✓ Pendaftaran berhasil! Kartu QR Anda ditampilkan di kolom tengah. Hubungi Bidan Desa untuk aktivasi akun.', 'success');

        // Reset form fields
        document.getElementById('warga-reg-form').reset();

        // Render the dashboard/QR panel
        renderWargaPortalDashboard(newPatient, nik);

    } catch(err) {
        console.error(err);
        showRegAlert('Pendaftaran gagal: ' + err.message, 'error');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (submitBtnText) submitBtnText.textContent = 'Kirim Pendaftaran & Buat QR Code';
    }
}

// 2. Citizen Login / Dashboard View Routing
async function doWargaPortalLogin(e) {
    if (e) e.preventDefault();
    const nik = document.getElementById('warga-login-nik').value.trim();
    const password = document.getElementById('warga-login-password').value;

    // Helper: show inline alert in login form
    function showLoginAlert(msg, type) {
        const el = document.getElementById('warga-login-alert');
        if (!el) return;
        el.textContent = msg;
        el.style.display = msg ? 'block' : 'none';
        if (type === 'error') {
            el.style.cssText = 'display:block; padding:10px 12px; border-radius:8px; font-size:11.5px; font-weight:600; line-height:1.5; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#dc2626;';
        } else {
            el.style.cssText = 'display:block; padding:10px 12px; border-radius:8px; font-size:11.5px; font-weight:600; line-height:1.5; background:rgba(14,165,233,0.1); border:1px solid rgba(14,165,233,0.3); color:#0284c7;';
        }
    }

    if (!nik || !password) {
        showLoginAlert('Harap masukkan NIK dan Password!', 'error');
        return;
    }

    if (!/^\d{16}$/.test(nik)) {
        showLoginAlert('NIK harus 16 digit angka!', 'error');
        return;
    }

    // Loading state
    const loginBtn = document.getElementById('warga-login-submit-btn');
    const loginBtnText = document.getElementById('warga-login-btn-text');
    if (loginBtn) loginBtn.disabled = true;
    if (loginBtnText) loginBtnText.textContent = 'Memeriksa data...';
    showLoginAlert('Mencari data NIK di server...', 'info');

    try {
        const patientsObj = await firebaseGet('patients') || {};
        const patients = Object.values(patientsObj).filter(Boolean);

        let foundPatient = null;
        for (let p of patients) {
            // Match by nik field first, then by address string for backwards compatibility
            const pNik = p.nik || '';
            const pAddr = p.address || '';
            if (pNik === nik || pAddr.includes(`(NIK: ${nik})`)) {
                foundPatient = p;
                break;
            }
        }

        if (!foundPatient) {
            showLoginAlert('NIK ini belum terdaftar. Silakan daftar terlebih dahulu di form sebelah kiri.', 'error');
            return;
        }

        if (foundPatient.password !== password) {
            showLoginAlert('Password salah. Silakan coba lagi.', 'error');
            return;
        }

        // Clear alert on success
        showLoginAlert('', '');

        // Save session
        currentSession = { role: 'warga', data: foundPatient };
        sessionStorage.setItem('SAYANGI_SESSION', JSON.stringify(currentSession));

        // Clear login fields
        document.getElementById('warga-login-nik').value = '';
        document.getElementById('warga-login-password').value = '';

        // Render QR + profile card
        renderWargaPortalDashboard(foundPatient, nik);

    } catch (err) {
        console.error(err);
        showLoginAlert('Gagal masuk portal: ' + err.message, 'error');
    } finally {
        if (loginBtn) loginBtn.disabled = false;
        if (loginBtnText) loginBtnText.textContent = 'Masuk ke Portal';
    }
}

function doWargaPortalLogout() {
    sessionStorage.removeItem("SAYANGI_SESSION");
    currentSession = null;
    
    // Hide dashboard, show login form
    const loginCard = document.getElementById('warga-login-card');
    const statusCard = document.getElementById('warga-status-card');
    
    if (loginCard) {
        loginCard.style.setProperty('display', 'flex', 'important');
    }
    if (statusCard) {
        statusCard.style.setProperty('display', 'none', 'important');
    }
    
    // Clear login inputs
    const loginNik = document.getElementById('warga-login-nik');
    const loginPass = document.getElementById('warga-login-password');
    if (loginNik) loginNik.value = '';
    if (loginPass) loginPass.value = '';
}

function renderWargaPortalDashboard(patient, nik) {
    const loginCard = document.getElementById('warga-login-card');
    const statusCard = document.getElementById('warga-status-card');
    
    if (loginCard) {
        loginCard.style.setProperty('display', 'none', 'important');
    }
    if (statusCard) {
        statusCard.style.setProperty('display', 'flex', 'important');
    }
    
    const nameEl = document.getElementById('warga-card-name');
    const nikEl = document.getElementById('warga-card-nik');
    const badgeEl = document.getElementById('warga-status-badge');
    const alertEl = document.getElementById('warga-status-alert');
    const visitsList = document.getElementById('warga-visits-list');
    const qrContainer = document.getElementById('warga-qrcode-container');
    
    if (nameEl) nameEl.textContent = patient.name;
    if (nikEl) nikEl.textContent = `NIK: ${nik}`;
    
    // Generate QR code
    if (qrContainer) {
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
            text: patient.qr_code,
            width: 130,
            height: 130,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }
    
    // Status Badge & Alert Message
    const isApproved = patient.status === 'APPROVED';
    if (badgeEl) {
        badgeEl.textContent = patient.status;
        badgeEl.className = isApproved ? 'verify-badge approved' : 'verify-badge pending';
    }
    
    if (alertEl) {
        if (isApproved) {
            alertEl.style.cssText = "background: rgba(22, 163, 74, 0.1); border: 1px solid var(--green-border); color: var(--green); width: 100%; font-size: 11px; padding: 8px; border-radius: 6px; font-weight: 600; text-align: center; line-height: 1.4;";
            alertEl.innerHTML = `✓ Akun Terverifikasi! Kartu QR Anda aktif dan dapat digunakan untuk skrining di Booth Balai Desa.`;
        } else {
            alertEl.style.cssText = "background: rgba(180, 83, 9, 0.1); border: 1px solid var(--amber-border); color: var(--amber); width: 100%; font-size: 11px; padding: 8px; border-radius: 6px; font-weight: 600; text-align: center; line-height: 1.4;";
            alertEl.innerHTML = `⚠️ Menunggu Verifikasi. Silakan hubungi Bidan Desa untuk menyetujui akun Anda.`;
        }
    }
    
    // Fetch historical visits
    if (visitsList) {
        visitsList.innerHTML = '';
        firebaseGet("records").then(recordsObj => {
            recordsObj = recordsObj || {};
            const records = Object.values(recordsObj).filter(r => r && r.created_at && (r.qr_code === patient.qr_code || r.patient_id === patient.id));
            
            // Sort desc
            records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            if (records.length === 0) {
                visitsList.innerHTML = '<div style="font-size:11px; color:var(--text-3); text-align:center; padding:10px 0; font-style:italic;">Belum ada riwayat kunjungan medis.</div>';
            } else {
                records.forEach((r, idx) => {
                    const date = new Date(r.created_at).toLocaleDateString('id-ID', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    });
                    
                    const item = document.createElement('div');
                    item.className = 'glass-panel';
                    item.style.cssText = "padding: 10px; border-radius: 8px; border: 1px solid var(--border-soft); margin-bottom: 6px; background:#fafbfc; font-size:11px; cursor:pointer;";
                    item.onclick = () => {
                        alert(`Hasil Pemeriksaan (${date}):\n- Suhu Dahi: ${r.body_temp.toFixed(1)}°C\n- Status: ${r.priority_status || 'SELESAI'}\n- Rekomendasi/Saran: ${(r.gemini_summary || 'Tidak ada catatan').replace(/\*\*/g, '')}`);
                    };
                    
                    item.innerHTML = `
                        <div style="display:flex; justify-content:space-between; font-weight:600; color:var(--text-1); margin-bottom:4px;">
                            <span>Kunjungan #${records.length - idx}</span>
                            <span style="color:var(--text-3); font-size:10px;">${date}</span>
                        </div>
                        <div style="color:var(--text-2);">
                            Suhu: <strong style="color:var(--teal);">${r.body_temp.toFixed(1)}°C</strong> | Status: <strong style="color:${r.priority_status === 'CRITICAL' ? 'var(--red)' : 'var(--green)'};">${r.priority_status || 'SELESAI'}</strong>
                        </div>
                    `;
                    visitsList.appendChild(item);
                });
            }
        });
    }
}

// 3. Download QR Code
function downloadWargaQR() {
    const qrContainer = document.getElementById('warga-qrcode-container');
    if (!qrContainer) return;
    const img = qrContainer.querySelector('img');
    if (!img) return;
    const name = document.getElementById('warga-card-name').textContent || 'Warga';
    const link = document.createElement('a');
    link.download = `QR_Sayangi_${name.replace(/\s+/g, '_')}.png`;
    link.href = img.src;
    link.click();
}

// 4. Print QR Card
function printWargaQR() {
    const qrContainer = document.getElementById('warga-qrcode-container');
    if (!qrContainer) return;
    const img = qrContainer.querySelector('img');
    if (!img) return;
    const name = document.getElementById('warga-card-name').textContent || 'Warga';
    const nik = document.getElementById('warga-card-nik').textContent || '';
    
    const win = window.open('', '_blank');
    win.document.write(`
        <html>
        <head>
            <title>Cetak Kartu QR Sayangi</title>
            <style>
                body { font-family: sans-serif; text-align: center; padding: 40px; }
                .card { border: 2px solid #ccc; padding: 20px; border-radius: 12px; display: inline-block; }
                h2 { margin: 10px 0 2px; }
                p { margin: 0 0 15px; color: #666; font-family: monospace; }
            </style>
        </head>
        <body onload="window.print(); window.close();">
            <div class="card">
                <h2>${name}</h2>
                <p>${nik}</p>
                <img src="${img.src}" width="200" height="200" />
            </div>
        </body>
        </html>
    `);
    win.document.close();
}


