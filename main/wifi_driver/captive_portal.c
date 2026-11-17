#include "captive_portal.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_wifi_default.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "captive_portal";

static httpd_handle_t s_http_server = NULL;
static TaskHandle_t s_dns_task_handle = NULL;
static bool s_is_active = false;
static esp_netif_t *s_ap_netif = NULL;
static char s_ap_ssid[33] = {0};

// DNS Header format (RFC 1035)
typedef struct __attribute__((packed)) {
  uint16_t id;
  uint16_t flags;
  uint16_t qd_count;
  uint16_t an_count;
  uint16_t ns_count;
  uint16_t ar_count;
} dns_header_t;

// ============================================================================
// 1. URL DECODER HELPER
// ============================================================================
static void url_decode(char *dst, const char *src, size_t dst_len) {
  size_t d = 0;
  for (size_t s = 0; src[s] != '\0' && d < dst_len - 1; s++) {
    if (src[s] == '+') {
      dst[d++] = ' ';
    } else if (src[s] == '%' && isxdigit((int)src[s + 1]) &&
               isxdigit((int)src[s + 2])) {
      char hex[3] = {src[s + 1], src[s + 2], '\0'};
      dst[d++] = (char)strtol(hex, NULL, 16);
      s += 2;
    } else {
      dst[d++] = src[s];
    }
  }
  dst[d] = '\0';
}

static void parse_query_val(const char *body, const char *key, char *val,
                            size_t max_len) {
  val[0] = '\0';
  char search[64];
  snprintf(search, sizeof(search), "%s=", key);
  const char *p = strstr(body, search);
  if (!p)
    return;
  p += strlen(search);
  const char *end = strchr(p, '&');
  size_t len = end ? (size_t)(end - p) : strlen(p);
  char raw[256] = {0};
  if (len >= sizeof(raw))
    len = sizeof(raw) - 1;
  strncpy(raw, p, len);
  raw[len] = '\0';
  url_decode(val, raw, max_len);
}

// ============================================================================
// 2. DNS HIJACKING SERVER (Port 53 UDP)
// Responds to ALL domain queries with 192.168.4.1 to trigger Captive Portal
// ============================================================================
static void dns_server_task(void *pvParameters) {
  char rx_buffer[256];
  char tx_buffer[300];
  struct sockaddr_in server_addr, client_addr;
  socklen_t client_addr_len = sizeof(client_addr);

  int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
  if (sock < 0) {
    ESP_LOGE(TAG, "DNS socket creation failed: errno %d", errno);
    vTaskDelete(NULL);
    return;
  }

  int opt = 1;
  setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

  server_addr.sin_family = AF_INET;
  server_addr.sin_addr.s_addr = htonl(INADDR_ANY);
  server_addr.sin_port = htons(53);

  if (bind(sock, (struct sockaddr *)&server_addr, sizeof(server_addr)) < 0) {
    ESP_LOGE(TAG, "DNS socket bind failed on port 53: errno %d", errno);
    close(sock);
    vTaskDelete(NULL);
    return;
  }

  ESP_LOGI(TAG, "🌐 DNS Server active on UDP port 53 (RFC 1035 Captive Hijack -> 192.168.4.1)");

  while (s_is_active) {
    int len = recvfrom(sock, rx_buffer, sizeof(rx_buffer), 0,
                       (struct sockaddr *)&client_addr, &client_addr_len);
    if (len < 12)
      continue; // Minimum valid DNS header size

    // Duplicate question into answer buffer
    memcpy(tx_buffer, rx_buffer, len);
    dns_header_t *hdr = (dns_header_t *)tx_buffer;

    // Response flags: Standard query response, Authoritative, Recursion Available, No Error
    hdr->flags = htons(0x8180);
    hdr->an_count = hdr->qd_count;
    hdr->ns_count = 0;
    hdr->ar_count = 0;

    int tx_len = len;

    // A-Record response pointing to 192.168.4.1 (ESP32 AP gateway)
    const uint8_t a_record[] = {
        0xc0, 0x0c,             // Name pointer: byte offset 12 (first question)
        0x00, 0x01,             // Type: A (IPv4)
        0x00, 0x01,             // Class: IN
        0x00, 0x00, 0x00, 0x3c, // TTL: 60 seconds
        0x00, 0x04,             // Data length: 4 bytes
        192,  168,  4,    1     // RDATA: 192.168.4.1
    };

    if (tx_len + sizeof(a_record) <= sizeof(tx_buffer)) {
      memcpy(tx_buffer + tx_len, a_record, sizeof(a_record));
      tx_len += sizeof(a_record);
      sendto(sock, tx_buffer, tx_len, 0, (struct sockaddr *)&client_addr,
             client_addr_len);
    }
  }

  close(sock);
  vTaskDelete(NULL);
}

