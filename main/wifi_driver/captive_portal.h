#pragma once

#include "esp_err.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Starts the SoftAP Captive Portal for phone-based Wi-Fi provisioning.
 * 
 * 1. Launches SoftAP (SSID: "YHealth-Setup-XXXX", Open Auth)
 * 2. Starts RFC-compliant DNS Hijacking Server on port 53 (redirects all queries to 192.168.4.1)
 * 3. Starts HTTP Web Server on port 80 with automatic Captive Portal redirects
 * 4. Provides Wi-Fi network scanning, credential saving to NVS Flash, and auto-restart
 * 
 * @param custom_ap_name Optional custom SSID name. If NULL, auto-generates "YHealth-Setup-<MAC>"
 * @return esp_err_t ESP_OK on success
 */
esp_err_t captive_portal_start(const char *custom_ap_name);

/**
 * @brief Stops HTTP and DNS servers, and cleans up SoftAP.
 */
void captive_portal_stop(void);

/**
 * @brief Checks whether the Captive Portal is actively running.
 */
bool captive_portal_is_active(void);

#ifdef __cplusplus
}
#endif
