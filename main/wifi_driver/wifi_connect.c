#include "wifi_connect.h"
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"

static const char *TAG = "wifi_connect";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t s_wifi_event_group;
static int s_retry_num = 0;
static int s_ap_index = 0; // 0: Primary (TFTus-WiFi), 1: 2.4G (TFTus-WiFi), 2: Alt (TFTus-WiFi)

static const char* s_ssids[] = { WIFI_SSID_PRIMARY, WIFI_SSID_2G, WIFI_SSID_ALT };
static const char* s_passes[] = { WIFI_PASS_PRIMARY, WIFI_PASS_PRIMARY, WIFI_PASS_ALT };

static void switch_to_next_ap(void)
{
    s_ap_index = (s_ap_index + 1) % 3;
    s_retry_num = 0;

    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, s_ssids[s_ap_index], sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password, s_passes[s_ap_index], sizeof(wifi_config.sta.password));
    wifi_config.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    wifi_config.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
    wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    wifi_config.sta.pmf_cfg.capable = true;
    wifi_config.sta.pmf_cfg.required = false;

    ESP_LOGI(TAG, "🔄 Switching Wi-Fi target AP to [%d/3]: SSID='%s'", s_ap_index + 1, s_ssids[s_ap_index]);
    esp_wifi_disconnect();
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    esp_wifi_connect();
}

static void event_handler(void* arg, esp_event_base_t event_base,
                            int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t* dis = (wifi_event_sta_disconnected_t*) event_data;
        s_retry_num++;
        ESP_LOGW(TAG, "Wi-Fi Disconnected from SSID '%s' (Reason: %d, Retry: %d/5)", 
                 s_ssids[s_ap_index], dis ? dis->reason : 0, s_retry_num);

        if (s_retry_num >= 5) {
            switch_to_next_ap();
        } else {
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_wifi_connect();
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "✅ Connected! Got IP: " IPSTR " on SSID '%s'", IP2STR(&event->ip_info.ip), s_ssids[s_ap_index]);
        s_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_init_sta(void)
{
    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
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
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &event_handler,
                                                        NULL,
                                                        &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &event_handler,
                                                        NULL,
                                                        &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .scan_method = WIFI_ALL_CHANNEL_SCAN,
            .sort_method = WIFI_CONNECT_AP_BY_SIGNAL,
            .threshold.authmode = WIFI_AUTH_OPEN,
            .pmf_cfg = {
                .capable = true,
                .required = false,
            },
            .sae_pwe_h2e = WPA3_SAE_PWE_BOTH,
        },
    };
    strncpy((char *)wifi_config.sta.ssid, s_ssids[0], sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password, s_passes[0], sizeof(wifi_config.sta.password));

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    esp_wifi_set_max_tx_power(78); // Max transmission power ~20dBm for rock-solid signal coverage

    ESP_LOGI(TAG, "wifi_init_sta finished (Power Save: DISABLED). Connecting to SSID '%s'...", s_ssids[0]);

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE,
            pdFALSE,
            portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Rock-solid Wi-Fi link established with SSID: %s", s_ssids[s_ap_index]);
        return ESP_OK;
    } else {
        ESP_LOGE(TAG, "Failed to establish Wi-Fi connection!");
        return ESP_FAIL;
    }
}