// ============================================================================
// 3. CAPTIVE PORTAL HTML PAGE (Mobile-Optimized & Healthcare Styled)
// ============================================================================
static const char CAPTIVE_HTML_PAGE[] =
    "<!DOCTYPE html><html lang='en'><head>"
    "<meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no'>"
    "<title>YHealth Speaker Setup</title>"
    "<style>"
    ":root{--bg:#07111e;--card:#0f1d2e;--accent:#10b981;--text:#f8fafc;--muted:#94a3b8;--border:#1e293b;--warn:#f59e0b;}"
    "*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}"
    "body{background:var(--bg);color:var(--text);padding:18px;min-height:100vh;display:flex;flex-direction:column;align-items:center;}"
    ".wrap{max-width:440px;width:100%;margin-top:10px;}"
    ".hdr{text-align:center;margin-bottom:20px;}"
    ".logo{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;background:rgba(16,185,129,0.15);border:1px solid var(--accent);border-radius:12px;margin-bottom:12px;color:var(--accent);font-size:24px;}"
    "h1{font-size:20px;font-weight:800;color:var(--text);letter-spacing:-0.02em;}"
    ".sub{font-size:13px;color:var(--muted);margin-top:4px;}"
    ".badge{display:inline-block;background:#1e293b;color:#38bdf8;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-top:8px;font-family:monospace;letter-spacing:0.04em;border:1px solid #334155;}"
    ".card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:22px;box-shadow:0 10px 30px rgba(0,0,0,0.5);}"
    "label{display:block;font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;}"
    ".field{margin-bottom:18px;position:relative;}"
    "input,select{width:100%;padding:13px 14px;background:#091422;border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:15px;outline:none;transition:border 0.2s;}"
    "input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(16,185,129,0.25);}"
    ".toggle-btn{position:absolute;right:12px;top:37px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:4px;}"
    ".btn{width:100%;background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:800;font-size:15px;padding:14px;border:none;border-radius:10px;cursor:pointer;box-shadow:0 4px 15px rgba(16,185,129,0.35);transition:all 0.2s;margin-top:6px;}"
    ".btn:hover{filter:brightness(1.08);transform:translateY(-1px);}"
    ".btn:active{transform:translateY(1px);}"
    ".scan-btn{background:#1e293b;color:#38bdf8;border:1px solid #334155;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;float:right;margin-bottom:6px;}"
    ".adv-toggle{text-align:center;font-size:12px;color:var(--muted);margin-top:16px;cursor:pointer;text-decoration:underline;}"
    ".adv-box{display:none;margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);}"
    ".footer{text-align:center;font-size:11px;color:var(--muted);margin-top:20px;}"
    "</style></head><body>"
    "<div class='wrap'>"
    "<div class='hdr'>"
    "<div class='logo'>🎙️</div>"
    "<h1>YHealth Smart Speaker</h1>"
    "<div class='sub'>Instant Wi-Fi & Cloud Provisioning</div>"
    "<div class='badge' id='dev-id'>SPK-0000002</div>"
    "</div>"
    "<div class='card'>"
    "<form action='/save' method='POST' id='setup-form'>"
    "<div class='field'>"
    "<button type='button' class='scan-btn' onclick='scanWifi()'>↻ Scan</button>"
    "<label for='ssid-select'>Available 2.4 GHz Wi-Fi</label>"
    "<select id='ssid-select' onchange='onSelectSsid()'><option value=''>Scanning networks...</option></select>"
    "</div>"
    "<div class='field' id='custom-ssid-box' style='display:none;'>"
    "<label for='ssid'>Network Name (SSID)</label>"
    "<input type='text' id='ssid' name='ssid' placeholder='e.g., iPhone Hotspot or Clinic-WiFi' autocomplete='off'>"
    "</div>"
    "<div class='field'>"
    "<label for='pass'>Wi-Fi Password</label>"
    "<input type='password' id='pass' name='pass' placeholder='••••••••••••' autocomplete='off'>"
    "<button type='button' class='toggle-btn' onclick='togglePass()'>Show</button>"
    "</div>"
    "<div class='adv-toggle' onclick='toggleAdv()'>⚙️ Advanced Cloud Relay Settings</div>"
    "<div class='adv-box' id='adv-box'>"
    "<div class='field'>"
    "<label for='host'>Cloud Relay Server</label>"
    "<input type='text' id='host' name='host' value='speakermonitoring.yhealth.me'>"
    "</div>"
    "<div class='field'>"
    "<label for='port'>Port (443 = Secure WSS)</label>"
    "<input type='number' id='port' name='port' value='443'>"
    "</div>"
    "</div>"
    "<button type='submit' class='btn' id='sub-btn'>Connect Speaker ➔</button>"
    "</form>"
    "</div>"
    "<div class='footer'>YHealth Healthcare Intelligence • Zero-Trust Hardware</div>"
    "</div>"
    "<script>"
    "function togglePass(){"
    "  var p=document.getElementById('pass');"
    "  p.type = (p.type==='password')?'text':'password';"
    "}"
    "function toggleAdv(){"
    "  var b=document.getElementById('adv-box');"
    "  b.style.display = (b.style.display==='block')?'none':'block';"
    "}"
    "function onSelectSsid(){"
    "  var sel=document.getElementById('ssid-select');"
    "  var cbox=document.getElementById('custom-ssid-box');"
    "  var inp=document.getElementById('ssid');"
    "  if(sel.value==='__custom__'){"
    "    cbox.style.display='block'; inp.value=''; inp.focus();"
    "  }else{"
    "    cbox.style.display='none'; inp.value=sel.value;"
    "  }"
    "}"
    "function scanWifi(){"
    "  var sel=document.getElementById('ssid-select');"
    "  sel.innerHTML='<option value=\"\">Scanning networks...</option>';"
    "  fetch('/scan').then(r=>r.json()).then(data=>{"
    "    sel.innerHTML='';"
    "    if(data.length===0){"
    "      sel.innerHTML='<option value=\"__custom__\">No networks found (Enter manually)</option>';"
    "      onSelectSsid(); return;"
    "    }"
    "    sel.innerHTML='<option value=\"\">-- Select Wi-Fi Network --</option>';"
    "    data.forEach(n=>{"
    "      var opt=document.createElement('option');"
    "      opt.value=n.ssid; opt.textContent=n.ssid+' ('+n.rssi+' dBm)';"
    "      sel.appendChild(opt);"
    "    });"
    "    var cust=document.createElement('option');"
    "    cust.value='__custom__'; cust.textContent='✍️ Enter other network manually...';"
    "    sel.appendChild(cust);"
    "  }).catch(e=>{"
    "    sel.innerHTML='<option value=\"__custom__\">✍️ Enter network manually</option>';"
    "    onSelectSsid();"
    "  });"
    "}"
    "window.onload=function(){ scanWifi(); };"
    "document.getElementById('setup-form').onsubmit=function(){"
    "  var btn=document.getElementById('sub-btn');"
    "  btn.disabled=true; btn.textContent='Saving & Rebooting Speaker...';"
    "};"
    "</script></body></html>";

