#include "wifi_connect.h"
#include "captive_portal.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "esp_sntp.h"
#include <time.h>
#include <string.h>


static char s_nvs_ssid[33] = {0};
static char s_nvs_pass[65] = {0};
static bool s_has_nvs_wifi = false;

static const char *TAG = "wifi_connect";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1

static EventGroupHandle_t s_wifi_event_group;
static int s_retry_num = 0;
static int s_ap_index =
    0; // 0: Primary (TFTus-WiFi), 1: 2.4G (TFTus-WiFi), 2: Alt (TFTus-WiFi)

static const char *s_ssids[] = {WIFI_SSID_PRIMARY, WIFI_SSID_PRIMARY, WIFI_SSID_PRIMARY};
static const char *s_passes[] = {WIFI_PASS_PRIMARY, WIFI_PASS_PRIMARY,
                                 WIFI_PASS_PRIMARY};

static void switch_to_next_ap(void) {
  // If custom Wi-Fi credentials were provisioned via USB/NVS and failed, launch Captive Portal!
  if (s_has_nvs_wifi) {
    ESP_LOGW(TAG, "⚠️ [NETWORK_LOG] Saved Wi-Fi '%s' not reachable. Launching SoftAP Captive Portal for phone setup...", s_nvs_ssid);
    captive_portal_start(NULL);
    return;
  }

  s_ap_index = (s_ap_index + 1) % 3;
  s_retry_num = 0;

  // If all default SSIDs have been tried, launch SoftAP Captive Portal!
  if (s_ap_index == 0) {
    ESP_LOGW(TAG, "⚠️ All fallback Wi-Fi networks unreachable. Starting SoftAP Captive Portal...");
    captive_portal_start(NULL);
    return;
  }

  wifi_config_t wifi_config = {0};
  strncpy((char *)wifi_config.sta.ssid, s_ssids[s_ap_index],
          sizeof(wifi_config.sta.ssid));
  strncpy((char *)wifi_config.sta.password, s_passes[s_ap_index],
          sizeof(wifi_config.sta.password));
  wifi_config.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
  wifi_config.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
  wifi_config.sta.threshold.authmode =
      (strlen(s_passes[s_ap_index]) > 0) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
  wifi_config.sta.pmf_cfg.capable = true;
  wifi_config.sta.pmf_cfg.required = false;

  ESP_LOGI(TAG, "🔄 Switching Wi-Fi target AP to [%d/3]: SSID='%s'",
           s_ap_index + 1, s_ssids[s_ap_index]);
  esp_wifi_disconnect();
  esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
  esp_wifi_connect();
}

static void event_handler(void *arg, esp_event_base_t event_base,
                          int32_t event_id, void *event_data) {
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  } else if (event_base == WIFI_EVENT &&
             event_id == WIFI_EVENT_STA_DISCONNECTED) {
    wifi_event_sta_disconnected_t *dis =
        (wifi_event_sta_disconnected_t *)event_data;
    s_retry_num++;
    ESP_LOGW(TAG, "⚠️ [NETWORK_LOG] WIFI_DISCONNECTED | SSID: '%s' | Reason Code: %d | Retry: %d/5",
             s_ssids[s_ap_index], dis ? dis->reason : 0, s_retry_num);

    if (s_retry_num >= 5) {
      switch_to_next_ap();
    } else {
      esp_wifi_connect();
    }
  } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
    ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
    wifi_ap_record_t ap_info;
    int rssi = -50;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
      rssi = ap_info.rssi;
    }
    ESP_LOGI(TAG, "📶 [NETWORK_LOG] WIFI_CONNECTED | SSID: '%s' | IP: " IPSTR " | Gateway: " IPSTR " | RSSI: %d dBm",
             s_ssids[s_ap_index], IP2STR(&event->ip_info.ip), IP2STR(&event->ip_info.gw), rssi);
    s_retry_num = 0;
    xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);

    // Synchronize Real-Time Clock with NTP in Indian Standard Time (IST, UTC+5:30)
    if (!esp_sntp_enabled()) {
      ESP_LOGI(TAG, "⏰ Initializing Real-Time Clock via SNTP for IST (UTC+5:30)...");
      esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
      esp_sntp_setservername(0, "pool.ntp.org");
      esp_sntp_setservername(1, "time.google.com");
      esp_sntp_init();
      setenv("TZ", "IST-5:30", 1);
      tzset();
    }
  }
}

