#pragma once

#include "esp_err.h"
#include "sdkconfig.h"

#ifdef __cplusplus
extern "C" {
#endif

#define WIFI_SSID_PRIMARY CONFIG_ASSISTANT_WIFI_SSID
#define WIFI_PASS_PRIMARY CONFIG_ASSISTANT_WIFI_PASSWORD
#define WIFI_SSID_ALT     CONFIG_ASSISTANT_WIFI_SSID_ALT
#define WIFI_PASS_ALT     CONFIG_ASSISTANT_WIFI_PASSWORD_ALT
#define WIFI_SSID_2G      CONFIG_ASSISTANT_WIFI_SSID

esp_err_t wifi_init_sta(void);

#ifdef __cplusplus
}
#endif