static const char CAPTIVE_SUCCESS_HTML[] =
    "<!DOCTYPE html><html lang='en'><head>"
    "<meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Wi-Fi Provisioned</title>"
    "<style>"
    "body{background:#07111e;color:#f8fafc;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;text-align:center;}"
    ".card{background:#0f1d2e;border:1px solid #1e293b;border-radius:16px;padding:30px;max-width:400px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.5);}"
    ".icon{font-size:48px;margin-bottom:14px;}"
    "h2{color:#10b981;margin-bottom:8px;font-size:22px;}"
    "p{color:#94a3b8;font-size:14px;line-height:1.5;margin-bottom:16px;}"
    ".alert{background:rgba(16,185,129,0.15);border:1px solid #10b981;border-radius:8px;padding:12px;color:#a7f3d0;font-size:13px;font-weight:600;}"
    "</style></head><body>"
    "<div class='card'>"
    "<div class='icon'>✅</div>"
    "<h2>Wi-Fi Credentials Saved!</h2>"
    "<p>The speaker has saved your Wi-Fi credentials to NVS Flash and is rebooting now to connect.</p>"
    "<div class='alert'>You may now close this window and disconnect from setup Wi-Fi.</div>"
    "</div></body></html>";

// ============================================================================
// 4. HTTP REQUEST HANDLERS
// ============================================================================
static esp_err_t root_get_handler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  httpd_resp_send(req, CAPTIVE_HTML_PAGE, HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// Redirect all captive detection URLs (Apple / Android / Windows) to 192.168.4.1
static esp_err_t captive_redirect_handler(httpd_req_t *req) {
  // If requesting root or setup, serve directly
  if (strcmp(req->uri, "/") == 0) {
    return root_get_handler(req);
  }
  // Otherwise, issue HTTP 302 Found redirect to http://192.168.4.1/
  httpd_resp_set_status(req, "302 Found");
  httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
  httpd_resp_send(req, NULL, 0);
  return ESP_OK;
}

static void restart_speaker_task(void *pvParameters) {
  vTaskDelay(pdMS_TO_TICKS(1200));
  ESP_LOGI(TAG, "🔄 Rebooting speaker to connect to newly configured Wi-Fi...");
  esp_restart();
}

static esp_err_t save_post_handler(httpd_req_t *req) {
  char buf[512] = {0};
  int ret = 0, remaining = req->content_len;

  if (remaining >= sizeof(buf)) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  while (remaining > 0) {
    ret = httpd_req_recv(req, buf + strlen(buf), remaining);
    if (ret <= 0) {
      if (ret == HTTPD_SOCK_ERR_TIMEOUT)
        continue;
      httpd_resp_send_500(req);
      return ESP_FAIL;
    }
    remaining -= ret;
  }

  char ssid[33] = {0};
  char pass[65] = {0};
  char host[128] = "speakermonitoring.yhealth.me";
  char port[8] = "443";

  parse_query_val(buf, "ssid", ssid, sizeof(ssid));
  parse_query_val(buf, "pass", pass, sizeof(pass));
  parse_query_val(buf, "host", host, sizeof(host));
  parse_query_val(buf, "port", port, sizeof(port));

  if (strlen(ssid) == 0) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Wi-Fi SSID is required!");
    return ESP_FAIL;
  }

  ESP_LOGI(TAG, "💾 Saving Wi-Fi from Captive Portal: SSID='%s' Server='%s:%s'",
           ssid, host, port);

  // Write to NVS flash storage
  nvs_handle_t nvs_h;
  if (nvs_open("storage", NVS_READWRITE, &nvs_h) == ESP_OK) {
    nvs_set_str(nvs_h, "wifi_ssid", ssid);
    nvs_set_str(nvs_h, "wifi_pass", pass);
    nvs_set_str(nvs_h, "server_host", host);
    nvs_set_str(nvs_h, "server_port", port);
    nvs_commit(nvs_h);
    nvs_close(nvs_h);
    ESP_LOGI(TAG, "✅ Credentials successfully burned into NVS Flash!");
  } else {
    ESP_LOGE(TAG, "❌ Failed to open NVS storage for writing!");
  }

  httpd_resp_set_type(req, "text/html");
  httpd_resp_send(req, CAPTIVE_SUCCESS_HTML, HTTPD_RESP_USE_STRLEN);

  // Launch background reboot task
  xTaskCreate(restart_speaker_task, "restart_task", 2048, NULL, 5, NULL);
  return ESP_OK;
}

