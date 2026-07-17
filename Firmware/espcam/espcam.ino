/**
 * ============================================================
 *  ESP32-CAM - Program Sederhana
 *  Fitur:
 *    - Koneksi WiFi (STA Mode)
 *    - Streaming kamera via browser (MJPEG)
 *    - Capture foto via URL
 *    - Flash LED kontrol via URL
 *    - Status sistem via URL /status
 * 
 *  Board: AI Thinker ESP32-CAM
 *  Camera: OV2640 / OV3660
 * 
 *  Cara pakai:
 *    1. Isi SSID dan PASSWORD WiFi Anda
 *    2. Upload ke ESP32-CAM
 *    3. Buka Serial Monitor (115200 baud)
 *    4. Lihat IP address yang tampil
 *    5. Buka browser -> http://<IP_ADDRESS>
 * 
 *  URL yang tersedia:
 *    http://<IP>/          -> Halaman utama + stream
 *    http://<IP>/stream    -> MJPEG stream langsung
 *    http://<IP>/capture   -> Ambil 1 foto (JPEG)
 *    http://<IP>/flash/on  -> Nyalakan flash LED
 *    http://<IP>/flash/off -> Matikan flash LED
 *    http://<IP>/status    -> Info sistem (JSON)
 * ============================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <Adafruit_MLX90614.h>

// ============================================================
//  PIN KONFIGURASI SENSOR & TOMBOL (ESP32-CAM)
//  Menggunakan pin HS2 yang bebas jika tidak memakai SD card
// ============================================================
#define I2C_SDA          14   // GPIO 14 (SDA untuk MLX90614)
#define I2C_SCL          15   // GPIO 15 (SCL untuk MLX90614)
#define BUTTON_PIN       13   // GPIO 13 (Tombol pemicu ukur & kirim)

#define SAMPLE_COUNT     5    // Jumlah sampel pembacaan suhu
#define SAMPLE_DELAY_MS  80   // Jeda pembacaan suhu (ms)
#define OFFSET_SUHU      3.0f // Kalibrasi selisih suhu dahi ke suhu inti tubuh

// ============================================================
//  KONFIGURASI - UBAH SESUAI KEBUTUHAN ANDA
// ============================================================
const char* ssid     = "ori";       // Ganti dengan SSID WiFi Anda
const char* password = "bocik lucu";   // Ganti dengan password WiFi Anda

// ============================================================
//  PIN KONFIGURASI - AI Thinker ESP32-CAM
//  JANGAN DIUBAH kecuali board Anda berbeda
// ============================================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Flash LED bawaan ESP32-CAM
#define FLASH_LED_PIN      4

// ============================================================
//  VARIABEL GLOBAL
// ============================================================
WebServer server(80);
bool flashState = false;
Adafruit_MLX90614 mlx = Adafruit_MLX90614();

// ============================================================
//  FUNGSI: Base64 Encoder untuk Mengirim Citra JPEG via Serial
// ============================================================
const char b64_table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
String base64_encode(uint8_t* data, size_t length) {
    String encodedString = "";
    int i = 0;
    int j = 0;
    unsigned char char_array_3[3];
    unsigned char char_array_4[4];

    while (length--) {
        char_array_3[i++] = *(data++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;

            for(i = 0; (i < 4) ; i++)
                encodedString += b64_table[char_array_4[i]];
            i = 0;
        }
    }

    if (i) {
        for(j = i; j < 3; j++)
            char_array_3[j] = '\0';

        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) + ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) + ((char_array_3[2] & 0xc0) >> 6);
        char_array_4[3] = char_array_3[2] & 0x3f;

        for (j = 0; (j < i + 1); j++)
            encodedString += b64_table[char_array_4[j]];

        while((i++ < 3))
            encodedString += '=';
    }

    return encodedString;
}

// ============================================================
//  FUNGSI: Membaca Suhu Averaging MLX90614
// ============================================================
float bacaSuhuAkurat() {
  float total = 0.0;
  int validSamples = 0;

  Serial.print("[SENSOR] Mengambil data");
  for (int i = 0; i < SAMPLE_COUNT; i++) {
    float sample = mlx.readObjectTempC();
    if (!isnan(sample) && sample > 0.0 && sample < 100.0) {
      total += sample;
      validSamples++;
    }
    Serial.print(".");
    delay(SAMPLE_DELAY_MS);
  }
  Serial.println();

  if (validSamples == 0) return NAN;

  float rataRata = total / validSamples;
  float suhuTubuh = rataRata + OFFSET_SUHU;
  return suhuTubuh;
}

bool isSuhuManusia(float suhu) {
  return (suhu >= 34.0f && suhu <= 42.5f);
}

const char* klasifikasiSuhu(float suhu) {
  if (!isSuhuManusia(suhu)) {
    return "TIDAK VALID - Arahkan sensor ke dahi";
  }
  if (suhu < 35.0f) {
    return "HIPOTERMIA - Darurat medis ekstrem!";
  } else if (suhu < 36.5f) {
    return "SUHU SUBNORMAL - Cenderung rendah, hangatkan tubuh";
  } else if (suhu <= 37.5f) {
    return "NORMAL";
  } else if (suhu < 38.0f) {
    return "SUBFEBRIS - Tubuh hangat, indikasi awal demam";
  } else if (suhu < 39.5f) {
    return "DEMAM (FEBRIS) - Batas demam ringan hingga sedang";
  } else if (suhu < 41.0f) {
    return "DEMAM TINGGI - Butuh penurun panas dan pantauan ketat";
  } else {
    return "HIPERPIREKSIA / HIPERTERMIA - Gawat darurat, otak terancam!";
  }
}

// ============================================================
//  FUNGSI: Mengambil Data Suhu + Citra Kamera dan Mengirim via RX/TX
// ============================================================
void ambilDanKirimData() {
  // 1. Nyalakan flash LED sebentar untuk pencahayaan foto
  digitalWrite(FLASH_LED_PIN, HIGH);
  delay(100);

  // 2. Baca sensor suhu
  float suhu = bacaSuhuAkurat();
  const char* kondisi = klasifikasiSuhu(suhu);

  // 3. Capture foto kamera
  Serial.println("[Kamera] Mengambil foto...");
  camera_fb_t* fb = esp_camera_fb_get();
  
  // Matikan flash setelah foto diambil
  digitalWrite(FLASH_LED_PIN, LOW);

  if (!fb) {
    Serial.println("[Kamera] Gagal mengambil foto!");
    return;
  }

  // 4. Encode gambar JPEG ke Base64
  String b64Image = base64_encode(fb->buf, fb->len);
  
  // Bebaskan framebuffer kembali
  esp_camera_fb_return(fb);

  // 5. Kirim Serial data paket ke ESP Utama via RX/TX
  Serial.println("[DATA_START]");
  Serial.print("suhu:");
  Serial.println(suhu, 2);
  Serial.print("kondisi:");
  Serial.println(kondisi);
  Serial.print("image:data:image/jpeg;base64,");
  Serial.println(b64Image);
  Serial.println("[DATA_END]");

  Serial.println("[SISTEM] Data berhasil terkirim melalui UART RX/TX.");
}

// ============================================================
//  FUNGSI: Inisialisasi Kamera
// ============================================================
bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;         // 20MHz clock
  config.pixel_format = PIXFORMAT_JPEG;   // Format JPEG untuk streaming

  // Resolusi QQVGA (160x120) selalu digunakan agar preview TFT cepat.
  // Resolusi kecil = JPEG kecil (~3-8KB) = fetch cepat oleh ESP32-S3.
  config.frame_size   = FRAMESIZE_QQVGA; // 160x120
  config.jpeg_quality = 10;              // Kualitas bagus, file tetap kecil
  config.fb_count     = psramFound() ? 2 : 1;
  Serial.println("[Kamera] Resolusi QQVGA (160x120) untuk preview TFT");

  // Inisialisasi kamera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ERROR] Kamera gagal init: 0x%x\n", err);
    return false;
  }

  // Pengaturan sensor kamera (opsional, bisa disesuaikan)
  sensor_t* s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 0);    // -2 sampai 2
    s->set_contrast(s, 0);      // -2 sampai 2
    s->set_saturation(s, 0);    // -2 sampai 2
    s->set_sharpness(s, 0);     // -2 sampai 2
    s->set_whitebal(s, 1);      // 1 = aktifkan auto white balance
    s->set_awb_gain(s, 1);      // 1 = aktifkan AWB gain
    s->set_exposure_ctrl(s, 1); // 1 = aktifkan auto exposure
    s->set_gain_ctrl(s, 1);     // 1 = aktifkan auto gain
    s->set_hmirror(s, 0);       // 0 = normal, 1 = mirror horizontal
    s->set_vflip(s, 0);         // 0 = normal, 1 = flip vertikal
  }

  Serial.println("[Kamera] Inisialisasi berhasil!");
  return true;
}

// ============================================================
//  HANDLER: Halaman Utama — Menu Pilihan
// ============================================================
void handleRoot() {
  String ip = WiFi.localIP().toString();
  String res = psramFound() ? "VGA (640x480)" : "QVGA (320x240)";
  String h = "<!DOCTYPE html><html><head>";
  h += "<meta charset='UTF-8'>";
  h += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  h += "<title>Sayangi Booth</title>";
  h += "<style>*{box-sizing:border-box;margin:0;padding:0;}";
  h += "body{background:#0d1117;color:#e6edf3;font-family:Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;}";
  h += ".logo{font-size:26px;font-weight:700;color:#00c896;margin-bottom:4px;letter-spacing:-0.5px;}";
  h += ".logo span{color:#e6edf3;}";
  h += ".tagline{color:#8b949e;font-size:13px;margin-bottom:32px;}";
  h += ".cards{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;max-width:600px;width:100%;}";
  h += ".card{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:28px 24px;";
  h += "      flex:1;min-width:200px;max-width:260px;cursor:pointer;transition:all .2s;text-decoration:none;color:inherit;}";
  h += ".card:hover{border-color:#00c896;transform:translateY(-3px);box-shadow:0 8px 30px rgba(0,200,150,.15);}";
  h += ".card.red:hover{border-color:#e94560;box-shadow:0 8px 30px rgba(233,69,96,.15);}";
  h += ".cico{font-size:44px;margin-bottom:12px;}";
  h += ".ctit{font-size:17px;font-weight:700;margin-bottom:6px;}";
  h += ".cdesc{font-size:12px;color:#8b949e;line-height:1.5;}";
  h += ".info{margin-top:28px;background:#161b22;border:1px solid #30363d;border-radius:10px;";
  h += "      padding:12px 20px;font-size:12px;color:#8b949e;text-align:center;}";
  h += ".dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#00c896;margin-right:6px;animation:pulse 2s infinite;}";
  h += "@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.3;}}";
  h += "</style></head><body>";
  h += "<div class='logo'>Sayangi<span>Booth</span> <span style='color:#8b949e;font-size:14px;font-weight:400;'>Station</span></div>";
  h += "<div class='tagline'>ESP32-CAM | IP: " + ip + " | " + res + "</div>";
  h += "<div class='cards'>";
  // Kartu 1: Verifikasi Identitas
  h += "<a class='card' href='/scan'>";
  h += "<div class='cico'>&#128247;</div>";
  h += "<div class='ctit'>Verifikasi Identitas</div>";
  h += "<div class='cdesc'>Scan QR Code peserta untuk memverifikasi data identitas dari Firebase</div>";
  h += "</a>";
  // Kartu 2: Live Stream
  h += "<a class='card red' href='/stream-page'>";
  h += "<div class='cico'>&#127909;</div>";
  h += "<div class='ctit'>Live Stream</div>";
  h += "<div class='cdesc'>Lihat tampilan kamera langsung (MJPEG stream)</div>";
  h += "</a>";
  h += "</div>";
  h += "<div class='info'>";
  h += "<span class='dot'></span>Sistem aktif &nbsp;|&nbsp; ";
  h += "Flash: " + String(flashState ? "ON" : "OFF") + " &nbsp;|&nbsp; ";
  h += "PSRAM: " + String(psramFound() ? "Ada" : "Tidak") + " &nbsp;|&nbsp; ";
  h += "Uptime: <span id='up'>-</span>";
  h += "<script>setInterval(function(){var s=Math.floor(Date.now()/1000);";
  h += "fetch('/status').then(function(r){return r.json();}).then(function(d){";
  h += "var u=Math.floor(d.uptime_ms/1000);var m=Math.floor(u/60);var s2=u%60;";
  h += "document.getElementById('up').textContent=m+'m '+s2+'s';}).catch(function(){});";
  h += "},5000);</script>";
  h += "</div></body></html>";
  server.send(200, "text/html", h);
}

// ============================================================
//  HANDLER: Halaman Stream Terpisah
// ============================================================
void handleStreamPage() {
  String ip = WiFi.localIP().toString();
  String h = "<!DOCTYPE html><html><head>";
  h += "<meta charset='UTF-8'>";
  h += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  h += "<title>SehatDesa Live Stream</title>";
  h += "<style>*{box-sizing:border-box;margin:0;padding:0;}";
  h += "body{background:#0d1117;color:#e6edf3;font-family:Arial,sans-serif;text-align:center;padding:16px;}";
  h += ".top{display:flex;align-items:center;gap:12px;max-width:640px;margin:0 auto 14px;text-align:left;}";
  h += ".back{background:#1f2937;color:#e6edf3;border:none;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:14px;text-decoration:none;display:inline-block;}";
  h += ".back:hover{background:#374151;}";
  h += "h1{color:#00c896;font-size:18px;}";
  h += "img#sv{width:100%;max-width:640px;border:2px solid #30363d;border-radius:10px;display:block;margin:0 auto;}";
  h += ".btns{margin:12px 0;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}";
  h += ".btn{padding:9px 18px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;text-decoration:none;display:inline-block;}";
  h += ".bg{background:#00c896;color:#000;}.by{background:#d29922;color:#000;}.br{background:#555;color:#fff;}";
  h += "</style></head><body>";
  h += "<div class='top'>";
  h += "<a class='back' href='/'>&#8592; Kembali</a>";
  h += "<h1>Live Stream Kamera</h1>";
  h += "</div>";
  h += "<img id='sv' src='/stream' alt='Stream'>";
  h += "<div class='btns'>";
  h += "<a class='btn bg' href='/capture' target='_blank'>&#128247; Ambil Foto</a>";
  h += "<button class='btn by' onclick=\"fetch('/flash/on')\">&#128294; Flash ON</button>";
  h += "<button class='btn br' onclick=\"fetch('/flash/off')\">Flash OFF</button>";
  h += "</div>";
  h += "<p style='color:#8b949e;font-size:12px;'>IP: " + ip + "</p>";
  h += "</body></html>";
  server.send(200, "text/html", h);
}

// ============================================================
//  HANDLER: MJPEG Stream
// ============================================================
void handleStream() {
  WiFiClient client = server.client();

  // Kirim header multipart untuk MJPEG
  String boundary = "frame";
  client.println("HTTP/1.1 200 OK");
  client.println("Access-Control-Allow-Origin: *"); // Dukungan CORS untuk Web Dashboard
  client.println("Content-Type: multipart/x-mixed-replace;boundary=" + boundary);
  client.println("Cache-Control: no-cache");
  client.println("Connection: close");
  client.println();

  Serial.println("[Stream] Klien terhubung, mulai streaming...");

  while (client.connected()) {
    // Ambil frame dari kamera
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[ERROR] Gagal ambil frame kamera");
      break;
    }

    // Kirim header frame
    client.println("--" + boundary);
    client.println("Content-Type: image/jpeg");
    client.printf("Content-Length: %d\r\n\r\n", fb->len);

    // Kirim data frame
    client.write(fb->buf, fb->len);
    client.println();

    // Kembalikan frame buffer ke kamera
    esp_camera_fb_return(fb);

    // Sedikit delay agar tidak terlalu cepat
    delay(50); // ~20 FPS maksimum
  }

  Serial.println("[Stream] Klien terputus");
}

// ============================================================
//  HANDLER: Ambil 1 Foto (JPEG)
// ============================================================
void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(500, "text/plain", "Gagal mengambil foto dari kamera!");
    Serial.println("[ERROR] Capture gagal");
    return;
  }

  // Kirim gambar JPEG langsung ke browser
  server.sendHeader("Access-Control-Allow-Origin", "*"); // Dukungan CORS
  server.sendHeader("Content-Disposition", "inline; filename=foto.jpg");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);

  esp_camera_fb_return(fb);
  Serial.println("[Capture] Foto berhasil diambil!");
}

// ============================================================
//  HANDLER: Kontrol Flash LED
// ============================================================
void handleFlashOn() {
  flashState = true;
  digitalWrite(FLASH_LED_PIN, HIGH);
  server.sendHeader("Access-Control-Allow-Origin", "*"); // Dukungan CORS
  server.sendHeader("Location", "/");
  server.send(302, "text/plain", "");
  Serial.println("[Flash] LED ON");
}

void handleFlashOff() {
  flashState = false;
  digitalWrite(FLASH_LED_PIN, LOW);
  server.sendHeader("Access-Control-Allow-Origin", "*"); // Dukungan CORS
  server.sendHeader("Location", "/");
  server.send(302, "text/plain", "");
  Serial.println("[Flash] LED OFF");
}

// ============================================================
//  HANDLER: Status Sistem (JSON)
// ============================================================
void handleStatus() {
  String json = "{";
  json += "\"board\":\"AI Thinker ESP32-CAM\",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"mac\":\"" + WiFi.macAddress() + "\",";
  json += "\"ssid\":\"" + WiFi.SSID() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"psram\":" + String(psramFound() ? "true" : "false") + ",";
  json += "\"psram_size\":" + String(ESP.getPsramSize()) + ",";
  json += "\"free_heap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"flash_state\":" + String(flashState ? "true" : "false") + ",";
  json += "\"uptime_ms\":" + String(millis());
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
  Serial.println("[Status] Info sistem dikirim");
}

// ============================================================
//  HANDLER: QR Scanner — retry, timeout, progress steps
// ============================================================
void handleScan() {
  String ip = WiFi.localIP().toString();
  String h = "<!DOCTYPE html><html><head>";
  h += "<meta charset='UTF-8'>";
  h += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  h += "<title>SehatDesa QR Scanner</title>";
  h += "<script src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'></script>";
  h += "<style>*{box-sizing:border-box;margin:0;padding:0;}";
  h += "body{background:#0d1117;color:#e6edf3;font-family:Arial,sans-serif;text-align:center;padding:16px;}";
  h += "h1{color:#00c896;font-size:20px;margin-bottom:2px;}.sub{color:#8b949e;font-size:12px;margin-bottom:14px;}";
  h += "img#pv{width:100%;max-width:440px;border:2px solid #30363d;border-radius:10px;display:block;margin:0 auto 10px;}";
  h += ".btn{display:inline-block;margin:5px;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:700;}";
  h += ".bg{background:#00c896;color:#000;}.bg:hover{background:#00a87e;}.bb{background:#1f2937;color:#e6edf3;}";
  h += ".btn:disabled{opacity:.4;cursor:not-allowed;}";
  h += "#steps{max-width:440px;margin:10px auto;display:none;}";
  h += ".step{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;margin-bottom:5px;font-size:13px;background:#161b22;border:1px solid #30363d;text-align:left;transition:all .3s;}";
  h += ".act{border-color:#d29922;color:#d29922;}.dn{border-color:#3fb950;color:#3fb950;}.fl{border-color:#f85149;color:#f85149;}";
  h += ".sp{width:14px;height:14px;border:2px solid rgba(210,153,34,.3);border-top-color:#d29922;border-radius:50%;animation:sp .7s linear infinite;flex-shrink:0;}";
  h += "@keyframes sp{to{transform:rotate(360deg);}}";
  h += "#st{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:11px;max-width:440px;margin:10px auto;font-size:13px;transition:all .3s;}";
  h += "#cok{display:none;background:rgba(63,185,80,.1);border:2px solid #3fb950;border-radius:12px;padding:18px;max-width:440px;margin:10px auto;text-align:left;}";
  h += ".ot{text-align:center;margin-bottom:10px;}.oic{font-size:40px;}.otit{font-size:22px;font-weight:700;color:#3fb950;}.onm{font-size:18px;font-weight:700;margin:8px 0 2px;}";
  h += ".ir{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:13px;}.il{color:#8b949e;}.iv{font-weight:600;}";
  h += "#cfl{display:none;background:rgba(248,81,73,.08);border:2px solid #f85149;border-radius:12px;padding:18px;max-width:440px;margin:10px auto;text-align:center;}";
  h += ".fico{font-size:40px;margin-bottom:6px;}.ftit{font-size:20px;font-weight:700;color:#f85149;margin-bottom:6px;}.fsub{color:#8b949e;font-size:13px;line-height:1.6;}";
  h += "canvas{display:none;}.topbar{display:flex;align-items:center;gap:10px;max-width:440px;margin:0 auto 12px;}</style></head><body>";
  h += "<div class='topbar'>";
  h += "<a href='/' class='btn bb' style='padding:7px 14px;font-size:13px;text-decoration:none;'>&#8592; Menu</a>";
  h += "<h1 style='font-size:17px;'>SehatDesa QR Scanner</h1></div>";
  h += "<p class='sub'>ESP32-CAM &nbsp;|&nbsp; " + ip + "</p>";
  h += "<img id='pv' src='/capture' alt='Preview'><br>";
  h += "<button class='btn bg' id='cb' onclick='go()'>&#128247; Capture &amp; Scan</button>";
  h += "<button class='btn bb' onclick='rpv()'>&#128260; Refresh</button>";
  h += "<a class='btn bb' href='/'>&#8592; Menu Utama</a>";
  h += "<div id='steps'>";
  h += "<div class='step' id='s1'><span id='i1'>&#9675;</span>&nbsp;<span id='t1'>Nyalakan flash LED</span></div>";
  h += "<div class='step' id='s2'><span id='i2'>&#9675;</span>&nbsp;<span id='t2'>Ambil foto dari kamera</span></div>";
  h += "<div class='step' id='s3'><span id='i3'>&#9675;</span>&nbsp;<span id='t3'>Decode QR Code</span></div>";
  h += "<div class='step' id='s4'><span id='i4'>&#9675;</span>&nbsp;<span id='t4'>Verifikasi ke Firebase</span></div>";
  h += "</div>";
  h += "<div id='st'>Siap &mdash; klik Capture untuk memulai.</div>";
  h += "<div id='cok'><div class='ot'><div class='oic'>&#9989;</div><div class='otit'>PESERTA TERDAFTAR</div></div>";
  h += "<div class='onm' id='rnm'></div><div style='margin-top:8px;'>";
  h += "<div class='ir'><span class='il'>NIK</span><span class='iv' id='rni'></span></div>";
  h += "<div class='ir'><span class='il'>Tgl Lahir</span><span class='iv' id='rtg'></span></div>";
  h += "<div class='ir'><span class='il'>Jenis Kelamin</span><span class='iv' id='rjk'></span></div>";
  h += "<div class='ir'><span class='il'>No. HP</span><span class='iv' id='rhp'></span></div>";
  h += "<div class='ir'><span class='il'>Alamat</span><span class='iv' id='ral'></span></div>";
  h += "<div class='ir'><span class='il'>Keluhan</span><span class='iv' id='rkl'></span></div>";
  h += "<div class='ir'><span class='il'>Total Scan</span><span class='iv' id='rsc'></span></div>";
  h += "</div><div style='text-align:center;margin-top:12px;display:flex;gap:8px;justify-content:center;'>";
  h += "<button class='btn bg' onclick='rst()'>&#128247; Scan Berikutnya</button>";
  h += "<a class='btn bb' href='/'>&#8592; Menu Utama</a>";
  h += "</div></div>";
  h += "<div id='cfl'><div class='fico'>&#10060;</div>";
  h += "<div class='ftit' id='ftt'>GAGAL</div>";
  h += "<div class='fsub' id='fsb'></div>";
  h += "<div style='margin-top:12px;'><button class='btn bg' onclick='rst()'>&#128247; Coba Lagi</button></div></div>";
  h += "<canvas id='cv'></canvas>";
  h += "<script>";
  h += "var FB_URL='https://sayangi-614e3-default-rtdb.asia-southeast1.firebasedatabase.app';";
  h += "var FB_AUTH='JfNq9H4mZwrnRMbOFu94ClHKPRFeOxdFiTjttWS';";
  h += "var FBPATH='/peserta';";
  h += "var RETRY=0,MAX=3;";
  h += "function sp(n,cls,ico,tx){var e=document.getElementById('s'+n);e.className='step'+(cls?' '+cls:'');";
  h += "document.getElementById('i'+n).innerHTML=ico;if(tx)document.getElementById('t'+n).textContent=tx;}";
  h += "function sa(n,tx){sp(n,'act','<div class=sp></div>',tx);}";
  h += "function sd(n,tx){sp(n,'dn','\\u2714',tx);}";
  h += "function sf(n,tx){sp(n,'fl','\\u2716',tx);}";
  h += "function sw(n){sp(n,'','\\u25CB',null);}";
  h += "function sst(m,c){var e=document.getElementById('st');e.innerHTML=m;e.style.borderColor=c||'#30363d';e.style.color=c||'#e6edf3';}";
  h += "function rpv(){document.getElementById('pv').src='/capture?t='+Date.now();}";
  h += "function rst(){document.getElementById('cok').style.display='none';document.getElementById('cfl').style.display='none';";
  h += "document.getElementById('steps').style.display='none';[1,2,3,4].forEach(sw);RETRY=0;";
  h += "sst('Siap &mdash; klik Capture untuk memulai.','');document.getElementById('cb').disabled=false;rpv();}";
  h += "function fail(tit,sub){document.getElementById('ftt').textContent=tit;document.getElementById('fsb').textContent=sub;";
  h += "document.getElementById('cfl').style.display='block';document.getElementById('cb').disabled=false;}";
  h += "function doFirebase(fbId){sa(4,'Verifikasi ke Firebase...');sst('Memeriksa database peserta...','#00c896');";
  h += "var c=new AbortController(),t=setTimeout(function(){c.abort();},8000);";
  h += "fetch(FB_URL+FBPATH+'/'+fbId+'.json?auth='+FB_AUTH,{signal:c.signal})";
  h += ".then(function(r){clearTimeout(t);return r.json();})";
  h += ".then(function(d){";
  h += "if(d&&d.nama){fetch('/result?id='+encodeURIComponent(fbId));var nc=(d.scan_count||0)+1;sd(4,'Peserta ditemukan!');";
  h += "document.getElementById('rnm').textContent=d.nama||'-';";
  h += "document.getElementById('rni').textContent=d.nik||'-';";
  h += "document.getElementById('rtg').textContent=d.tgl_lahir||'-';";
  h += "document.getElementById('rjk').textContent=d.jenis_kelamin||'-';";
  h += "document.getElementById('rhp').textContent=d.no_hp||'-';";
  h += "document.getElementById('ral').textContent=d.alamat||'-';";
  h += "document.getElementById('rkl').textContent=d.keluhan||'(tidak ada)';";
  h += "document.getElementById('rsc').textContent=nc+'x';";
  h += "document.getElementById('cok').style.display='block';document.getElementById('cb').disabled=false;";
  h += "sst('\\u2705 Verifikasi berhasil!','#3fb950');";
  h += "fetch(FB_URL+FBPATH+'/'+fbId+'.json?auth='+FB_AUTH,{method:'PATCH',headers:{'Content-Type':'application/json'},";
  h += "body:JSON.stringify({scan_count:nc,last_scan_at:new Date().toISOString(),last_scan_source:'esp32cam'})});";
  h += "} else {sf(4,'ID tidak ditemukan');fail('TIDAK TERDAFTAR','QR terbaca tapi ID tidak ditemukan di Firebase. Peserta belum mendaftar.');";
  h += "sst('\\u274C ID tidak ditemukan.','#f85149');}})";
  h += ".catch(function(e){clearTimeout(t);sf(4,'Gagal konek Firebase');";
  h += "var m=e.name==='AbortError'?'Timeout 8 detik - cek internet HP/laptop.':'Error: '+e.message;";
  h += "fail('GAGAL KONEK FIREBASE',m);sst('\\u274C '+m,'#f85149');});}";
  h += "function doDecode(img){sd(2,'Foto berhasil');sa(3,'Mendecode QR...');sst('Mencari QR Code di foto...','#d29922');";
  h += "var cv=document.getElementById('cv');cv.width=img.naturalWidth;cv.height=img.naturalHeight;";
  h += "var ctx=cv.getContext('2d');ctx.drawImage(img,0,0);var d=ctx.getImageData(0,0,cv.width,cv.height);";
  h += "var code=jsQR(d.data,d.width,d.height,{inversionAttempts:'attemptBoth'});";
  h += "if(code){sd(3,'QR terdeteksi!');var raw=code.data;";
  h += "var fbId=raw.startsWith('SEHATDESA:')?raw.replace('SEHATDESA:',''):raw;doFirebase(fbId);}";
  h += "else{sf(3,'QR tidak terbaca');RETRY++;";
  h += "if(RETRY<MAX){sst('QR tidak terdeteksi. Retry '+RETRY+'/'+MAX+' dalam 1.5 detik...','#d29922');";
  h += "setTimeout(function(){doCapture(true);},1500);}";
  h += "else{sf(4,'Dibatalkan');fail('QR TIDAK TERBACA','Sudah '+MAX+'x dicoba. Pastikan: QR jelas, tidak buram, jarak 10-20cm, cahaya cukup.');";
  h += "sst('\\u274C QR gagal '+MAX+' percobaan.','#f85149');}}}";
  h += "function doCapture(isR){";
  h += "var lbl=isR?'Retry foto ('+(RETRY+1)+'/'+MAX+')':'Mengambil foto dari kamera...';";
  h += "sa(2,lbl);sst((isR?'Retry... ':'')+'Menunggu ESP32-CAM (maks 8 detik)...','#d29922');";
  h += "var img=new Image();img.crossOrigin='anonymous';";
  h += "var ft=setTimeout(function(){img.src='';RETRY++;";
  h += "if(RETRY<MAX){sf(2,'Timeout, retry '+RETRY+'/'+MAX);";
  h += "sst('ESP32 lambat merespons. Retry dalam 2 detik...','#d29922');setTimeout(function(){doCapture(true);},2000);}";
  h += "else{sf(2,'Timeout');sf(3,'Dibatalkan');sf(4,'Dibatalkan');";
  h += "fail('ESP32-CAM TIDAK MERESPONS','Kamera timeout '+MAX+'x. Kemungkinan ESP32 sibuk streaming. Solusi: tutup halaman stream, refresh ini, atau restart ESP32.');";
  h += "sst('\\u274C Timeout! Restart ESP32.','#f85149');}},8000);";
  h += "img.onload=function(){clearTimeout(ft);document.getElementById('pv').src=img.src;fetch('/flash/off');doDecode(img);};";
  h += "img.onerror=function(){clearTimeout(ft);RETRY++;";
  h += "if(RETRY<MAX){sf(2,'Koneksi gagal, retry '+RETRY+'/'+MAX);";
  h += "sst('Gagal sambung ESP32. Retry dalam 2 detik...','#d29922');setTimeout(function(){doCapture(true);},2000);}";
  h += "else{sf(2,'Tidak bisa konek');sf(3,'Dibatalkan');sf(4,'Dibatalkan');";
  h += "fail('KAMERA TIDAK BISA DIJANGKAU','Tidak bisa terhubung ke ESP32-CAM. Pastikan WiFi sama. IP ESP32: ' + ip + '');";
  h += "sst('\\u274C Situs tidak bisa dijangkau! Cek WiFi.','#f85149');}};";
  h += "img.src='/capture?t='+Date.now();}";
  h += "function go(){document.getElementById('cb').disabled=true;";
  h += "document.getElementById('cok').style.display='none';document.getElementById('cfl').style.display='none';";
  h += "document.getElementById('steps').style.display='block';RETRY=0;[1,2,3,4].forEach(sw);";
  h += "sa(1,'Menyalakan flash LED...');sst('Menyalakan flash...','#d29922');";
  h += "fetch('/flash/on').then(function(){sd(1,'Flash menyala');setTimeout(function(){doCapture(false);},400);})";
  h += ".catch(function(){sf(1,'Flash gagal (lanjut)');setTimeout(function(){doCapture(false);},200);});}";
  h += "</script></body></html>";
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/html", h);
}
// Global variable for HTTP communication
String latest_qr = "";

// ============================================================
//  HANDLER: Log ID ke Serial Monitor (dipanggil dari browser)
// ============================================================
void handleResult() {
  if (!server.hasArg("id")) {
    server.send(400, "text/plain", "Missing: id");
    return;
  }
  String fbId = server.arg("id");

  // ── Emit structured QR packet to main ESP32-S3 via UART TX ────────────
  // Main board (sketch_jul17a) listens on Serial1 GPIO40 for this format.
  // Include full "SEHATDESA:" prefix so the main board gets the full ID.
  latest_qr = "SEHATDESA:" + fbId; // Simpan untuk diambil via HTTP oleh S3
  
  Serial.println("[QR_START]");
  Serial.print("id:");
  Serial.println("SEHATDESA:" + fbId);
  Serial.println("[QR_END]");

  // Debug log (also appears in Arduino Serial Monitor via USB)
  Serial.println("============================================");
  Serial.println("[QR SCAN] Firebase ID : " + fbId);
  Serial.println("[QR SCAN] QR String   : SEHATDESA:" + fbId);
  Serial.println("[QR SCAN] Waktu       : " + String(millis()) + " ms");
  Serial.println("============================================");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "{\"ok\":true}");
}


// ============================================================
//  HANDLER: /verify — redirect ke /scan (fallback)
// ============================================================
void handleVerify() {
  String id = server.hasArg("id") ? server.arg("id") : "(tidak ada)";
  server.sendHeader("Location", "/scan");
  server.send(302, "text/plain", "");
  Serial.println("[Verify] Redirect ke /scan, ID: " + id);
}

// ============================================================
//  HANDLER: /get-data — Mengirim data Suhu dan QR ke ESP32-S3 via WiFi
// ============================================================
void handleGetData() {
  float suhu = mlx.readObjectTempC();
  if (!isnan(suhu) && suhu > 0 && suhu < 100) {
    suhu += OFFSET_SUHU;
  } else {
    suhu = 0; // Invalid
  }
  
  String json = "{\"qr\":\"" + latest_qr + "\", \"temp\":" + String(suhu) + "}";
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
  
  latest_qr = ""; // Reset setelah dikirim agar tidak dibaca berkali-kali
}

// ============================================================
//  SETUP - Jalankan sekali saat booting
// ============================================================
void setup() {
  Serial.begin(115200);
  Serial.println("\n\n=== ESP32-CAM Program Sederhana ===");
  Serial.println("Versi: 1.0 | Board: AI Thinker ESP32-CAM");

  // Setup Flash LED
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);
  Serial.println("[Setup] Flash LED siap");

  // --- Inisialisasi I2C & Sensor MLX90614 ---
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setTimeOut(200);
  if (mlx.begin(0x5A, &Wire)) {
    Serial.printf("[SENSOR] ✓ MLX90614 ditemukan pada SDA:%d, SCL:%d\n", I2C_SDA, I2C_SCL);
  } else {
    Serial.println("[SENSOR] ✗ MLX90614 GAGAL diinisialisasi! Cek pin SDA/SCL.");
  }

  // --- Inisialisasi Tombol pemicu ---
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  Serial.printf("[Setup] Tombol pemicu siap pada GPIO %d (tekan untuk kirim data)\n", BUTTON_PIN);

  // Inisialisasi kamera
  if (!initCamera()) {
    Serial.println("[FATAL] Kamera gagal! Program berhenti.");
    // Kedipkan LED pertanda error
    while (true) {
      digitalWrite(FLASH_LED_PIN, HIGH);
      delay(200);
      digitalWrite(FLASH_LED_PIN, LOW);
      delay(200);
    }
  }

  // Koneksi ke WiFi
  Serial.printf("[WiFi] Menghubungkan ke '%s'", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int wifiTimeout = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    wifiTimeout++;
    if (wifiTimeout > 30) { // Timeout 15 detik
      Serial.println("\n[ERROR] WiFi gagal terhubung! Cek SSID/Password.");
      Serial.println("[INFO] Restart dalam 5 detik...");
      delay(5000);
      ESP.restart();
    }
  }

  Serial.println("\n[WiFi] Terhubung!");
  Serial.print("[WiFi] IP Address: ");
  Serial.println(WiFi.localIP());
  Serial.print("[WiFi] Signal RSSI: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");

  // ── Broadcast IP to main ESP32-S3 via Serial (UART TX -> GPIO40) ──────
  // Format: [CAM_IP:x.x.x.x] — parsed by readCamSerial() on the main board.
  // Repeat 3x with delay to ensure main board has booted and is listening.
  for (int i = 0; i < 3; i++) {
    Serial.print("[CAM_IP:");
    Serial.print(WiFi.localIP().toString());
    Serial.println("]");
    delay(500);
  }
  Serial.println("[CAM] IP telah dikirim ke ESP32-S3 via UART.");

  // Daftarkan semua URL handler
  server.on("/",            handleRoot);
  server.on("/stream-page", handleStreamPage); // Halaman stream terpisah
  server.on("/stream",      handleStream);
  server.on("/capture",     handleCapture);
  server.on("/flash/on",    handleFlashOn);
  server.on("/flash/off",   handleFlashOff);
  server.on("/status",      handleStatus);
  server.on("/scan",        handleScan);       // QR Scanner + verifikasi
  server.on("/result",      handleResult);     // Log ID ke Serial
  server.on("/verify",      handleVerify);     // Fallback redirect

  // Handler jika URL tidak ditemukan
  server.onNotFound([]() {
    server.send(404, "text/plain", "URL tidak ditemukan. Tersedia: /  /stream  /capture  /scan  /status");
  });

  // Mulai web server
  server.begin();
  Serial.println("[Server] Web server aktif!");
  Serial.println("==========================================");
  Serial.println("Buka browser dan ketik salah satu URL:");
  Serial.println("  http://" + WiFi.localIP().toString() + "/         -> Halaman utama");
  Serial.println("  http://" + WiFi.localIP().toString() + "/stream    -> Stream langsung");
  Serial.println("  http://" + WiFi.localIP().toString() + "/capture   -> Ambil foto");
  Serial.println("  http://" + WiFi.localIP().toString() + "/status    -> Info sistem");
  Serial.println("==========================================\n");

  // Kedipkan LED 3x pertanda siap
  for (int i = 0; i < 3; i++) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(100);
    digitalWrite(FLASH_LED_PIN, LOW);
    delay(100);
  }
}

// ============================================================
//  LOOP - Jalan terus-menerus
// ============================================================
void loop() {
  server.handleClient(); // Proses request dari browser

  // Cek penekanan tombol fisik (Active LOW)
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(50); // Debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      // Tunggu tombol dilepaskan
      while (digitalRead(BUTTON_PIN) == LOW) {
        delay(10);
      }
      Serial.println("[SISTEM] Tombol ditekan! Memulai proses rekam & kirim data...");
      ambilDanKirimData();
    }
  }

  // Cek koneksi WiFi setiap 30 detik, reconnect jika putus
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck > 30000) {
    lastCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Koneksi terputus! Mencoba reconnect...");
      WiFi.reconnect();
    }
  }

  // Broadcast IP setiap 5 detik agar ESP32-S3 tidak ketinggalan data
  static unsigned long lastIPBroadcast = 0;
  if (millis() - lastIPBroadcast > 5000) {
    lastIPBroadcast = millis();
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("[CAM_IP:");
      Serial.print(WiFi.localIP().toString());
      Serial.println("]");
    }
  }
}