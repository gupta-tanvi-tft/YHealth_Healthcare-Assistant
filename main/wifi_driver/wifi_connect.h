#pragma once

#include "esp_err.h"
#include "sdkconfig.h"

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// 🏥 CLINIC WI-FI CONFIGURATION — ONLY EDIT THIS FILE TO CHANGE WI-FI!
// ============================================================================
// When deploying the speaker at a new doctor's clinic:
// 1. Enter the clinic's Wi-Fi name in CLINIC_WIFI_SSID
// 2. Enter the clinic's Wi-Fi password in CLINIC_WIFI_PASSWORD
// 3. (Optional) Set CLINIC_HOTSPOT_SSID to the doctor's phone hotspot as backup.
// ============================================================================

#define CLINIC_WIFI_SSID     "iPhone"        // <-- Put Clinic Wi-Fi Name (SSID)
#define CLINIC_WIFI_PASSWORD "12348741"       // <-- Put Clinic Wi-Fi Password

// Backup / Fallback Network
#define CLINIC_HOTSPOT_SSID  "iPhone"        // <-- Mobile Hotspot
#define CLINIC_HOTSPOT_PASS  "12348741"       // <-- Mobile Hotspot Password

// ============================================================================
// Automatic Macro Resolution
// ============================================================================
#ifdef CLINIC_WIFI_SSID
  #define WIFI_SSID_PRIMARY CLINIC_WIFI_SSID
  #define WIFI_PASS_PRIMARY CLINIC_WIFI_PASSWORD
#else
  #define WIFI_SSID_PRIMARY CONFIG_ASSISTANT_WIFI_SSID
  #define WIFI_PASS_PRIMARY CONFIG_ASSISTANT_WIFI_PASSWORD
#endif

#ifdef CLINIC_HOTSPOT_SSID
  #define WIFI_SSID_ALT     CLINIC_HOTSPOT_SSID
  #define WIFI_PASS_ALT     CLINIC_HOTSPOT_PASS
#else
  #define WIFI_SSID_ALT     CONFIG_ASSISTANT_WIFI_SSID_ALT
  #define WIFI_PASS_ALT     CONFIG_ASSISTANT_WIFI_PASSWORD_ALT
#endif

#define WIFI_SSID_2G      WIFI_SSID_PRIMARY

esp_err_t wifi_init_sta(void);

#ifdef __cplusplus
}
#endif