// Scans available 2.4 GHz Wi-Fi networks and returns JSON array
static esp_err_t scan_get_handler(httpd_req_t *req) {
  wifi_scan_config_t scan_config = {
      .ssid = NULL,
      .bssid = NULL,
      .channel = 0,
      .show_hidden = false,
      .scan_type = WIFI_SCAN_TYPE_ACTIVE,
  };

  esp_wifi_scan_start(&scan_config, true); // Blocking scan

  uint16_t ap_count = 0;
  esp_wifi_scan_get_ap_num(&ap_count);
  if (ap_count > 15)
    ap_count = 15;

  wifi_ap_record_t *ap_list = malloc(sizeof(wifi_ap_record_t) * (ap_count > 0 ? ap_count : 1));
  if (ap_list && ap_count > 0) {
    esp_wifi_scan_get_ap_records(&ap_count, ap_list);
  }

  char *json = malloc(2048);
  if (!json) {
    free(ap_list);
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  strcpy(json, "[");
  bool first = true;
  for (int i = 0; i < ap_count; i++) {
    if (strlen((char *)ap_list[i].ssid) == 0)
      continue;
    char entry[128];
    snprintf(entry, sizeof(entry), "%s{\"ssid\":\"%s\",\"rssi\":%d}",
             first ? "" : ",", (char *)ap_list[i].ssid, ap_list[i].rssi);
    first = false;
    strcat(json, entry);
  }
  strcat(json, "]");

  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);

  free(json);
  free(ap_list);
  return ESP_OK;
}