esp_err_t wifi_init_sta(void) {
  // Initialize NVS
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
      ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }
  ESP_ERROR_CHECK(ret);

  s_wifi_event_group = xEventGroupCreate();

  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();

  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&cfg));

  esp_event_handler_instance_t instance_any_id;
  esp_event_handler_instance_t instance_got_ip;
  ESP_ERROR_CHECK(esp_event_handler_instance_register(
      WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, &instance_any_id));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(
      IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, &instance_got_ip));

  wifi_config_t wifi_config = {
      .sta =
          {
              .scan_method = WIFI_ALL_CHANNEL_SCAN,
              .sort_method = WIFI_CONNECT_AP_BY_SIGNAL,
              .threshold.authmode = WIFI_AUTH_WPA2_PSK,
              .pmf_cfg =
                  {
                      .capable = true,
                      .required = false,
                  },
              .sae_pwe_h2e = WPA3_SAE_PWE_UNSPECIFIED,
          },
  };
  // Check if custom Wi-Fi credentials were flashed via USB / NVS
  nvs_handle_t nvs_h;
  if (nvs_open("storage", NVS_READONLY, &nvs_h) == ESP_OK) {
    size_t ssid_len = sizeof(s_nvs_ssid);
    size_t pass_len = sizeof(s_nvs_pass);
    if (nvs_get_str(nvs_h, "wifi_ssid", s_nvs_ssid, &ssid_len) == ESP_OK &&
        strlen(s_nvs_ssid) > 0) {
      nvs_get_str(nvs_h, "wifi_pass", s_nvs_pass, &pass_len);
      s_has_nvs_wifi = true;
      ESP_LOGI(
          TAG,
          "Loaded custom Wi-Fi from NVS Flash (USB Provisioned): SSID='%s'",
          s_nvs_ssid);
    }
    nvs_close(nvs_h);
  }

  if (s_has_nvs_wifi) {
    strncpy((char *)wifi_config.sta.ssid, s_nvs_ssid,
            sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password, s_nvs_pass,
            sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = (strlen(s_nvs_pass) > 0) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
  } else {
    strncpy((char *)wifi_config.sta.ssid, s_ssids[0],
            sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password, s_passes[0],
            sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = (strlen(s_passes[0]) > 0) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
  }

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
  ESP_ERROR_CHECK(esp_wifi_start());
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
  esp_wifi_set_max_tx_power(
      78); // Max transmission power ~20dBm for rock-solid signal coverage

  ESP_LOGI(TAG,
           "wifi_init_sta finished (Power Save: DISABLED). Connecting to SSID "
           "'%s'...",
           s_ssids[0]);

  EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                         WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                         pdFALSE, pdFALSE, pdMS_TO_TICKS(14000));

  if (bits & WIFI_CONNECTED_BIT) {
    const char *active_ssid = s_has_nvs_wifi ? s_nvs_ssid : s_ssids[s_ap_index];
    ESP_LOGI(TAG, "Rock-solid Wi-Fi link established with SSID: %s", active_ssid);
    return ESP_OK;
  } else {
    ESP_LOGW(TAG, "⚠️ Wi-Fi not reachable within 14s. Launching SoftAP Captive Portal: 'YHealth-Setup'...");
    captive_portal_start(NULL);
    // Keep task alive waiting for phone configuration & restart
    while (captive_portal_is_active()) {
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
    return ESP_OK;
  }
}
