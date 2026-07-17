  // =====================================================================
  //  THERMAL MONITOR v4.1 (DIABETIC FOOT SCREENING EDITION)
  //  ESP32-S3 + MLX90640 + ILI9488 TFT 480x320 (SPI)
  //  >> Push Button Capture (GPIO 38) — Non-Streaming
  //  >> Firebase Base64 BMP 160x120 Bilinear Upscale Upload
  //  >> HARD TIMEOUT LOCK: I2C Timeout dikunci 100ms (Garansi Bebas Stuck)
  //  >> TX POWER LIMIT: Batasi daya WiFi ke 8.5dBm untuk cegah drop tegangan
  //  >> UI: Layout v4.1 Premium (ECG Live Wave, Status, Colorbar, Uptime)
  // =====================================================================

  #include <Arduino_GFX_Library.h>
  #include <Adafruit_MLX90640.h>
  #include <Wire.h>
  #include <math.h>
  #include <WiFi.h>
  #include <HTTPClient.h>
  #include <WiFiClientSecure.h> 
  #include <esp_task_wdt.h>  // Menonaktifkan Watchdog Timer
#include <TJpg_Decoder.h>

  // =====================================================================
  //  KONFIGURASI WiFi & FIREBASE
  // =====================================================================
  bool SEND_TO_FIREBASE = true; 
  const char* WIFI_SSID = "ori";   
  const char* WIFI_PASS = "bocik lucu";   
  #define FIREBASE_HOST "https://sayangi-614e3-default-rtdb.asia-southeast1.firebasedatabase.app/"
  #define FIREBASE_AUTH "JfNq9H4mZwrnRMbOFu94ClHKPRFeOxdFiTjttWS"

  #define ENABLE_DFPLAYER 0

  // ── Pinout TFT ────────────────────────────────────────────────────────
  #define TFT_CS   15
  #define TFT_DC    2
  #define TFT_RST   4
  #define TFT_SCK  13
  #define TFT_MOSI 11
  #define TFT_MISO 12

  // ── Pinout I2C Sensor ─────────────────────────────────────────────────
  #define I2C_SDA  8
  #define I2C_SCL  9
  #define MLX_ADDR 0x33

  // PIN PUSH BUTTON UTAMA (Diganti ke RX2 karena pin 38 tidak ada di board custom)
  #define BTN_PIN RX2

  // LED status (Dipindah agar tidak bentrok dengan RX2/TX2)
  #define LED_GREEN  40
  #define LED_YELLOW 41
  #define LED_RED    42

  // ESP32-CAM UART Link (replaces unused DFPlayer pins)
  // Wire: ESP32-CAM TX -> ESP32-S3 RX2
  #define CAM_RX RX2
  #define CAM_TX TX2  // ESP32-CAM RX -> ESP32-S3 TX2

  // ── Objek TFT ─────────────────────────────────────────────────────────
  Arduino_DataBus* bus = new Arduino_ESP32SPI(TFT_DC, TFT_CS, TFT_SCK, TFT_MOSI, TFT_MISO);
  Arduino_GFX*     tft = new Arduino_ILI9488_18bit(bus, TFT_RST, 1, false);

  // ── Objek Sensor & Buffer ─────────────────────────────────────────────
  Adafruit_MLX90640 mlx;
  float frame[834]; // Ukuran 834 aman untuk semua versi library
  float smoothFrame[768];

  // Alphabet untuk Base64
  const char b64_alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // ── Geometri UI Layout v4.1 ──────────────────────────────────────────
  #define SCR_W  480
  #define SCR_H  320
  #define HDR_H   48

  // Heatmap (Kiri)
  #define HM_X     0
  #define HM_Y    48
  #define HM_W   239
  #define HM_H   272
  #define CELL_W   7
  #define CELL_H  11
  #define HM_DX   (HM_X + (HM_W - 32*CELL_W)/2)
  #define HM_DY   (HM_Y + (HM_H - 24*CELL_H)/2)

  // Panel kanan
  #define PX  241
  #define PW  238

  // Row 1: Kartu suhu
  #define R1Y  50
  #define R1H  64
  #define CW   78
  #define CX0  241
  #define CX1  321
  #define CX2  401

  // Row 2: ECG
  #define R2Y  116
  #define R2H   82
  #define GX   242
  #define GY   130
  #define GW   236
  #define GH    64

  // Row 3: Status
  #define R3Y  200
  #define R3H   54
  #define STX  360
  #define STW  119

  // Row 4: Info
  #define R4Y  256
  #define R4H   62

  // =====================================================================
  //  SEGMENTASI KAKI DIABETIK
  // =====================================================================
  #define LEFT_COL_START   0
  #define LEFT_COL_END    15
  #define RIGHT_COL_START 16
  #define RIGHT_COL_END   31

  #define ZONE_TOE_R0    0
  #define ZONE_TOE_R1    7
  #define ZONE_FORE_R0   8
  #define ZONE_FORE_R1  15
  #define ZONE_HEEL_R0  16
  #define ZONE_HEEL_R1  23

  #define ASYM_THRESHOLD    2.2f   
  #define ASYM_DANGER       4.0f
  #define HOTCOLD_THRESHOLD 1.5f   
  #define HOTCOLD_DANGER    3.0f

  // ── State Mesin & Global Variabel ──────────────────────────────────────
  enum FlowState { ST_IDLE, ST_SCANNING, ST_HASIL, ST_SENSOR_ERROR };
  FlowState flowState = ST_IDLE;

  float g_ambient = 24.0f;
  bool  sensorOnline = false;

  struct ZoneResult {
    float left, right;
    char  leftFlag, rightFlag;
    float asym;
    bool  asymFlagged;
  };
  ZoneResult zoneRes[3];
  const char* zoneName[3] = { "JEMPOL", "TELAPAK", "TUMIT" };
  float leftFootAvg = 0, rightFootAvg = 0;
  int   overallRisk = 0;   
  String overallMsg = "READY";
  float g_bodyTemp = 36.6f;   // Body temp from ESP32-CAM MLX90614
  bool  g_bodyTempValid = false; // True when real data received from CAM
  String g_qrId = "";           // Patient QR ID received from ESP32-CAM scanner

  // ── ESP32-CAM Serial Packet Parser ────────────────────────────────────
  String   camSerialBuf = "";
  bool     camInPacket  = false;
  String   camPacketType = ""; // "DATA" or "QR"

  // ── ESP32-CAM Camera Preview (WiFi HTTP fetch) ──────────────────────
  String   g_camIP       = "10.149.192.106"; // GANTI DENGAN IP ESP32-CAM ANDA
  bool     g_camIPKnown  = true; // True once IP is received
  // Camera preview area on TFT (left side of idle screen)
  #define  CAM_PREV_X   4
  #define  CAM_PREV_Y  50
  #define  CAM_PREV_W 232  // display width (QQVGA 160 * 1.45)
  #define  CAM_PREV_H 174  // display height (QQVGA 120 * 1.45)

  // Koordinat Hotspot terpanas
  int   g_maxRowL = -1, g_maxColL = -1;
  float g_maxTempL = 0;
  int   g_maxRowR = -1, g_maxColR = -1;
  float g_maxTempR = 0;

  // LED status
  int   ledColor = 0;       
  bool  ledBlink = false;
  unsigned long tLedBlink = 0;
  bool  ledOn = true;

  // Tombol debounce & Timer
  bool btnPrevState = HIGH;
  unsigned long tBtnDebounce = 0;
  unsigned long tMlx = 0; 
  unsigned long tIdleEntry = 0; // Timer untuk auto-demo di Idle
  unsigned long tHasilEntry = 0; // Timer untuk auto-demo di Hasil
  unsigned long tScanStart = 0; // Timer durasi scanning termal
  unsigned long tClk = 0; // Timer update jam digital
    // =====================================================================
    //  PROTOTIPE FUNGSI
    // =====================================================================
    void clearI2CBus();
    bool isSensorResponding();
    bool isFrameReady();
    bool recoverSensor();
    uint16_t medicalRainbow(float n);
    void setStatusLED(int color, bool blink);
    void updateLedBlink();
    void drawCameraIcon(uint16_t color);
    void drawColorScale(float mn, float mx);
    void drawConnectionStatus();
    void renderHeatmap(float mn, float mx);
    void computeFootZones(float* src);
    String base64Encode(const uint8_t* data, size_t input_length);
    void sendResultToFirebase(float* src, float mn, float mx, String qrId, float leftTemp, float rightTemp, int risk);
    void drawHeader(const char* label, uint16_t color);
    void drawBg();
    void drawIdleScreen();
    void readCamSerial();
    void updateIdleWithQR();
    void fetchAndDrawCamFrame();
    void updateTempCards(float jl, float jr, float tl, float tr, float uml, float umr);
    void updateRangeCard(float mn, float mx);
    void updateStatus(const String& st);
    void updateSystemStatus();
    void gotoIdle();
    void gotoHasil();
    void gotoScanning();
    void calibrateAmbient();

  // =====================================================================
  //  SPEKTRUM WARNA RAINBOW MEDIS
  // =====================================================================
  uint16_t medicalRainbow(float n) {
    if (n < 0.0f) n = 0.0f;
    if (n > 1.0f) n = 1.0f;
    uint8_t r = 0, g = 0, b = 0;
    if (n < 0.15f) {
      float ratio = n / 0.15f;
      r = (uint8_t)(ratio * 100); g = 0; b = (uint8_t)(ratio * 150);
    } else if (n < 0.35f) {
      float ratio = (n - 0.15f) / 0.20f;
      r = (uint8_t)(100 * (1.0f - ratio)); g = 0; b = (uint8_t)(150 + ratio * 105);
    } else if (n < 0.55f) {
      float ratio = (n - 0.35f) / 0.20f;
      r = 0; g = (uint8_t)(ratio * 255); b = (uint8_t)(255 * (1.0f - ratio));
    } else if (n < 0.75f) {
      float ratio = (n - 0.55f) / 0.20f;
      r = (uint8_t)(ratio * 255); g = 255; b = 0;
    } else if (n < 0.90f) {
      float ratio = (n - 0.75f) / 0.15f;
      r = 255; g = (uint8_t)(255 * (1.0f - ratio)); b = 0;
    } else {
      float ratio = (n - 0.90f) / 0.10f;
      r = 255; g = (uint8_t)(ratio * 255); b = (uint8_t)(ratio * 255);
    }
    return tft->color565(r, g, b);
  }

  // =====================================================================
  //  DRAW COLOR SCALE
  // =====================================================================
  void drawColorScale(float mn, float mx) {
    tft->drawRoundRect(250, 270, 220, 10, 2, tft->color565(226, 232, 240));
    for (int i = 0; i < 218; i++) {
      tft->drawFastVLine(251 + i, 271, 8, medicalRainbow((float)i / 217.f));
    }
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(75, 85, 99), tft->color565(248, 250, 252));
    tft->setCursor(250, 285); tft->printf("%.1f C", mn);
    tft->setCursor(438, 285); tft->printf("%.1f C", mx);
  }



  // =====================================================================
  //  I2C BUS CLEARING (9 Clock Pulses)
  // =====================================================================
  void clearI2CBus() {
    Serial.println("[I2C] Bus Clearing: 9 Clock Pulses...");
    Wire.end();
    delay(10);
    pinMode(I2C_SCL, OUTPUT);
    pinMode(I2C_SDA, INPUT_PULLUP);
    for (int i = 0; i < 9; i++) {
      digitalWrite(I2C_SCL, HIGH); delayMicroseconds(10);
      digitalWrite(I2C_SCL, LOW);  delayMicroseconds(10);
      if (digitalRead(I2C_SDA) == HIGH) break;
    }
    pinMode(I2C_SDA, OUTPUT);
    digitalWrite(I2C_SDA, LOW);  delayMicroseconds(10);
    digitalWrite(I2C_SCL, HIGH); delayMicroseconds(10);
    digitalWrite(I2C_SDA, HIGH); delayMicroseconds(10);
    pinMode(I2C_SDA, INPUT_PULLUP);
    pinMode(I2C_SCL, INPUT_PULLUP);
    delay(100);
  }

  bool isSensorResponding() {
    Wire.beginTransmission(MLX_ADDR);
    return (Wire.endTransmission() == 0);
  }

  // ── BACA REGISTER 0x8000 UNTUK ANTI-LOCK (STANDARD REPEATED START) ────
  bool isFrameReady() {
    Wire.beginTransmission(MLX_ADDR);
    Wire.write(0x80);
    Wire.write(0x00);
    if (Wire.endTransmission(false) != 0) return false; 
    if (Wire.requestFrom((uint8_t)MLX_ADDR, (uint8_t)2) != 2) return false;
    uint16_t statusReg = ((uint16_t)Wire.read() << 8) | Wire.read();
    return (statusReg & 0x0008) != 0;
  }

  bool recoverSensor() {
    Serial.println("[RECOVERY] Memulai pemulihan sensor...");
    sensorOnline = false;
    clearI2CBus();
    Wire.begin(I2C_SDA, I2C_SCL);
    Wire.setClock(400000);
    Wire.setTimeOut(200); // Timeout ketat saat recovery
    bool success = false;
    for (int attempt = 1; attempt <= 3; attempt++) {
      delay(150);
      if (mlx.begin(MLX90640_I2CADDR_DEFAULT, &Wire)) {
        mlx.setMode(MLX90640_CHESS);
        mlx.setRefreshRate(MLX90640_8_HZ);
        success = true;
        break;
      }
    }
    if (success) {
      sensorOnline = true;
      Wire.setTimeOut(500); // Kembalikan timeout normal
    }
    return success;
  }

  // =====================================================================
  //  LED STATUS FISIK
  // =====================================================================
  void setStatusLED(int color, bool blink) {
    ledColor = color;
    ledBlink = blink;
    ledOn = true;
    digitalWrite(LED_GREEN,  color == 0 ? HIGH : LOW);
    digitalWrite(LED_YELLOW, color == 1 ? HIGH : LOW);
    digitalWrite(LED_RED,    color == 2 ? HIGH : LOW);
  }
  void updateLedBlink() {
    if (!ledBlink) return;
    unsigned long now = millis();
    if (now - tLedBlink >= 400) {
      tLedBlink = now;
      ledOn = !ledOn;
      int pin = (ledColor == 0) ? LED_GREEN : (ledColor == 1 ? LED_YELLOW : LED_RED);
      digitalWrite(pin, ledOn ? HIGH : LOW);
    }
  }

  // =====================================================================
  //  BASE64 ENCODER
  // =====================================================================
  String base64Encode(const uint8_t* data, size_t input_length) {
    String encoded = "";
    encoded.reserve(((input_length + 2) / 3) * 4);
    
    for (size_t i = 0; i < input_length; i += 3) {
      uint32_t octet_a = data[i];
      uint32_t octet_b = (i + 1 < input_length) ? data[i + 1] : 0;
      uint32_t octet_c = (i + 2 < input_length) ? data[i + 2] : 0;
      
      uint32_t triple = (octet_a << 16) + (octet_b << 8) + octet_c;
      
      encoded += b64_alphabet[(triple >> 18) & 0x3F];
      encoded += b64_alphabet[(triple >> 12) & 0x3F];
      
      if (i + 1 < input_length) {
        encoded += b64_alphabet[(triple >> 6) & 0x3F];
      } else {
        encoded += '=';
      }
      
      if (i + 2 < input_length) {
        encoded += b64_alphabet[triple & 0x3F];
      } else {
        encoded += '=';
      }
    }
    return encoded;
  }



  // =====================================================================
  //  LOGO KAMERA DIAGNOSTIK
  // =====================================================================
  void drawCameraIcon(uint16_t color) {
    int cx = HM_X + HM_W / 2;
    int cy = HM_Y + HM_H / 2 - 15;
    tft->fillRoundRect(cx - 32, cy - 37, 18, 8, 2, color);
    tft->fillRoundRect(cx - 15, cy - 35, 30, 12, 3, color);
    tft->fillRoundRect(cx - 55, cy - 28, 110, 56, 8, color);
    tft->fillCircle(cx, cy + 2, 22, tft->color565(12, 16, 24));
    tft->drawCircle(cx, cy + 2, 22, color);
    tft->drawCircle(cx, cy + 2, 23, color);
    tft->fillCircle(cx, cy + 2, 16, color);
    tft->fillCircle(cx, cy + 2, 10, tft->color565(12, 16, 24));
    tft->fillCircle(cx - 4, cy - 2, 2, color);
    tft->fillCircle(cx + 38, cy - 16, 3, tft->color565(12, 16, 24));
    tft->drawCircle(cx + 38, cy - 16, 3, color);
  }

  // =====================================================================
  //  COLORBAR DI HEADER
  // =====================================================================
  void drawColorBar(float mn, float mx) {}

  // =====================================================================
  //  JAM UPTIME DI HEADER
  // =====================================================================
  void updateClock() {
    unsigned long s = millis() / 1000;
    unsigned long h = s / 3600; s %= 3600;
    unsigned long m = s / 60;   s %= 60;
    
    uint16_t bg = tft->color565(255, 255, 255);
    tft->fillRect(360, 10, 110, 28, bg);
    tft->setTextSize(2);
    tft->setTextColor(tft->color565(75, 85, 99), bg);
    tft->setCursor(360, 14);
    tft->printf("%02lu:%02lu:%02lu", h, m, s);
  }

  // =====================================================================
  //  KARTU TEMPERATUR KAKI (JEMPOL, TELAPAK, TUMIT)
  // =====================================================================
  void updateTempCards(float jl, float jr, float tl, float tr, float uml, float umr) {}

  // =====================================================================
  //  RANGE SUHU KAKI
  // =====================================================================
  void updateRangeCard(float mn, float mx) {}

  // =====================================================================
  //  STATUS DIAGNOSA
  // =====================================================================
  void updateStatus(const String& st) {}

  // =====================================================================
  //  UPDATE PANEL ROW 4 (SISTEM STATUS)
  // =====================================================================
  void updateSystemStatus() {}

  // =====================================================================
  //  GRID BACKGROUND SKELETON
  // =====================================================================
  void drawBg() {
    tft->fillScreen(tft->color565(248, 250, 252)); // Light background

    // Header (White background)
    tft->fillRect(0, 0, 480, 48, tft->color565(255, 255, 255));
    // Thin border below header
    tft->drawFastHLine(0, 47, 480, tft->color565(226, 232, 240));

    // Title: SAYANGI
    tft->setTextSize(2);
    tft->setTextColor(tft->color565(17, 24, 39), tft->color565(255, 255, 255));
    tft->setCursor(12, 14);
    tft->print("SAYANGI BOOTH");

    // Online Status Badge
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(22, 163, 74), tft->color565(255, 255, 255));
    tft->setCursor(185, 18);
    tft->print(" ONLINE");
  }

  // =====================================================================
  //  RENDER HEATMAP (BILINEAR DENGAN SENSOR MIRROR)
  // =====================================================================
  void renderHeatmap(float mn, float mx) {
    float rng = mx - mn;
    if (rng < 0.1f) rng = 0.1f;
    const float invRng = 1.0f / rng;
    const int outW = 32 * CELL_W;   
    const int outH = 24 * CELL_H;   
    const float scaleX = 31.0f / (float)(outW - 1);
    const float scaleY = 23.0f / (float)(outH - 1);
    float rowTemp[32];
    
    tft->startWrite();
    for (int oy = 0; oy < outH; oy++) {
      float sy = (float)oy * scaleY;
      int r0 = min((int)sy, 22);
      int r1 = r0 + 1;         
      float fy = sy - r0;        
      float ify = 1.0f - fy;     

      for (int c = 0; c < 32; c++) {
        int mc = 31 - c; 
        rowTemp[c] = smoothFrame[r0 * 32 + mc] * ify + smoothFrame[r1 * 32 + mc] * fy;
      }

      for (int ox = 0; ox < outW; ox++) {
        float sx  = (float)ox * scaleX;
        int   c0  = min((int)sx, 30);
        int   c1  = c0 + 1;       
        float fx  = sx - c0;      
        float ifx = 1.0f - fx;    

        float t = rowTemp[c0] * ifx + rowTemp[c1] * fx;
        tft->writePixel(HM_DX + ox, HM_DY + oy, medicalRainbow((t - mn) * invRng));
      }
    }
    tft->endWrite();


  }

  // =====================================================================
  //  ANALISIS ZONA KAKI & PENCARIAN PIKSEL TERPANAS
  // =====================================================================
  void computeFootZones(float* src) {
    float sumL[3] = {0,0,0}, sumR[3] = {0,0,0};
    int   cntL[3] = {0,0,0}, cntR[3] = {0,0,0};
    float totL = 0, totR = 0; int totLc = 0, totRc = 0;

    g_maxTempL = 0; g_maxRowL = -1; g_maxColL = -1;
    g_maxTempR = 0; g_maxRowR = -1; g_maxColR = -1;

    for (int r = 0; r < 24; r++) {
      int zone = (r <= ZONE_TOE_R1) ? 0 : (r <= ZONE_FORE_R1 ? 1 : 2);
      for (int c = 0; c < 32; c++) {
        float t = src[r*32 + c];
        if (c >= LEFT_COL_START && c <= LEFT_COL_END) {
          sumL[zone] += t; cntL[zone]++;
          totL += t; totLc++;
          if (t > g_maxTempL) {
            g_maxTempL = t; g_maxRowL = r; g_maxColL = c;
          }
        } else if (c >= RIGHT_COL_START && c <= RIGHT_COL_END) {
          sumR[zone] += t; cntR[zone]++;
          totR += t; totRc++;
          if (t > g_maxTempR) {
            g_maxTempR = t; g_maxRowR = r; g_maxColR = c;
          }
        }
      }
    }
    leftFootAvg  = totLc ? totL / totLc : 0;
    rightFootAvg = totRc ? totR / totRc : 0;

    int worst = 0; 
    for (int z = 0; z < 3; z++) {
      zoneRes[z].left  = cntL[z] ? sumL[z] / cntL[z] : 0;
      zoneRes[z].right = cntR[z] ? sumR[z] / cntR[z] : 0;
      zoneRes[z].asym  = fabs(zoneRes[z].left - zoneRes[z].right);
      zoneRes[z].asymFlagged = zoneRes[z].asym > ASYM_THRESHOLD;
      if (zoneRes[z].asymFlagged) worst = max(worst, zoneRes[z].asym > ASYM_DANGER ? 2 : 1);

      float devL = zoneRes[z].left  - leftFootAvg;
      float devR = zoneRes[z].right - rightFootAvg;
      zoneRes[z].leftFlag  = (devL > HOTCOLD_THRESHOLD) ? 'H' : (devL < -HOTCOLD_THRESHOLD ? 'C' : 'N');
      zoneRes[z].rightFlag = (devR > HOTCOLD_THRESHOLD) ? 'H' : (devR < -HOTCOLD_THRESHOLD ? 'C' : 'N');
      if (zoneRes[z].leftFlag != 'N')  worst = max(worst, fabs(devL) > HOTCOLD_DANGER ? 2 : 1);
      if (zoneRes[z].rightFlag != 'N') worst = max(worst, fabs(devR) > HOTCOLD_DANGER ? 2 : 1);
    }
    overallRisk = worst;
    overallMsg = (worst == 0) ? "Normal" : (worst == 1 ? "Perhatian" : "Risiko");
  }

  class JSONStream : public Stream {
    public:
      JSONStream(float* src, float mn, float mx, String qrId, float leftTemp, float rightTemp, int risk) {
        _src = src;
        _mn = mn;
        _mx = mx;
        _pos = 0;
        _cachedPixelIndex = -1;
        _cachedTripleIdx = 0xFFFFFFFF;

        _prefix = "{\"status\":\"pending\",\"state\":\"pending\",\"patient_id\":\"" + qrId + "\",\"risk_level\":" + String(risk) + ",\"image\":\"data:image/bmp;base64,";
        
        String gridStr = "[";
        for(int i=0; i<768; i++) {
          gridStr += String(_src[i], 1);
          if (i < 767) gridStr += ",";
        }
        gridStr += "]";
        
        _suffix = "\",\"thermalGrid\":" + gridStr + ",\"timestamp\":{\".sv\":\"timestamp\"}}";

        _totalSize = _prefix.length() + 200776 + _suffix.length();

        // Setup BMP header
        memset(_header, 0, 54);
        _header[0] = 'B'; _header[1] = 'M';
        uint32_t fileSize = 150582;
        memcpy(_header + 2, &fileSize, 4);
        uint32_t offset = 54;
        memcpy(_header + 10, &offset, 4);
        uint32_t headerSize = 40;
        memcpy(_header + 14, &headerSize, 4);
        int32_t width = 224;
        memcpy(_header + 18, &width, 4);
        int32_t height = 224;
        memcpy(_header + 22, &height, 4); 
        uint16_t planes = 1;
        memcpy(_header + 26, &planes, 2);
        uint16_t bpp = 24;
        memcpy(_header + 28, &bpp, 2); 
        uint32_t compression = 0;
        memcpy(_header + 30, &compression, 4);
        uint32_t imageSize = 150528;
        memcpy(_header + 34, &imageSize, 4);

        _rng = _mx - _mn;
        if (_rng < 0.1f) _rng = 0.1f;
        _invRng = 1.0f / _rng;
        _scaleX = 31.0f / 223.0f;
        _scaleY = 23.0f / 223.0f;
      }

      size_t size() const { return _totalSize; }
      
      void reset() {
        _pos = 0;
        _cachedPixelIndex = -1;
        _cachedTripleIdx = 0xFFFFFFFF;
      }

      int available() override {
        return _totalSize - _pos;
      }

      int read() override {
        if (_pos >= _totalSize) return -1;

        uint32_t prefixLen = _prefix.length();
        if (_pos < prefixLen) {
          return _prefix[_pos++];
        }

        uint32_t b64Len = 200776;
        if (_pos < prefixLen + b64Len) {
          uint32_t b64Idx = _pos - prefixLen;
          uint32_t tripleIdx = b64Idx / 4;
          int charPos = b64Idx % 4;

          if (tripleIdx != _cachedTripleIdx) {
            _cachedTripleIdx = tripleIdx;
            uint32_t bmpOffset = tripleIdx * 3;
            uint8_t octet_a = getByte(bmpOffset);
            uint8_t octet_b = getByte(bmpOffset + 1);
            uint8_t octet_c = getByte(bmpOffset + 2);
            uint32_t triple = (octet_a << 16) + (octet_b << 8) + octet_c;
            _cachedB64[0] = b64_alphabet[(triple >> 18) & 0x3F];
            _cachedB64[1] = b64_alphabet[(triple >> 12) & 0x3F];
            _cachedB64[2] = b64_alphabet[(triple >> 6) & 0x3F];
            _cachedB64[3] = b64_alphabet[triple & 0x3F];
          }
          _pos++;
          return _cachedB64[charPos];
        }

        uint32_t suffixPos = _pos - prefixLen - b64Len;
        _pos++;
        return _suffix[suffixPos];
      }

      int peek() override {
        if (_pos >= _totalSize) return -1;
        uint32_t currentPos = _pos;
        int c = read();
        _pos = currentPos;
        return c;
      }

      void flush() override {}
      size_t write(uint8_t) override { return 0; }

      size_t readBytes(char *buffer, size_t length) override {
        size_t count = 0;
        while (count < length) {
          int c = read();
          if (c < 0) break;
          buffer[count] = (char)c;
          count++;
        }
        return count;
      }

    private:
      float* _src;
      float _mn;
      float _mx;
      uint32_t _pos;
      uint32_t _totalSize;
      String _prefix;
      String _suffix;
      uint8_t _header[54];
      float _rng;
      float _invRng;
      float _scaleX;
      float _scaleY;

      int _cachedPixelIndex;
      uint8_t _cachedR, _cachedG, _cachedB;
      uint32_t _cachedTripleIdx;
      char _cachedB64[4];

      void getPixelRGB(int px, int py, uint8_t &r, uint8_t &g, uint8_t &b) {
        float sy = (223 - py) * _scaleY;
        int r0 = (int)sy;
        int r1 = min(r0 + 1, 23);
        float fy = sy - r0;
        float ify = 1.0f - fy;

        float sx = (223 - px) * _scaleX;
        int c0 = (int)sx;
        int c1 = min(c0 + 1, 31);
        float fx = sx - c0;
        float ifx = 1.0f - fx;

        float t = (_src[r0 * 32 + c0] * ifx + _src[r0 * 32 + c1] * fx) * ify +
                  (_src[r1 * 32 + c0] * ifx + _src[r1 * 32 + c1] * fx) * fy;

        float norm = (t - _mn) * _invRng;
        if (norm < 0.0f) norm = 0.0f;
        if (norm > 1.0f) norm = 1.0f;

        if (norm < 0.15f) {
          float ratio = norm / 0.15f;
          r = (uint8_t)(ratio * 100); g = 0; b = (uint8_t)(ratio * 150);
        } else if (norm < 0.35f) {
          float ratio = (norm - 0.15f) / 0.20f;
          r = (uint8_t)(100 * (1.0f - ratio)); g = 0; b = (uint8_t)(150 + ratio * 105);
        } else if (norm < 0.55f) {
          float ratio = (norm - 0.35f) / 0.20f;
          r = 0; g = (uint8_t)(ratio * 255); b = (uint8_t)(255 * (1.0f - ratio));
        } else if (norm < 0.75f) {
          float ratio = (norm - 0.55f) / 0.20f;
          r = (uint8_t)(ratio * 255); g = 255; b = 0;
        } else if (norm < 0.90f) {
          float ratio = (norm - 0.75f) / 0.15f;
          r = 255; g = (uint8_t)(255 * (1.0f - ratio)); b = 0;
        } else {
          float ratio = (norm - 0.90f) / 0.10f;
          r = 255; g = (uint8_t)(ratio * 255); b = (uint8_t)(ratio * 255);
        }
      }

      uint8_t getByte(int idx) {
        if (idx < 54) {
          return _header[idx];
        }
        int pIdx = idx - 54;
        int pixelIndex = pIdx / 3;
        int channel = pIdx % 3;
        if (pixelIndex != _cachedPixelIndex) {
          _cachedPixelIndex = pixelIndex;
          int py = pixelIndex / 224;
          int px = pixelIndex % 224;
          getPixelRGB(px, py, _cachedR, _cachedG, _cachedB);
        }
        if (channel == 0) return _cachedB;
        if (channel == 1) return _cachedG;
        return _cachedR;
      }
  };

  void sendResultToFirebase(float* src, float mn, float mx, String qrId, float leftTemp, float rightTemp, int risk) {
    if (!SEND_TO_FIREBASE) return;
    if (WiFi.status() != WL_CONNECTED) return;

    Serial.printf("[SYSTEM] Free heap sebelum alokasi: %d\n", ESP.getFreeHeap());

    WiFiClientSecure* client = new WiFiClientSecure();
    if (client == nullptr) {
      Serial.println("[FIREBASE] Gagal mengalokasikan WiFiClientSecure!");
      return; 
    }
    client->setInsecure(); 

    HTTPClient* http = new HTTPClient();
    if (http == nullptr) {
      Serial.println("[FIREBASE] Gagal mengalokasikan HTTPClient!");
      delete client;
      return;
    }

    String url = String(FIREBASE_HOST);
    if (!url.endsWith("/")) url += "/";
    url += "kiosk_session.json?auth=" + String(FIREBASE_AUTH);

    http->begin(*client, url);
    http->addHeader("Content-Type", "application/json");
    http->setTimeout(15000); // 15 detik timeout

    JSONStream jsonStream(src, mn, mx, qrId, leftTemp, rightTemp, risk);

    // DRY-RUN untuk verifikasi kelurusan stream dan memanaskan cache
    Serial.printf("[DEBUG] Stream size: %d\n", jsonStream.size());
    uint32_t dryCount = 0;
    while (jsonStream.available() > 0) {
      int c = jsonStream.read();
      if (c < 0) {
        Serial.printf("[DEBUG] Stream terputus prematur di indeks: %d\n", dryCount);
        break;
      }
      dryCount++;
    }
    Serial.printf("[DEBUG] Hasil dry-run: terbaca %d byte\n", dryCount);
    jsonStream.reset(); // Reset posisi stream ke awal sebelum dikirim!

    Serial.printf("[SYSTEM] Free heap sebelum POST: %d\n", ESP.getFreeHeap());

    int code = http->sendRequest("PATCH", &jsonStream, jsonStream.size());
    Serial.printf("[FIREBASE] POST status: %d (%s)\n", code, http->errorToString(code).c_str());
    
    http->end();
    delete http;
    delete client;

    // Jeda stabilisasi daya setelah WiFi RF selesai mengirim data
    delay(300);
  }

  // =====================================================================
  //  TRANSISI STATE MESIN
  // =====================================================================
  void gotoIdle() {
    flowState = ST_IDLE;
    tIdleEntry = millis(); // Reset timer saat masuk idle
    g_bodyTempValid = false;
    g_qrId = "";
    setStatusLED(0, false);
    drawBg();
    updateClock();

    uint16_t bg    = tft->color565(248, 250, 252);
    uint16_t teal  = tft->color565(13, 148, 136);
    uint16_t grey  = tft->color565(75, 85, 99);
    uint16_t dark  = tft->color565(17, 24, 39);
    uint16_t bdr   = tft->color565(226, 232, 240);

    // ── Left panel: Camera preview area ────────────────────────────────
    // Dark placeholder with label until first frame arrives
    tft->fillRoundRect(CAM_PREV_X, CAM_PREV_Y, CAM_PREV_W, CAM_PREV_H, 4,
                       tft->color565(30, 41, 59)); // dark slate
    tft->drawRoundRect(CAM_PREV_X, CAM_PREV_Y, CAM_PREV_W, CAM_PREV_H, 4, teal);

    // Camera icon label inside placeholder
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(148, 163, 184), tft->color565(30, 41, 59));
    tft->setCursor(CAM_PREV_X + 72, CAM_PREV_Y + 78);
    tft->print("Menghubungkan kamera...");

    // Label below preview
    tft->setTextSize(1);
    tft->setTextColor(teal, bg);
    tft->setCursor(CAM_PREV_X + 50, CAM_PREV_Y + CAM_PREV_H + 4);
    tft->print("Kamera Sayangi Booth (Live)");

    // ── Vertical divider ───────────────────────────────────────────────
    tft->drawFastVLine(238, 50, 268, bdr);

    // ── Right panel: QR instructions ──────────────────────────────────
    // QR icon box
    int qx = 269, qy = 64, qw = 80, qh = 80;
    tft->drawRoundRect(qx, qy, qw, qh, 6, bdr);
    // Corner marks
    int mk = 10;
    tft->drawFastHLine(qx,          qy,           mk, teal);
    tft->drawFastVLine(qx,          qy,           mk, teal);
    tft->drawFastHLine(qx+qw-mk,    qy,           mk, teal);
    tft->drawFastVLine(qx+qw-1,     qy,           mk, teal);
    tft->drawFastHLine(qx,          qy+qh-1,      mk, teal);
    tft->drawFastVLine(qx,          qy+qh-mk,     mk, teal);
    tft->drawFastHLine(qx+qw-mk,    qy+qh-1,      mk, teal);
    tft->drawFastVLine(qx+qw-1,     qy+qh-mk,     mk, teal);
    // QR dot pattern
    tft->drawRect(qx+20, qy+20, 40, 40, tft->color565(156, 163, 175));
    tft->fillRect(qx+24, qy+24, 10, 10, dark);
    tft->fillRect(qx+46, qy+24, 10, 10, dark);
    tft->fillRect(qx+24, qy+46, 10, 10, dark);

    // Title
    tft->setTextSize(2);
    tft->setTextColor(dark, bg);
    tft->setCursor(248, 162);
    tft->print("Pindai Kartu QR");

    // Subtitle
    tft->setTextSize(1);
    tft->setTextColor(grey, bg);
    tft->setCursor(248, 185);
    tft->print("Scan kartu QR peserta di");
    tft->setCursor(248, 198);
    tft->print("layar kamera Sayangi Booth,");
    tft->setCursor(248, 211);
    tft->print("lalu tekan tombol untuk scan.");

    // Status footer
    tft->setTextSize(1);
    tft->setTextColor(teal, bg);
    tft->setCursor(248, 295);
    tft->print("Menunggu kartu QR...");
  }

  void gotoHasil() {
    flowState = ST_HASIL;
    tHasilEntry = millis(); // Reset timer saat masuk hasil
    setStatusLED(overallRisk == 0 ? 0 : (overallRisk == 1 ? 1 : 2), overallRisk == 2);
    
    drawBg();
    updateClock();

    float mn = smoothFrame[0];
    float mx = smoothFrame[0];
    for (int i = 1; i < 768; i++) {
      if (smoothFrame[i] < mn) mn = smoothFrame[i];
      if (smoothFrame[i] > mx) mx = smoothFrame[i];
    }
    if (mx < mn + 5.0f) mx = mn + 5.0f;

    // Render thermal Foot Heatmap (Left side)
    renderHeatmap(mn, mx);

    // Right side: Results Layout
    // Title: Pemeriksaan Selesai
    tft->setTextSize(2);
    tft->setTextColor(tft->color565(22, 163, 74), tft->color565(248, 250, 252));
    tft->setCursor(252, 60);
    tft->print("Pemeriksaan Selesai");

    // Patient QR badge (if identified)
    if (g_qrId.length() > 0) {
      tft->setTextSize(1);
      tft->setTextColor(tft->color565(13, 148, 136), tft->color565(248, 250, 252));
      tft->setCursor(252, 83);
      String shortId = g_qrId.length() > 20 ? g_qrId.substring(g_qrId.length()-12) : g_qrId;
      tft->print("ID: " + shortId);
    } else {

    // Subtext
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(75, 85, 99), tft->color565(248, 250, 252));
    tft->setCursor(252, 83);
    tft->print("Data pemeriksaan Anda telah tersimpan.");
    }

    // Draw UI Elements (Tanpa Jantung/Suhu Kamera)
    uint16_t cardBg = tft->color565(255, 255, 255);
    uint16_t cardBorder = tft->color565(226, 232, 240);

    // Waktu Pemeriksaan
    tft->fillRoundRect(250, 100, 220, 60, 6, cardBg);
    tft->drawRoundRect(250, 100, 220, 60, 6, cardBorder);
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(156, 163, 175), cardBg);
    tft->setCursor(255, 106); tft->print("Status");
    tft->setTextSize(2);
    tft->setTextColor(tft->color565(17, 24, 39), cardBg);
    tft->setCursor(255, 120); tft->print("SELESAI");
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(75, 85, 99), cardBg);
    tft->setCursor(255, 144); tft->print("Silakan lihat hasil di bawah");

    // Recommendation card
    int rx = 250;
    int ry = 172;
    int rw = 220;
    int rh = 90;
    uint16_t recBg, recBorder, recTextCol;
    String recTitle, recLine1, recLine2, recLine3;

    if (overallRisk == 2) {
      recBg = tft->color565(254, 242, 242);
      recBorder = tft->color565(220, 38, 38);
      recTextCol = tft->color565(220, 38, 38);
      recTitle = "RISIKO TINGGI";
      recLine1 = "Terdeteksi asimetri suhu";
      recLine2 = "kaki yang signifikan.";
      recLine3 = "Harap periksa ke bidan!";
    } else if (overallRisk == 1) {
      recBg = tft->color565(255, 251, 235);
      recBorder = tft->color565(180, 83, 9);
      recTextCol = tft->color565(180, 83, 9);
      recTitle = "RISIKO RINGAN";
      recLine1 = "Terdeteksi deviasi suhu";
      recLine2 = "ringan pada kaki Anda.";
      recLine3 = "Pantau kondisi secara rutin.";
    } else {
      recBg = tft->color565(240, 253, 244);
      recBorder = tft->color565(22, 163, 74);
      recTextCol = tft->color565(22, 163, 74);
      recTitle = "KONDISI NORMAL";
      recLine1 = "Distribusi suhu kaki";
      recLine2 = "simetris dan sehat.";
      recLine3 = "Jaga kebersihan kaki.";
    }

    tft->fillRoundRect(rx, ry, rw, rh, 8, recBg);
    tft->drawRoundRect(rx, ry, rw, rh, 8, recBorder);

    tft->setTextSize(1);
    tft->setTextColor(recTextCol, recBg);
    tft->setCursor(rx + 10, ry + 8);
    tft->print(recTitle);

    tft->setTextColor(tft->color565(75, 85, 99), recBg);
    tft->setCursor(rx + 10, ry + 24); tft->print(recLine1);
    tft->setCursor(rx + 10, ry + 40); tft->print(recLine2);
    tft->setCursor(rx + 10, ry + 56); tft->print(recLine3);

    // Draw small Color Scale below recommendation card
    tft->drawRoundRect(250, 270, 220, 10, 2, tft->color565(226, 232, 240));
    for (int i = 0; i < 218; i++) {
      tft->drawFastVLine(251 + i, 271, 8, medicalRainbow((float)i / 217.f));
    }
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(75, 85, 99), tft->color565(248, 250, 252));
    tft->setCursor(250, 285); tft->printf("%.1f C", mn);
    tft->setCursor(438, 285); tft->printf("%.1f C", mx);

    // Bottom prompt
    tft->setTextColor(tft->color565(156, 163, 175), tft->color565(248, 250, 252));
    tft->setCursor(252, 305);
    tft->print("Tekan tombol untuk kembali.");
  }

  void gotoScanning() {
    flowState = ST_SCANNING;
    setStatusLED(1, true); // Yellow blinking

    drawBg();
    updateClock();

    // Title: Memindai Termal (Live)
    tft->setTextSize(2);
    tft->setTextColor(tft->color565(17, 24, 39), tft->color565(248, 250, 252));
    tft->setCursor(250, 75);
    tft->print("Memindai Suhu...");

    // Subtitle
    tft->setTextSize(1);
    tft->setTextColor(tft->color565(220, 38, 38), tft->color565(248, 250, 252));
    tft->setCursor(250, 100);
    tft->print("MOHON JANGAN BERGERAK!");
    
    // Draw Scale placeholder
    drawColorScale(26.0f, 38.0f);
    
    tScanStart = millis(); // Mulai timer scanning
  }

  // =====================================================================
  //  KALIBRASI AMBIENT SAAT BOOT (TANPA WIFI NOISE)
  // =====================================================================
  void calibrateAmbient() {
    uint16_t sbg = tft->color565(8, 12, 22);
    tft->fillRect(10, 76, 300, 30, sbg);
    tft->setTextColor(tft->color565(255, 190, 0), sbg);
    tft->setCursor(10, 76); tft->print("Membaca suhu ambient...");
    
    // Tunggu frame siap secara dinamis
    unsigned long startT = millis();
    while (millis() - startT < 2000) {
      if (isFrameReady()) break;
      delay(10);
    }

    int status = mlx.getFrame(frame);
    if (status == 0) {
      float sum = 0;
      for (int p = 0; p < 768; p++) sum += frame[p];
      g_ambient = sum / 768.0f;
    } else {
      g_ambient = 24.0f; 
    }
    tft->fillRect(10, 76, 300, 30, sbg);
    tft->setTextColor(tft->color565(60, 200, 100), sbg);
    tft->setCursor(10, 76); 
    tft->printf("Ambient Calibrated: %.1f C", g_ambient);
  }

  // =====================================================================
  //  ESP32-CAM HTTP PACKET PARSER (Pengganti Kabel RX/TX!)
  //  Mengambil data suhu dan QR secara berkala lewat WiFi
  // =====================================================================
  void readCamDataHTTP() {
    static unsigned long lastFetch = 0;
    // Ambil data setiap 1 detik agar tidak memberatkan WiFi
    if (millis() - lastFetch < 1000) return;
    lastFetch = millis();

    if (WiFi.status() == WL_CONNECTED && g_camIP.length() > 5) {
      HTTPClient http;
      http.begin("http://" + g_camIP + "/get-data");
      http.setTimeout(400); // Jangan lama-lama agar UI tidak lag
      
      int httpCode = http.GET();
      if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        
        // Parse JSON secara manual
        // Contoh: {"qr":"SEHATDESA:1234", "temp":36.50}
        
        // 1. Ambil QR
        int qrStart = payload.indexOf("\"qr\":\"") + 6;
        int qrEnd = payload.indexOf("\"", qrStart);
        if (qrStart >= 6 && qrEnd > qrStart) {
          String qr = payload.substring(qrStart, qrEnd);
          if (qr.startsWith("SEHATDESA:")) {
            g_qrId = qr.substring(10); // buang prefix
            g_qrId.trim();
            Serial.println("[CAM HTTP] QR ID Diterima: " + g_qrId);
            updateIdleWithQR();
            tIdleEntry = millis(); // Reset timer untuk auto-start
          }
        }
        
        // 2. Ambil Suhu
        int tempStart = payload.indexOf("\"temp\":") + 7;
        int tempEnd = payload.indexOf("}", tempStart);
        if (tempStart >= 7 && tempEnd > tempStart) {
          String tempStr = payload.substring(tempStart, tempEnd);
          if (tempStr != "nan" && tempStr != "0") {
            g_bodyTemp = tempStr.toFloat();
            g_bodyTempValid = true;
          }
        }
      }
      http.end();
    }
  }



  // =====================================================================
  //  UPDATE IDLE SCREEN WITH PATIENT QR (called after QR packet received)
  //  Overwrites the subtitle area only — no full screen refresh needed.
  // =====================================================================
  void updateIdleWithQR() {
    uint16_t bg   = tft->color565(248, 250, 252);
    uint16_t white = tft->color565(255, 255, 255);
    uint16_t teal  = tft->color565(13, 148, 136);
    uint16_t green = tft->color565(22, 163, 74);
    uint16_t dark  = tft->color565(17, 24, 39);
    uint16_t grey  = tft->color565(75, 85, 99);
    uint16_t bdr   = tft->color565(226, 232, 240);

    // Clear subtitle + status area (y=220 to y=310)
    tft->fillRect(0, 220, 480, 90, bg);

    // Green confirmation banner card
    tft->fillRoundRect(30, 224, 420, 54, 10, tft->color565(240, 253, 244));
    tft->drawRoundRect(30, 224, 420, 54, 10, green);

    // Checkmark icon (small filled circle + tick approximation)
    tft->fillCircle(55, 251, 12, green);
    tft->setTextSize(2);
    tft->setTextColor(white, green);
    tft->setCursor(50, 244);
    tft->print("V");

    // Title: Pasien Teridentifikasi
    tft->setTextSize(2);
    tft->setTextColor(green, tft->color565(240, 253, 244));
    tft->setCursor(76, 230);
    tft->print("Pasien Teridentifikasi!");

    // Patient QR ID (shortened to fit)
    String displayId = g_qrId;
    if (displayId.startsWith("SEHATDESA:")) displayId = displayId.substring(10);
    if (displayId.length() > 22) displayId = displayId.substring(0, 22) + "..";
    tft->setTextSize(1);
    tft->setTextColor(grey, tft->color565(240, 253, 244));
    tft->setCursor(76, 254);
    tft->print("ID: " + displayId);

    // Prompt: press button to start thermal scan
    tft->setTextSize(2);
    tft->setTextColor(teal, bg);
    tft->setCursor(52, 286);
    tft->print("Tekan tombol -> Mulai Scan Termal");
  }

  // =====================================================================
  //  TJpgDec CALLBACK — draws each decoded JPEG tile to TFT preview area
  // =====================================================================
  static bool jpegDrawCallback(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t* bitmap) {
    // Clip to camera preview bounds
    if (x + w <= 0 || y + h <= 0) return true;
    tft->draw16bitRGBBitmap(CAM_PREV_X + x, CAM_PREV_Y + y, bitmap, w, h);
    return true;
  }

  // =====================================================================
  //  FETCH JPEG FROM ESP32-CAM AND RENDER TO TFT (WiFi HTTP)
  //  Called every 500ms from the ST_IDLE loop.
  //  Requires TJpgDec library (included with Arduino_GFX_Library package).
  // =====================================================================
  void fetchAndDrawCamFrame() {
    if (!g_camIPKnown || WiFi.status() != WL_CONNECTED) {
      // Show "no cam" label if IP not known yet
      static unsigned long tNoCam = 0;
      if (millis() - tNoCam > 2000) {
        tNoCam = millis();
        tft->setTextSize(1);
        tft->setTextColor(tft->color565(148, 163, 184), tft->color565(30, 41, 59));
        tft->setCursor(CAM_PREV_X + 55, CAM_PREV_Y + 78);
        tft->print(g_camIPKnown ? "WiFi terputus..." : "Menunggu IP kamera...");
      }
      return;
    }

    WiFiClient wifiClient;
    HTTPClient http;
    String url = "http://" + g_camIP + "/capture";
    http.begin(wifiClient, url);
    http.addHeader("Connection", "close"); // Prevent ESP32-CAM socket exhaustion!
    http.setTimeout(800); // Give it slightly more time to transfer

    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      int jpegLen = http.getSize();
      // Guard: accept only sane JPEG sizes (1KB–80KB)
      if (jpegLen > 1000 && jpegLen < 81920) {
        uint8_t* buf = (uint8_t*)malloc(jpegLen);
        if (buf != nullptr) {
          WiFiClient* stream = http.getStreamPtr();
          int bytesRead = 0;
          unsigned long t0 = millis();
          
          // FAST BLOCK READ instead of 1-byte read
          while (bytesRead < jpegLen && millis() - t0 < 1000) {
            int avail = stream->available();
            if (avail > 0) {
              int toRead = (avail > (jpegLen - bytesRead)) ? (jpegLen - bytesRead) : avail;
              int readNow = stream->read(buf + bytesRead, toRead);
              if (readNow > 0) {
                bytesRead += readNow;
              }
            } else {
              delay(1); // yield to watchdog
            }
          }
          
          if (bytesRead == jpegLen) {
            // Decode JPEG directly to TFT via callback
            TJpgDec.setJpgScale(1);          // No downscale (QQVGA fits well)
            TJpgDec.setSwapBytes(false);      // Disable byte-swap if colors look weird
            TJpgDec.setCallback(jpegDrawCallback);
            TJpgDec.drawJpg(0, 0, buf, jpegLen);

            // Redraw teal border over preview to keep it crisp
            tft->drawRoundRect(CAM_PREV_X, CAM_PREV_Y, CAM_PREV_W, CAM_PREV_H, 4,
                               tft->color565(13, 148, 136));
          }
          free(buf);
        }
      }
    }
    http.end();
  }

  void setup() {
    Serial.begin(115200);
    srand(42);

    // WDT dimatikan untuk mencegah interupsi proses upload & SPI
    esp_task_wdt_deinit();

    pinMode(BTN_PIN, INPUT_PULLUP);
    btnPrevState = digitalRead(BTN_PIN); 

    pinMode(LED_GREEN, OUTPUT);
    pinMode(LED_YELLOW, OUTPUT);
    pinMode(LED_RED, OUTPUT);
    setStatusLED(1, false);

    // Inisialisasi Serial1 untuk komunikasi dengan ESP32-CAM
    Serial1.begin(115200, SERIAL_8N1, CAM_RX, CAM_TX);
    Serial.println("[BOOT] Serial1 (CAM Link) siap pada RX:40 TX:39");

    tft->begin(20000000);
    tft->setRotation(1);

    uint16_t sbg = tft->color565(8, 12, 22);
    tft->fillScreen(sbg);
    tft->setTextSize(2); tft->setTextColor(0xFFFF, sbg);
    tft->setCursor(10, 10); tft->print("THERMAL MON v4.1");
    tft->setTextSize(1); tft->setTextColor(tft->color565(120,130,150), sbg);
    tft->setCursor(10, 36); tft->print("Node 3 - Diabetic Foot Station");
    tft->setCursor(10, 56); tft->print("Menghubungkan sensor...");

    // Delay power-up agar sensor stabil
    delay(2000);
    Serial.println("[BOOT] Thermal Monitor v4.1 Starting...");

    bool ok = false;
    // Retry loop (5x percobaan) dengan Bus Clearing di tiap putaran
    for (int attempt = 1; attempt <= 5; attempt++) {
      Serial.printf("[BOOT] Percobaan ke-%d/5...\n", attempt);
      clearI2CBus(); // Lepaskan bus dari kondisi stuck jika ada
      Wire.begin(I2C_SDA, I2C_SCL);
      Wire.setClock(400000);
      Wire.setTimeOut(500);
      delay(100);
      if (mlx.begin(MLX90640_I2CADDR_DEFAULT, &Wire)) {
        ok = true;
        break;
      }
      delay(1000);
    }
    if (ok) {
      mlx.setMode(MLX90640_CHESS);
      mlx.setRefreshRate(MLX90640_8_HZ); 
      sensorOnline = true;
      tft->setTextColor(tft->color565(60,200,100), sbg);
      tft->setCursor(10, 56); tft->print("Sensor: TERHUBUNG");
    } else {
      tft->setTextColor(tft->color565(220,50,50), sbg);
      tft->setCursor(10, 56); tft->print("ERROR: Sensor GAGAL!");
      
      // Diagnostik I2C Bus Scanner jika inisialisasi gagal
      tft->setTextColor(tft->color565(200, 200, 200), sbg);
      tft->setCursor(10, 76); tft->print("Memindai I2C Bus...");
      
      int count = 0;
      int foundAddr = -1;
      for (byte address = 1; address < 127; address++) {
        Wire.beginTransmission(address);
        byte error = Wire.endTransmission();
        if (error == 0) {
          tft->setCursor(10 + (count % 3) * 100, 96 + (count / 3) * 16);
          tft->printf("Found: 0x%02X", address);
          foundAddr = address;
          count++;
        }
      }
      
      tft->setCursor(10, 160);
      if (count == 0) {
        tft->setTextColor(tft->color565(255, 100, 100), sbg);
        tft->print("-> Perangkat I2C TIDAK terdeteksi!");
        tft->setCursor(10, 180);
        tft->print("   Check: 1. Kabel VCC/GND/SDA/SCL longgar?");
        tft->setCursor(10, 200);
        tft->print("          2. Resistor Pull-up eksternal?");
      } else {
        tft->setTextColor(tft->color565(100, 255, 100), sbg);
        tft->printf("-> Ditemukan %d perangkat.", count);
        if (foundAddr != -1 && foundAddr != 0x33) {
          tft->setCursor(10, 180);
          tft->setTextColor(tft->color565(255, 150, 50), sbg);
          tft->printf("   Bukan MLX90640 (0x33). Alamat: 0x%02X", foundAddr);
        }
      }
      
      tft->setCursor(10, 220);
      tft->setTextColor(tft->color565(255, 255, 0), sbg);
      tft->print("TEKAN TOMBOL UNTUK MULAI ULANG (REBOOT)");

      flowState = ST_SENSOR_ERROR;
      setStatusLED(2, true);
      while (1) { 
        updateLedBlink(); 
        if (digitalRead(BTN_PIN) == LOW) {
          delay(200); // Debounce
          clearI2CBus();
          delay(100);
          ESP.restart(); // Reboot ESP32
        }
        delay(50); 
      }
    }

    calibrateAmbient();

    if (SEND_TO_FIREBASE && strlen(WIFI_SSID) > 0) {
      tft->setTextColor(tft->color565(120,130,150), sbg);
      tft->setCursor(10, 110); tft->print("Menghubungkan WiFi...");
      WiFi.mode(WIFI_STA);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      
      // NONAKTIFKAN WIFI SLEEP AGAR DAYA & CLOCK APB ESP32-S3 KONSISTEN
      WiFi.setSleep(false); 
      
      // LIMIT DAYA TRANSMISI WIFI (Mencegah drop tegangan regulator 3.3V)
      WiFi.setTxPower(WIFI_POWER_8_5dBm);

      int t = 0;
      while (WiFi.status() != WL_CONNECTED && t < 20) { 
        tft->fillRect(10, 126, (t+1)*12, 6, tft->color565(0, 150, 220));
        tft->drawRect(10, 126, 240, 6, tft->color565(45, 55, 75));
        delay(500); 
        t++; 
      }
    }

    delay(1000); 
    gotoIdle();
    tMlx = millis(); tClk = millis();
  }

  // =====================================================================
  //  LOOP
  // =====================================================================
  void loop() {
    unsigned long now = millis();
    updateLedBlink();

    // Read incoming body temp and QR data from ESP32-CAM via WiFi
    readCamDataHTTP();

    // Selalu baca frame di background agar sensor tidak crash/lockup (8Hz = 125ms)
    static int backgroundFailures = 0;
    if (sensorOnline && (now - tMlx >= 100)) { // increased poll rate and allowed in scanning
      tMlx = now;
      if (isSensorResponding()) {
        backgroundFailures = 0;
        if (isFrameReady()) {
          mlx.getFrame(frame);
        }
      } else {
        backgroundFailures++;
        Serial.printf("[SENSOR] Ping gagal di background (%d/3)\n", backgroundFailures);
        if (backgroundFailures >= 3) {
          recoverSensor();
          backgroundFailures = 0;
        }
      }
    }

    // Update uptime clock (1 detik)
    if (now - tClk >= 1000) {
      tClk = now;
      updateClock();
    }



    // Membaca tombol debouncing
    bool btnPress = false;
    bool nowState = digitalRead(BTN_PIN);
    if (nowState != btnPrevState) {
      if (nowState == LOW && (millis() - tBtnDebounce > 250)) {
        btnPress = true;
        tBtnDebounce = millis();
      }
      btnPrevState = nowState;
    }

    // Logika State Mesin Tombol
    switch (flowState) {
      case ST_IDLE:
        // Fetch and render camera preview frame every 500ms
        {
          static unsigned long tCamFrame = 0;
          if (now - tCamFrame >= 500) {
            tCamFrame = now;
            fetchAndDrawCamFrame();
          }
        }
        
        // ── AUTO START AFTER QR SCANNED ──
        if (g_qrId != "") {
          // Sesudah identitas muncul, tunggu 3 detik lalu otomatis masuk mode scan!
          if (now - tIdleEntry >= 3000) {
            Serial.println("[FLOW] Auto-Start -> Mulai Memindai...");
            gotoScanning();
          }
        }

        if (btnPress) {
          Serial.println("[FLOW] Tombol ditekan -> Mulai Memindai...");
          gotoScanning();
        }
        break;

      case ST_SCANNING:
        {
          unsigned long elapsed = now - tScanStart;
          
          if (elapsed < 3000) { 
            // 1. Render Live Heatmap selama 3 detik pertama
            for (int r = 0; r < 24; r++) {
              for (int c = 0; c < 32; c++) {
                float val = frame[r * 32 + c];
                float sum = val;
                int count = 1;
                if (r > 0) { sum += frame[(r - 1) * 32 + c]; count++; }
                if (r < 23) { sum += frame[(r + 1) * 32 + c]; count++; }
                if (c > 0) { sum += frame[r * 32 + (c - 1)]; count++; }
                if (c < 31) { sum += frame[r * 32 + (c + 1)]; count++; }
                if (r > 0 && c > 0) { sum += frame[(r - 1) * 32 + (c - 1)]; count++; }
                if (r > 0 && c < 31) { sum += frame[(r - 1) * 32 + (c + 1)]; count++; }
                if (r < 23 && c > 0) { sum += frame[(r + 1) * 32 + (c - 1)]; count++; }
                if (r < 23 && c < 31) { sum += frame[(r + 1) * 32 + (c + 1)]; count++; }
                smoothFrame[r * 32 + c] = sum / count;
              }
            }
            float mn = smoothFrame[0];
            float mx = smoothFrame[0];
            for (int i = 1; i < 768; i++) {
              if (smoothFrame[i] < mn) mn = smoothFrame[i];
              if (smoothFrame[i] > mx) mx = smoothFrame[i];
            }
            if (mx < mn + 5.0f) mx = mn + 5.0f;
            renderHeatmap(mn, mx);
          } else {
            // 2. Setelah 3 detik, ambil kesimpulan, kirim ke firebase, lalu ke Hasil
            Serial.println("[FLOW] Menganalisis kaki diabetes...");
            computeFootZones(smoothFrame);
            
            float mn = smoothFrame[0];
            float mx = smoothFrame[0];
            for (int i = 1; i < 768; i++) {
              if (smoothFrame[i] < mn) mn = smoothFrame[i];
              if (smoothFrame[i] > mx) mx = smoothFrame[i];
            }
            if (mx < mn + 5.0f) mx = mn + 5.0f;

            if (WiFi.status() == WL_CONNECTED) {
              sendResultToFirebase(smoothFrame, mn, mx, g_qrId, leftFootAvg, rightFootAvg, overallRisk);
            }
            
            Serial.println("[FLOW] Selesai Memindai -> Ke Hasil");
            gotoHasil();
          }
        }
        break;

      case ST_HASIL:
        // ── AUTO RESET DEMO FLOW ──
        // Tetap di halaman hasil selama 10 detik, lalu kembali ke Idle otomatis
        if (now - tHasilEntry >= 10000) {
          Serial.println("[FLOW] Auto-Reset -> Kembali ke Standby...");
          gotoIdle();
        }
        
        if (btnPress) {
          Serial.println("[FLOW] Tombol ditekan -> Reset ke Standby...");
          gotoIdle(); 
        }
        break;

      case ST_SENSOR_ERROR:
        break;
    }

    delay(1);
  }