// ============================================================================
// 5. LIFECYCLE MANAGEMENT
// ============================================================================
esp_err_t captive_portal_start(const char *custom_ap_name) {
  if (s_is_active) {
    ESP_LOGW(TAG, "Captive portal is already running.");
    return ESP_OK;
  }

  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_WIFI_STA);

  if (custom_ap_name && strlen(custom_ap_name) > 0) {
    strncpy(s_ap_ssid, custom_ap_name, sizeof(s_ap_ssid) - 1);
  } else {
    snprintf(s_ap_ssid, sizeof(s_ap_ssid), "YHealth-Setup-%02X%02X", mac[4],
             mac[5]);
  }

  ESP_LOGI(TAG, "🚀 Starting SoftAP Captive Portal: SSID='%s' IP=192.168.4.1",
           s_ap_ssid);

  // Initialize SoftAP netif
  if (!s_ap_netif) {
    s_ap_netif = esp_netif_create_default_wifi_ap();
  }

  // Set mode to AP+STA so scanning still works
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));

  wifi_config_t ap_config = {
      .ap = {
          .ssid_len = strlen(s_ap_ssid),
          .channel = 1,
          .authmode = WIFI_AUTH_OPEN,
          .max_connection = 4,
          .beacon_interval = 100,
      },
  };
  strncpy((char *)ap_config.ap.ssid, s_ap_ssid, sizeof(ap_config.ap.ssid));

  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));

  s_is_active = true;

  // 1. Start DNS Hijacking Task on port 53 UDP
  xTaskCreatePinnedToCore(dns_server_task, "dns_hijack_task", 3584, NULL, 5,
                          &s_dns_task_handle, 0);

  // 2. Start HTTP Web Server on port 80
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  config.ctrl_port = 32768;
  config.max_open_sockets = 7;
  config.lru_purge_enable = true;

  if (httpd_start(&s_http_server, &config) == ESP_OK) {
    httpd_uri_t root_uri = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_get_handler,
    };
    httpd_register_uri_handler(s_http_server, &root_uri);

    httpd_uri_t save_uri = {
        .uri = "/save",
        .method = HTTP_POST,
        .handler = save_post_handler,
    };
    httpd_register_uri_handler(s_http_server, &save_uri);

    httpd_uri_t scan_uri = {
        .uri = "/scan",
        .method = HTTP_GET,
        .handler = scan_get_handler,
    };
    httpd_register_uri_handler(s_http_server, &scan_uri);

    // Captive probe fallbacks for Apple, Google, Microsoft probes
    const char *probe_paths[] = {
        "/hotspot-detect.html",      // iOS Safari probe
        "/generate_204",              // Android connectivity probe
        "/gen_204",                   // Android variant
        "/ncsi.txt",                  // Windows NCSI probe
        "/connecttest.txt",           // Windows 10/11 probe
        "/canonical.html",            // Chrome captive probe
    };
    for (int i = 0; i < sizeof(probe_paths) / sizeof(probe_paths[0]); i++) {
      httpd_uri_t probe_uri = {
          .uri = probe_paths[i],
          .method = HTTP_GET,
          .handler = captive_redirect_handler,
      };
      httpd_register_uri_handler(s_http_server, &probe_uri);
    }

    ESP_LOGI(TAG, "🌐 Captive Portal Web Server running at http://192.168.4.1");
  } else {
    ESP_LOGE(TAG, "❌ Failed to start Captive Portal HTTP Server!");
  }

  return ESP_OK;
}

void captive_portal_stop(void) {
  if (!s_is_active)
    return;
  s_is_active = false;
  if (s_http_server) {
    httpd_stop(s_http_server);
    s_http_server = NULL;
  }
  if (s_dns_task_handle) {
    vTaskDelete(s_dns_task_handle);
    s_dns_task_handle = NULL;
  }
  esp_wifi_set_mode(WIFI_MODE_STA);
  ESP_LOGI(TAG, "Captive portal stopped. Switched back to STA mode.");
}

bool captive_portal_is_active(void) {
  return s_is_active;
}
