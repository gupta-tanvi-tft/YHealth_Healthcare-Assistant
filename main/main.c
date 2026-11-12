#include "bsp_board.h"
#include "driver/gpio.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/ringbuf.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "rgb_led_driver.h"
#include "wakeword_engine.h"
#include "wifi_connect.h"
#include "esp_wifi.h"
#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "GEMINI_ASSISTANT";

// ==========================================================
// CONFIGURATION
// ==========================================================
#ifndef CONFIG_ASSISTANT_SERVER_PORT
#define CONFIG_ASSISTANT_SERVER_PORT "8008"
#endif

#define SERVER_IP CONFIG_ASSISTANT_SERVER_IP
#define SERVER_PORT CONFIG_ASSISTANT_SERVER_PORT
#define DOCTOR_ID                                                              \
  CONFIG_ASSISTANT_DOCTOR_ID // ws://SERVER:PORT/ws/live/{DOCTOR_ID}

#define SAMPLE_RATE 16000
#define CHANNELS 2        // ES7210 hardware input channels
#define CHUNK_SAMPLES 512 // 32 ms @ 16 kHz
#define CHUNK_MONO_BYTES (CHUNK_SAMPLES * sizeof(int16_t))

#define VAD_WAKE_THRESHOLD_RMS 100.0f  // start a session
#define VAD_ACTIVE_THRESHOLD_RMS 80.0f // "user is talking"
#define WAKE_CONFIRM_CHUNKS                                                    \
  2 // need 2 loud chunks (~64 ms) so clicks don't wake us
#define MIN_SPEECH_DURATION_MS 200 // ignore blips shorter than this
#define SILENCE_TIMEOUT_MS                                                     \
  650 // trailing silence => utterance finished (saves audio tokens & low
      // latency)
#define IDLE_STANDBY_TIMEOUT_S 30 // inactivity => Standby
#define INACTIVITY_SLEEP_TIMEOUT_S                                             \
  120 // 2 minutes (120 s) => Disconnect & Sleep
#define GEMINI_RESPONSE_TIMEOUT_MS 4000
#define MIC_HOLDOFF_AFTER_PLAYBACK_MS                                          \
  400 // keep mic muted after speaker stops (room echo tail)
#define BARGE_IN_THRESHOLD_RMS                                                 \
  200.0f // deliberate speech while the speaker is active
#define BARGE_IN_CONFIRM_CHUNKS 5 // 160 ms confirms barge-in speech

// Playback
#define PLAYBACK_RB_SIZE 65536 // 2.0 s of 16 kHz mono s16
#define PLAYBACK_PREBUFFER_BYTES                                               \
  6400 // 200 ms cushion before (re)starting playback
#define PLAYBACK_STALL_TIMEOUT_MS 6000 // tolerate tool-call gaps mid-turn
#define PLAYBACK_TAIL_FLUSH_MS                                                 \
  250 // play a short tail even if turn_complete is late

// ==========================================================
// STATE
// ==========================================================
typedef enum {
  CONV_STATE_SLEEP = 0, // LED_COLOR_SLEEP    (0x32F014 Parrot Green)
  CONV_STATE_STANDBY,   // LED_COLOR_STANDBY  (0x32F014 Parrot Green)
  CONV_STATE_LISTENING, // LED_COLOR_LISTENING (0xF573A5 Soft Pink)
  CONV_STATE_THINKING,  // LED_COLOR_THINKING  (0x5AE182 Pastel Green)
  CONV_STATE_SPEAKING   // LED_COLOR_SPEAKING  (0x0FD2E6 Teal Blue)
} conv_state_t;

static volatile conv_state_t s_conv_state = CONV_STATE_STANDBY;
static volatile bool s_ws_sleep = false;
static volatile int64_t s_last_speech_time_ms = 0;
static volatile int64_t s_playback_ended_time_ms = 0;
static volatile int64_t s_last_audio_rx_ms = 0;

typedef struct {
  esp_codec_dev_handle_t play_dev;
  int total_audio_read;
  volatile bool is_playing;
} ws_playback_ctx_t;

static esp_websocket_client_handle_t s_persistent_ws_client = NULL;
static SemaphoreHandle_t s_ws_connect_mutex = NULL;
static volatile bool s_ws_connected = false;
static ws_playback_ctx_t s_playback_ctx;
static RingbufHandle_t s_audio_play_rb = NULL;
static volatile bool s_turn_complete = false;
static volatile bool s_end_conversation_after_playback = false;
static volatile bool s_status_only_after_playback = false;
static volatile size_t s_buffered_bytes = 0;
static volatile bool s_is_prebuffering = true;
static volatile size_t s_dropped_bytes = 0;
static char s_device_id[13] =
    "unknown"; // stable Wi-Fi MAC, used only as a reconnect/session key

// odd-byte carry so the PCM stream always stays 16-bit aligned
static uint8_t s_odd_byte = 0;
static bool s_has_odd_byte = false;

static volatile bool s_boot_anim_done = false;
static volatile uint64_t s_vol_overlay_until_ms = 0;
static volatile int s_vol_overlay_level = 0;

static inline int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

// Atomic accounting of bytes sitting in the ring buffer (two tasks touch it).
static inline void buffered_add(size_t n) {
  __atomic_fetch_add(&s_buffered_bytes, n, __ATOMIC_SEQ_CST);
}
static inline void buffered_sub(size_t n) {
  size_t cur = __atomic_load_n(&s_buffered_bytes, __ATOMIC_SEQ_CST);
  size_t nv;
  do {
    nv = (cur > n) ? (cur - n) : 0;
  } while (!__atomic_compare_exchange_n(&s_buffered_bytes, &cur, nv, false,
                                        __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST));
}
static inline size_t buffered_get(void) {
  return __atomic_load_n(&s_buffered_bytes, __ATOMIC_SEQ_CST);
}

static float compute_pcm_rms(const int16_t *pcm_samples, int num_samples) {
  if (num_samples <= 0)
    return 0.0f;
  double sum_sq = 0.0;
  for (int i = 0; i < num_samples; i++)
    sum_sq += (double)pcm_samples[i] * (double)pcm_samples[i];
  return (float)sqrt(sum_sq / num_samples);
}

static bool payload_contains(const char *p, int len, const char *needle) {
  int nl = (int)strlen(needle);
  if (!p || len < nl)
    return false;
  for (int i = 0; i <= len - nl; i++)
    if (memcmp(p + i, needle, nl) == 0)
      return true;
  return false;
}

static void update_led_state(conv_state_t state) {
  (void)state; // LED animation task reads s_conv_state directly
}

// Drops everything queued for playback (used on manual stop / disconnect only).
static void flush_playback_ringbuffer(void) {
  s_is_prebuffering = true;
  s_turn_complete = false;
  s_end_conversation_after_playback = false;
  s_status_only_after_playback = false;
  s_has_odd_byte = false;
  s_playback_ended_time_ms = now_ms();
  if (s_audio_play_rb) {
    size_t sz = 0;
    uint8_t *it;
    while ((it = (uint8_t *)xRingbufferReceive(s_audio_play_rb, &sz, 0)) !=
           NULL) {
      buffered_sub(sz);
      vRingbufferReturnItem(s_audio_play_rb, (void *)it);
    }
  }
}

// maybe_send_pending_interrupt moved below

static bool pending_interrupt = false;
static volatile bool s_is_interrupting = false;
static char pending_reason[32] = {0};
static void maybe_send_pending_interrupt(void);
// KWS (keyword spotting) disabled – removed unused variables
static int64_t s_last_interrupt_time_ms = 0;
static void request_interruption(const char *reason) {
  int64_t now = now_ms();
  if (s_conv_state == CONV_STATE_STANDBY) {
    ESP_LOGI(TAG, "⏹️ Interrupt ignored – already standby");
    return;
  }
  if (now - s_last_interrupt_time_ms < 500) {
    ESP_LOGI(TAG, "⏹️ Interrupt already in flight, skipping duplicate");
    return;
  }
  s_last_interrupt_time_ms = now;
  ESP_LOGI(TAG, "⏹️ Interrupt requested (%s)", reason);
  // Stop any ongoing playback and reset state
  s_is_interrupting = true;
  flush_playback_ringbuffer();
  s_playback_ctx.is_playing = false;
  s_conv_state = CONV_STATE_LISTENING;
  s_last_speech_time_ms = now;
  update_led_state(CONV_STATE_LISTENING);
  // Queue interrupt for sending
  pending_interrupt = true;
  strncpy(pending_reason, reason, sizeof(pending_reason) - 1);
  // Try to send immediately if WS is ready
  maybe_send_pending_interrupt();
}

// ==========================================================
// 🎨 MASTER LED CONFIGURATION
// ==========================================================
// ALL LED colors, speeds, and brightness are in "led_config.h".
// Open that single file to change ANY color hex code.
// ==========================================================
#include "led_config.h"

// ==========================================================
// LED ANIMATION (3 centre LEDs: 2, 3, 4) — runs on Core 0 @ 20 fps
// ==========================================================
static inline void set_center(uint8_t r, uint8_t g, uint8_t b) {
  rgb_led_set_pixel(2, r, g, b);
  rgb_led_set_pixel(3, r, g, b);
  rgb_led_set_pixel(4, r, g, b);
}

// Apply a hex color with a brightness multiplier (0.0 – 1.0)
static inline void set_center_hex(uint32_t hex_color, float brightness) {
  set_center((uint8_t)(HEX_R(hex_color) * brightness),
             (uint8_t)(HEX_G(hex_color) * brightness),
             (uint8_t)(HEX_B(hex_color) * brightness));
}

// Breathing effect: smoothly oscillates between LED_BRIGHTNESS_MIN and LED_BRIGHTNESS_MAX
static inline float breathing(uint32_t step, float speed) {
  return LED_BRIGHTNESS_MIN +
         (LED_BRIGHTNESS_MAX - LED_BRIGHTNESS_MIN) *
         (1.0f + sinf(step * speed)) / 2.0f;
}

static void enter_sleep_mode(const char *reason);
static void exit_sleep_mode(const char *reason);

static void led_animation_task(void *pvParameters) {
  uint32_t step = 0;
  while (1) {
    if (!s_boot_anim_done) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }
    uint64_t t = now_ms();
    if (t < s_vol_overlay_until_ms) {
      rgb_led_set_vu_meter(s_vol_overlay_level);
    } else if (s_ws_sleep || s_conv_state == CONV_STATE_SLEEP) {
      rgb_led_clear();
      set_center_hex(LED_COLOR_SLEEP, breathing(step, LED_ANIM_SLEEP_SPEED));
      rgb_led_refresh();
    } else if (!s_ws_connected) {
      rgb_led_clear();
      set_center_hex(LED_COLOR_DISCONNECTED, breathing(step, LED_ANIM_DISCONN_SPEED));
      rgb_led_refresh();
    } else {
      rgb_led_clear();
      switch (s_conv_state) {
      case CONV_STATE_SLEEP:
        set_center_hex(LED_COLOR_SLEEP, breathing(step, LED_ANIM_SLEEP_SPEED));
        break;
      case CONV_STATE_STANDBY:
        set_center_hex(LED_COLOR_STANDBY, breathing(step, LED_ANIM_STANDBY_SPEED));
        break;
      case CONV_STATE_LISTENING:
        set_center_hex(LED_COLOR_LISTENING, breathing(step, LED_ANIM_LISTEN_SPEED));
        break;
      case CONV_STATE_THINKING:
        set_center_hex(LED_COLOR_THINKING, breathing(step, LED_ANIM_THINK_SPEED));
        break;
      case CONV_STATE_SPEAKING: {
        // Wave effect: each LED has a phase offset for a ripple look
        float w2 = breathing(step, LED_ANIM_SPEAK_SPEED);
        float w3 = LED_BRIGHTNESS_MIN + (LED_BRIGHTNESS_MAX - LED_BRIGHTNESS_MIN) *
                   (1.0f + sinf(step * LED_ANIM_SPEAK_SPEED + 1.0f)) / 2.0f;
        float w4 = LED_BRIGHTNESS_MIN + (LED_BRIGHTNESS_MAX - LED_BRIGHTNESS_MIN) *
                   (1.0f + sinf(step * LED_ANIM_SPEAK_SPEED + 2.0f)) / 2.0f;
        rgb_led_set_pixel(2, (uint8_t)(HEX_R(LED_COLOR_SPEAKING) * w2),
                             (uint8_t)(HEX_G(LED_COLOR_SPEAKING) * w2),
                             (uint8_t)(HEX_B(LED_COLOR_SPEAKING) * w2));
        rgb_led_set_pixel(3, (uint8_t)(HEX_R(LED_COLOR_SPEAKING) * w3),
                             (uint8_t)(HEX_G(LED_COLOR_SPEAKING) * w3),
                             (uint8_t)(HEX_B(LED_COLOR_SPEAKING) * w3));
        rgb_led_set_pixel(4, (uint8_t)(HEX_R(LED_COLOR_SPEAKING) * w4),
                             (uint8_t)(HEX_G(LED_COLOR_SPEAKING) * w4),
                             (uint8_t)(HEX_B(LED_COLOR_SPEAKING) * w4));
        break;
      }
      }
      rgb_led_refresh();
    }
    step++;
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// ==========================================================
// PLAYBACK TASK (Core 1)
// ==========================================================
static void finish_playback(void) {
  static const uint8_t zero_silence[1024] = {0};
  if (s_playback_ctx.play_dev)
    esp_codec_dev_write(s_playback_ctx.play_dev, (void *)zero_silence,
                        sizeof(zero_silence));
  s_playback_ctx.is_playing = false;
  s_is_prebuffering = true;
  s_turn_complete = false;
  s_playback_ended_time_ms = now_ms();
  bool status_only = s_status_only_after_playback;
  s_status_only_after_playback = false;
  bool end_conversation = s_end_conversation_after_playback;
  s_end_conversation_after_playback = false;
  if (end_conversation) {
    enter_sleep_mode("doctor goodbye sign-off");
    ESP_LOGI(TAG, "🗣️ Doctor goodbye finished. Disconnected WebSocket and "
                  "entered SLEEP mode.");
    return;
  }
  if (s_conv_state == CONV_STATE_SPEAKING) {
    s_conv_state = status_only ? CONV_STATE_THINKING : CONV_STATE_LISTENING;
    s_last_speech_time_ms = now_ms();
    update_led_state(s_conv_state);
    if (status_only)
      ESP_LOGI(TAG,
               "ℹ️ Status update finished. Still waiting for the result.");
    else
      ESP_LOGI(
          TAG,
          "🗣️ Assistant finished speaking. Ready for the next question.");
  }
}

static void audio_playback_task(void *pvParameters) {
  int stall_ms = 0;

  while (1) {
    // ---- (Re)buffering: absorb Wi-Fi jitter before/after an underrun ----
    if (s_is_prebuffering) {
      size_t buffered = buffered_get();
      bool have = buffered > 0;
      bool stale =
          have && ((now_ms() - s_last_audio_rx_ms) > PLAYBACK_TAIL_FLUSH_MS);
      if (buffered >= PLAYBACK_PREBUFFER_BYTES ||
          (have && (s_turn_complete || stale))) {
        s_is_prebuffering = false;
      } else {
        if (s_playback_ctx.is_playing) { // waiting for more audio mid-turn
          stall_ms += 10;
          if (s_turn_complete || stall_ms >= PLAYBACK_STALL_TIMEOUT_MS) {
            finish_playback();
            stall_ms = 0;
          }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
        continue;
      }
    }

    size_t item_size = 0;
    uint8_t *item = (uint8_t *)xRingbufferReceive(s_audio_play_rb, &item_size,
                                                  pdMS_TO_TICKS(100));

    if (item != NULL) {
      size_t raw_size = item_size;
      item_size &= ~(size_t)1;
      if (item_size > 0) {
        stall_ms = 0;
        s_playback_ctx.is_playing = true;
        if (s_conv_state == CONV_STATE_LISTENING ||
            s_conv_state == CONV_STATE_THINKING) {
          s_conv_state = CONV_STATE_SPEAKING;
          update_led_state(CONV_STATE_SPEAKING);
        }
        if (s_playback_ctx.play_dev)
          esp_codec_dev_write(s_playback_ctx.play_dev, (void *)item, item_size);
        s_playback_ctx.total_audio_read += item_size;
      }
      buffered_sub(raw_size);
      vRingbufferReturnItem(s_audio_play_rb, (void *)item);
    } else if (s_playback_ctx.is_playing) {
      // Ring is empty right now.
      if (s_turn_complete) {
        finish_playback(); // real end of the reply
        stall_ms = 0;
      } else {
        s_is_prebuffering =
            true; // underrun / tool-call gap: rebuffer instead of stuttering
      }
    }
  }
}

// ==========================================================
// WEBSOCKET
// ==========================================================
static void rb_push(const uint8_t *p, size_t n) {
  if (xRingbufferSend(s_audio_play_rb, p, n, pdMS_TO_TICKS(200)) == pdTRUE) {
    buffered_add(n);
  } else {
    s_dropped_bytes += n;
    ESP_LOGW(TAG, "Playback ring full — dropped %u bytes (total %u)",
             (unsigned)n, (unsigned)s_dropped_bytes);
  }
}

static void enqueue_audio(const uint8_t *p, size_t n) {
  if (n == 0)
    return;
  if (s_has_odd_byte) {
    uint8_t pair[2] = {s_odd_byte, p[0]};
    rb_push(pair, 2);
    p++;
    n--;
    s_has_odd_byte = false;
  }
  if (n & 1) {
    s_odd_byte = p[n - 1];
    s_has_odd_byte = true;
    n--;
  }
  if (n)
    rb_push(p, n);
}

static void websocket_event_handler(void *handler_args, esp_event_base_t base,
                                    int32_t event_id, void *event_data) {
  esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;

  switch (event_id) {
  case WEBSOCKET_EVENT_CONNECTED:
    s_ws_connected = true;
    s_has_odd_byte = false;
    ESP_LOGI(TAG, "⚡ Persistent WebSocket connected to relay server");
    if (!s_boot_anim_done) // never fight the LED task once it is running
      rgb_led_set_all_hex(LED_COLOR_RELAY_CONNECTED);
    // Attempt to send any pending interrupt now that the socket is up
    maybe_send_pending_interrupt();
    break;

  case WEBSOCKET_EVENT_DISCONNECTED:
    if (s_ws_connected)
      ESP_LOGW(TAG, "⚡ WebSocket disconnected");
    s_ws_connected = false;
    if (s_conv_state != CONV_STATE_STANDBY) {
      // Server-side conversation context is gone; start clean on next voice
      // activity.
      s_conv_state = CONV_STATE_STANDBY;
      flush_playback_ringbuffer();
    }
    break;

  case WEBSOCKET_EVENT_DATA:
    if (data->op_code == 0x01) { // text/JSON
      ESP_LOGI(TAG, "📩 WS: %.*s", data->data_len, data->data_ptr);
      if (payload_contains(data->data_ptr, data->data_len,
                           "status_audio_end")) {
        s_status_only_after_playback = true;
        s_turn_complete = true;
        if (buffered_get() == 0 && !s_playback_ctx.is_playing)
          s_status_only_after_playback = false;
      }
      if (payload_contains(data->data_ptr, data->data_len, "conversation_end"))
        s_end_conversation_after_playback = true;
      if (payload_contains(data->data_ptr, data->data_len, "turn_complete")) {
        s_turn_complete = true;
        if (s_conv_state == CONV_STATE_THINKING) {
          // No audio means playback cannot transition the state later.
          bool end_conversation = s_end_conversation_after_playback &&
                                  buffered_get() == 0 &&
                                  !s_playback_ctx.is_playing;
          if (end_conversation) {
            s_end_conversation_after_playback = false;
            enter_sleep_mode("doctor goodbye (no audio)");
            ESP_LOGI(TAG, "⚡ Sign-off complete. Disconnected WebSocket and "
                          "entered SLEEP mode.");
          } else {
            s_conv_state = CONV_STATE_LISTENING;
            s_last_speech_time_ms = now_ms();
            update_led_state(s_conv_state);
            ESP_LOGI(TAG, "⚡ Turn complete (no audio). Listening again.");
          }
        }
      }
    } else if ((data->op_code == 0x02 || data->op_code == 0x00) &&
               data->data_len > 0 && s_audio_play_rb) {
      if (s_conv_state == CONV_STATE_STANDBY)
        break; // user stopped the session; discard the rest of the reply
      // A turn_complete left over from a turn that never played audio is stale.
      if (s_turn_complete && !s_playback_ctx.is_playing && buffered_get() == 0)
        s_turn_complete = false;
      s_last_audio_rx_ms = now_ms();
      // NOTE: do NOT update s_last_speech_time_ms here. Incoming audio must
      // not reset the THINKING-state timeout — if the ring overflows and audio
      // keeps arriving, the device would stay stuck in THINKING forever.
      // s_last_speech_time_ms is owned by the mic / utterance path only.
      enqueue_audio((const uint8_t *)data->data_ptr, (size_t)data->data_len);
    }
    break;
  }
}

static esp_err_t ensure_websocket_connected(ws_playback_ctx_t *ctx) {
  if (s_ws_connected && s_persistent_ws_client &&
      esp_websocket_client_is_connected(s_persistent_ws_client))
    return ESP_OK;

  if (!s_ws_connect_mutex ||
      xSemaphoreTake(s_ws_connect_mutex, pdMS_TO_TICKS(10000)) != pdTRUE) {
    ESP_LOGW(TAG, "Timed out waiting for WebSocket reconnect lock.");
    return ESP_ERR_TIMEOUT;
  }

  // Another task may have restored the connection while this task waited.
  if (s_ws_connected && s_persistent_ws_client &&
      esp_websocket_client_is_connected(s_persistent_ws_client)) {
    xSemaphoreGive(s_ws_connect_mutex);
    return ESP_OK;
  }

  if (s_persistent_ws_client != NULL) {
    if (s_ws_connected &&
        esp_websocket_client_is_connected(s_persistent_ws_client)) {
      xSemaphoreGive(s_ws_connect_mutex);
      return ESP_OK;
    }

    ESP_LOGI(TAG, "Cleaning up inactive WebSocket client for immediate reconnect...");
    esp_websocket_client_stop(s_persistent_ws_client);
    esp_websocket_client_destroy(s_persistent_ws_client);
    s_persistent_ws_client = NULL;
    s_ws_connected = false;
  }

  wifi_ap_record_t ap_info = {0};
  int rssi = -50;
  char ssid[33] = "TFTus-WiFi";
  if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
    rssi = ap_info.rssi;
    strncpy(ssid, (char *)ap_info.ssid, sizeof(ssid) - 1);
  }

  char ws_url[256];
  if (strcmp(SERVER_PORT, "443") == 0) {
    snprintf(ws_url, sizeof(ws_url), "wss://%s/ws/live/%s?device_id=%s&rssi=%d&ssid=%s",
             SERVER_IP, DOCTOR_ID, s_device_id, rssi, ssid);
  } else if (strlen(SERVER_PORT) == 0 || strcmp(SERVER_PORT, "80") == 0) {
    snprintf(ws_url, sizeof(ws_url), "ws://%s/ws/live/%s?device_id=%s&rssi=%d&ssid=%s",
             SERVER_IP, DOCTOR_ID, s_device_id, rssi, ssid);
  } else {
    snprintf(ws_url, sizeof(ws_url), "ws://%s:%s/ws/live/%s?device_id=%s&rssi=%d&ssid=%s",
             SERVER_IP, SERVER_PORT, DOCTOR_ID, s_device_id, rssi, ssid);
  }

  ESP_LOGI(TAG, "Connecting WebSocket: %s", ws_url);

  esp_websocket_client_config_t ws_cfg = {
      .uri = ws_url,
      .buffer_size = 32768,
      .reconnect_timeout_ms = 1500,
      .network_timeout_ms = 8000,
      .ping_interval_sec = 10,
      .pingpong_timeout_sec = 25,
      .crt_bundle_attach = esp_crt_bundle_attach,
      .skip_cert_common_name_check = true,
      .headers = "ngrok-skip-browser-warning: 1\r\nUser-Agent: ESP32\r\n",
  };

  s_persistent_ws_client = esp_websocket_client_init(&ws_cfg);
  if (!s_persistent_ws_client) {
    ESP_LOGE(TAG, "Failed to allocate websocket client!");
    xSemaphoreGive(s_ws_connect_mutex);
    return ESP_FAIL;
  }
  esp_websocket_register_events(s_persistent_ws_client, WEBSOCKET_EVENT_ANY,
                                websocket_event_handler, (void *)ctx);

  esp_err_t err = esp_websocket_client_start(s_persistent_ws_client);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to start WebSocket: %s", esp_err_to_name(err));
    esp_websocket_client_destroy(s_persistent_ws_client);
    s_persistent_ws_client = NULL;
    s_ws_connected = false;
    xSemaphoreGive(s_ws_connect_mutex);
    return err;
  }
  for (int i = 0; !s_ws_connected && i < 100; i++)
    vTaskDelay(pdMS_TO_TICKS(15));
  esp_err_t result = (s_ws_connected && s_persistent_ws_client &&
                      esp_websocket_client_is_connected(s_persistent_ws_client))
                         ? ESP_OK
                         : ESP_ERR_TIMEOUT;
  xSemaphoreGive(s_ws_connect_mutex);
  return result;
}

static inline bool ws_ready(void) {
  return s_ws_connected && s_persistent_ws_client &&
         esp_websocket_client_is_connected(s_persistent_ws_client);
}

static void maybe_send_pending_interrupt(void) {
  if (!pending_interrupt)
    return;
  const char *interrupt = "{\"event\":\"interrupt\"}";
  int len = strlen(interrupt);
  // Try a few times, aborting if the WebSocket is not ready.
  for (int attempt = 0; attempt < 5; ++attempt) {
    if (!ws_ready()) {
      ESP_LOGW(TAG, "⏹️ WebSocket not ready – will retry on next reconnect");
      return; // keep pending_interrupt true so it will be retried later
    }
    int res = esp_websocket_client_send_text(s_persistent_ws_client, interrupt,
                                             len, pdMS_TO_TICKS(250));
    if (res >= 0) {
      ESP_LOGI(TAG, "📤 Pending interrupt sent successfully (%s)",
               pending_reason);
      pending_interrupt = false;
      return;
    }
    ESP_LOGW(TAG,
             "⏹️ Pending interrupt send failed (attempt %d err=%d), retrying",
             attempt + 1, res);
    vTaskDelay(pdMS_TO_TICKS(100)); // short back‑off before next attempt
  }
  ESP_LOGW(TAG, "⏹️ Giving up after retries – will retry on next reconnect");
}

static void enter_sleep_mode(const char *reason) {
  ESP_LOGI(TAG,
           "🛑 Entering SLEEP mode (%s): disconnecting WebSocket, RED light.",
           reason);
  s_ws_sleep = true;
  s_conv_state = CONV_STATE_SLEEP;
  wakeword_reset();
  if (s_persistent_ws_client) {
    esp_websocket_client_stop(s_persistent_ws_client);
    esp_websocket_client_destroy(s_persistent_ws_client);
    s_persistent_ws_client = NULL;
  }
  s_ws_connected = false;
  flush_playback_ringbuffer();
}

static void exit_sleep_mode(const char *reason) {
  ESP_LOGI(TAG,
           "🟢 Exiting SLEEP mode (%s): reconnecting WebSocket, switching to "
           "LISTENING.",
           reason);
  s_ws_sleep = false;
  s_last_speech_time_ms = now_ms();
  s_conv_state = CONV_STATE_LISTENING;
  update_led_state(CONV_STATE_LISTENING);
  ensure_websocket_connected(&s_playback_ctx);
}

// Keep network recovery off the real-time microphone task. A reconnect can
// take seconds; doing it inline would stop mic capture and lose the rest of
// the doctor's utterance while the socket is being rebuilt.
static void websocket_maintenance_task(void *pvParameters) {
  int64_t last_warning_ms = 0;
  while (1) {
    if (s_ws_sleep) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    if (ws_ready()) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    esp_err_t err = ensure_websocket_connected(&s_playback_ctx);
    if (err != ESP_OK && now_ms() - last_warning_ms >= 10000) {
      ESP_LOGW(TAG,
               "WebSocket reconnect is still pending (%s). Microphone task "
               "remains responsive.",
               esp_err_to_name(err));
      last_warning_ms = now_ms();
    }
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

// ==========================================================
// REAL-TIME HEARTBEAT & SERVER PING TASK (Core 0)
// ==========================================================
// Best Practice: 15-second heartbeat cadence for hospital & clinic smart speakers.
// Continuously verifies Wi-Fi connectivity, reports RSSI, free heap, and
// ensures the speaker remains visible to the fleet server over LAN / Internet.
#define HEARTBEAT_CADENCE_MS 15000

static void heartbeat_task(void *pvParameters) {
  ESP_LOGI(TAG, "💓 [HEARTBEAT] Task initialized. Cadence: 15s (Best Practice).");
  while (1) {
    vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_CADENCE_MS));

    wifi_ap_record_t ap_info = {0};
    esp_err_t wifi_err = esp_wifi_sta_get_ap_info(&ap_info);

    if (wifi_err == ESP_OK) {
      uint32_t free_heap = (uint32_t)esp_get_free_heap_size();
      bool ws_ok = ws_ready();

      ESP_LOGI(TAG, "💓 [HEARTBEAT] Wi-Fi Link: ACTIVE | SSID: '%s' | RSSI: %d dBm | Free Heap: %lu B | Server Visibility: %s",
               (char *)ap_info.ssid, ap_info.rssi, (unsigned long)free_heap,
               ws_ok ? "ONLINE (Active Audio Link)" : "STANDBY (Reachable over LAN/WAN)");

      // If persistent WebSocket is ready, dispatch periodic heartbeat telemetry frame
      if (ws_ok && s_persistent_ws_client) {
        char hb_payload[128];
        snprintf(hb_payload, sizeof(hb_payload),
                 "{\"event\":\"heartbeat\",\"device_id\":\"%s\",\"rssi\":%d,\"heap\":%lu}",
                 s_device_id, ap_info.rssi, (unsigned long)free_heap);
        esp_websocket_client_send_text(s_persistent_ws_client, hb_payload, strlen(hb_payload), pdMS_TO_TICKS(100));
      }
    } else {
      ESP_LOGW(TAG, "⚠️ [HEARTBEAT] Wi-Fi Link: DISCONNECTED | Retrying AP connection...");
    }
  }
}

// ==========================================================
// MIC STREAMING TASK (Core 1)
// ==========================================================
static void continuous_mic_stream_task(void *pvParameters) {
  int chunk_samples = CHUNK_SAMPLES;
  int chunk_raw_bytes = chunk_samples * CHANNELS * sizeof(int32_t);
  int32_t *raw_chunk = (int32_t *)malloc(chunk_raw_bytes);
  if (!raw_chunk) {
    ESP_LOGE(TAG, "Failed to allocate raw chunk buffer!");
    vTaskDelete(NULL);
    return;
  }

  for (int f = 0; f < 5; f++) // flush stale ADC data
    esp_get_feed_data(true, (int16_t *)raw_chunk, chunk_raw_bytes);

  int16_t chunk_mono[CHUNK_SAMPLES];
  int16_t preroll[CHUNK_SAMPLES * 2] = {
      0};             // last 2 chunks (64 ms) so the first consonant isn't lost
  int pre_chunks = 0; // how many of those are valid (0..2)
  int wake_hits = 0;

  int speech_accum_ms = 0;
  int silence_accum_ms = 0;
  const int chunk_duration_ms = (CHUNK_SAMPLES * 1000) / SAMPLE_RATE; // 32 ms

  s_last_speech_time_ms = now_ms();
  ESP_LOGI(TAG, "🎙️ Mic streaming engine started.");

  while (1) {
    if (esp_get_feed_data(true, (int16_t *)raw_chunk, chunk_raw_bytes) !=
        ESP_OK) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    // ES7210 2ch/32-bit -> mono 16-bit (smooth stereo mix)
    for (int i = 0; i < chunk_samples; i++) {
      int32_t ch0 = (int32_t)(raw_chunk[CHANNELS * i + 0] >> 16);
      int32_t ch1 = (int32_t)(raw_chunk[CHANNELS * i + 1] >> 16);
      chunk_mono[i] = (int16_t)((ch0 + ch1) / 2);
    }

    float rms = compute_pcm_rms(chunk_mono, chunk_samples);
    // ----------------------------------------------------------
    // Keyword spotting – trigger interrupt on "assistant"
    // ----------------------------------------------------------
    // Keyword spotting disabled – RMS based detection only

    int64_t t = now_ms();

    // 0. While speaking, completely ignore microphone audio (voice barge-in disabled).
    // The hardware lacks an AEC reference loop; without AEC, speaker output bleeds
    // directly into the adjacent ES7210 microphones, causing false barge-in triggers
    // and random audio pauses mid-sentence.
    // To interrupt playback, the user can press the physical BOOT button (GPIO 0).
    if (s_conv_state == CONV_STATE_SPEAKING) {
      speech_accum_ms = silence_accum_ms = 0;
      pre_chunks = wake_hits = 0;
      continue;
    }
    // Briefly mute the echo tail after the speaker stops.
    if ((t - s_playback_ended_time_ms) < MIC_HOLDOFF_AFTER_PLAYBACK_MS) {
      speech_accum_ms = silence_accum_ms = 0;
      pre_chunks = wake_hits = 0;
      continue;
    }

    // 1. SLEEP MODE: WebSocket is disconnected.
    // Listen for local wakeword ("Hello Assistant" or "LIRA") or intentional direct voice.
    if (s_conv_state == CONV_STATE_SLEEP || s_ws_sleep) {
      wakeword_result_t ww_res;
      bool ww_hit = wakeword_feed_samples(chunk_mono, chunk_samples, &ww_res);
      bool voice_wake = (rms >= 75.0f && ++wake_hits >= 2);
      if (ww_hit || voice_wake) {
        const char *trigger_name = ww_hit ? ww_res.keyword : "VOICE ACTIVATION";
        ESP_LOGI(TAG, "🎯 Wake trigger in SLEEP: '%s'! Waking up instantly...",
                 trigger_name);
        exit_sleep_mode(trigger_name);
        speech_accum_ms = chunk_duration_ms * WAKE_CONFIRM_CHUNKS;
        silence_accum_ms = 0;
        pre_chunks = wake_hits = 0;
        if (ws_ready()) {
          const char *wake_evt = "{\"event\":\"user_utterance\",\"text\":\"Hello assistant\"}";
          esp_websocket_client_send_text(s_persistent_ws_client, wake_evt,
                                         strlen(wake_evt), pdMS_TO_TICKS(500));
        }
      } else {
        if (rms < 50.0f) wake_hits = 0;
      }
      continue;
    }

    // 2. STANDBY: wait for confirmed voice activity or wakeword
    if (s_conv_state == CONV_STATE_STANDBY) {
      // 2-minute inactivity timeout: if no conversation for 2 minutes,
      // disconnect and sleep
      if ((t - s_last_speech_time_ms) > (INACTIVITY_SLEEP_TIMEOUT_S * 1000)) {
        ESP_LOGI(TAG,
                 "⏳ No conversation for %d seconds. Disconnecting WebSocket "
                 "and entering SLEEP (RED light)...",
                 INACTIVITY_SLEEP_TIMEOUT_S);
        enter_sleep_mode("2 minutes inactivity");
        continue;
      }

      wakeword_result_t ww_res;
      bool ww_hit = wakeword_feed_samples(chunk_mono, chunk_samples, &ww_res);
      if (ww_hit || (rms >= VAD_WAKE_THRESHOLD_RMS &&
                     ++wake_hits >= WAKE_CONFIRM_CHUNKS)) {
        ESP_LOGI(TAG, "🗣️ Session activated (%s, RMS %.1f)",
                 ww_hit ? ww_res.keyword : "Voice Activity", rms);
        if (!ws_ready()) {
          // Reconnect runs in websocket_maintenance_task; never block the
          // real-time mic task while it repairs the connection.
          ESP_LOGW(TAG, "WebSocket is not connected; this utterance was not "
                        "sent. Waiting for reconnect.");
          wake_hits = 0;
          pre_chunks = 0;
          speech_accum_ms = silence_accum_ms = 0;
          continue;
        }

        s_conv_state = CONV_STATE_LISTENING;
        s_last_speech_time_ms = t;
        update_led_state(CONV_STATE_LISTENING);
        if (pre_chunks > 0) {
          int off = (2 - pre_chunks) * chunk_samples;
          esp_websocket_client_send_bin(
              s_persistent_ws_client, (const char *)(preroll + off),
              pre_chunks * CHUNK_MONO_BYTES, pdMS_TO_TICKS(1000));
        }
        esp_websocket_client_send_bin(s_persistent_ws_client,
                                      (const char *)chunk_mono,
                                      CHUNK_MONO_BYTES, pdMS_TO_TICKS(1000));
        speech_accum_ms = chunk_duration_ms * WAKE_CONFIRM_CHUNKS;
        silence_accum_ms = 0;
        pre_chunks = wake_hits = 0;
      } else {
        if (rms < VAD_WAKE_THRESHOLD_RMS)
          wake_hits = 0;
        // slide pre-roll window
        memcpy(preroll, preroll + chunk_samples,
               chunk_samples * sizeof(int16_t));
        memcpy(preroll + chunk_samples, chunk_mono,
               chunk_samples * sizeof(int16_t));
        if (pre_chunks < 2)
          pre_chunks++;
      }
      continue;
    }

    // 3. LISTENING: stream to Gemini until the user stops talking
    if (s_conv_state == CONV_STATE_LISTENING) {
      if (rms >= VAD_ACTIVE_THRESHOLD_RMS) {
        s_last_speech_time_ms = t;
        speech_accum_ms += chunk_duration_ms;
        silence_accum_ms = 0;
        if (ws_ready() && esp_websocket_client_send_bin(
                              s_persistent_ws_client, (const char *)chunk_mono,
                              CHUNK_MONO_BYTES, pdMS_TO_TICKS(1000)) < 0)
          ESP_LOGW(TAG, "Failed to stream PCM frame!");
      } else if (speech_accum_ms > 0) {
        // Was talking, now quiet — keep streaming the silence so Gemini's VAD
        // sees the pause.
        silence_accum_ms += chunk_duration_ms;
        if (ws_ready())
          esp_websocket_client_send_bin(s_persistent_ws_client,
                                        (const char *)chunk_mono,
                                        CHUNK_MONO_BYTES, pdMS_TO_TICKS(1000));

        if (silence_accum_ms >= SILENCE_TIMEOUT_MS) {
          if (speech_accum_ms >= MIN_SPEECH_DURATION_MS) {
            ESP_LOGI(TAG,
                     "⏹️ Utterance complete (speech %d ms, silence %d ms). "
                     "Waiting for Gemini...",
                     speech_accum_ms, silence_accum_ms);
            const char *eot = "{\"event\":\"audio_end\"}";
            if (ws_ready())
              esp_websocket_client_send_text(s_persistent_ws_client, eot,
                                             strlen(eot), pdMS_TO_TICKS(500));
            s_conv_state = CONV_STATE_THINKING;
            s_last_speech_time_ms = t;
            update_led_state(CONV_STATE_THINKING);
            // NOTE: no ring-buffer flush here. Gemini may already be replying
            // and a flush would delete the first words of the answer.
          } else {
            ESP_LOGI(TAG, "…ignored a short noise blip (%d ms)",
                     speech_accum_ms);
          }
          speech_accum_ms = silence_accum_ms = 0;
        }
      } else if ((t - s_last_speech_time_ms) >
                 (IDLE_STANDBY_TIMEOUT_S * 1000)) {
        ESP_LOGI(TAG, "⏳ Idle %d s. Back to Standby.", IDLE_STANDBY_TIMEOUT_S);
        s_conv_state = CONV_STATE_STANDBY;
        update_led_state(CONV_STATE_STANDBY);
      }
      continue;
    }

    // 4. THINKING: wait for audio / turn_complete, but keep listening if doctor
    // speaks!
    if (s_conv_state == CONV_STATE_THINKING) {
      if (rms >= VAD_ACTIVE_THRESHOLD_RMS) {
        ESP_LOGI(TAG,
                 "🗣️ Doctor speaking (RMS %.1f) during thinking. Resuming "
                 "active listening.",
                 rms);
        s_conv_state = CONV_STATE_LISTENING;
        s_last_speech_time_ms = t;
        speech_accum_ms = chunk_duration_ms;
        silence_accum_ms = 0;
        update_led_state(CONV_STATE_LISTENING);
        if (ws_ready() && esp_websocket_client_send_bin(
                              s_persistent_ws_client, (const char *)chunk_mono,
                              CHUNK_MONO_BYTES, pdMS_TO_TICKS(1000)) < 0)
          ESP_LOGW(TAG, "Failed to stream PCM frame!");
        continue;
      }
      speech_accum_ms = silence_accum_ms = 0;
      if ((t - s_last_speech_time_ms) > GEMINI_RESPONSE_TIMEOUT_MS) {
        ESP_LOGW(TAG,
                 "⚠️ Thinking timeout after %d ms. Resuming active listening.",
                 GEMINI_RESPONSE_TIMEOUT_MS);
        s_conv_state = CONV_STATE_LISTENING;
        s_last_speech_time_ms = t;
        update_led_state(CONV_STATE_LISTENING);
      }
      continue;
    }
  }
  free(raw_chunk);
}

// ==========================================================
// BUTTONS
// ==========================================================
#define GPIO_BTN_BOOT GPIO_NUM_0

static void toggle_conversation(const char *who) {
  if (s_conv_state == CONV_STATE_SLEEP || s_ws_sleep) {
    ESP_LOGI(TAG, "🔘 %s -> Waking up from SLEEP mode", who);
    exit_sleep_mode(who);
    return;
  }
  if (s_conv_state == CONV_STATE_STANDBY) {
    ESP_LOGI(TAG, "🔘 %s -> Conversation ACTIVATED", who);
    if (!ws_ready()) {
      ESP_LOGW(TAG, "Cannot activate conversation: WebSocket is disconnected; "
                    "reconnect is in progress.");
      s_conv_state = CONV_STATE_STANDBY;
      return;
    }
    s_last_speech_time_ms = now_ms();
    s_conv_state = CONV_STATE_LISTENING;
    update_led_state(CONV_STATE_LISTENING);
  } else {
    ESP_LOGI(TAG, "🔘 %s -> Entering SLEEP mode (Standby)", who);
    request_interruption("manual stop");
    enter_sleep_mode("manual button stop");
  }
}

static void show_volume(int vol) {
  int leds = (vol * 7 + 50) / 100;
  if (leds < 1 && vol > 0)
    leds = 1;
  s_vol_overlay_level = leds;
  s_vol_overlay_until_ms = now_ms() + 800;
}

static void gpio_button_task(void *pvParameters) {
  gpio_config_t io_conf = {
      .pin_bit_mask = (1ULL << GPIO_NUM_0), // do NOT touch GPIO 38 (WS2812)
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  gpio_config(&io_conf);

  bool prev_boot_state = 1;
  uint16_t prev_tca_val = 0xFFFF;

  while (1) {
    bool boot_pressed = (gpio_get_level(GPIO_BTN_BOOT) == 0);
    if (boot_pressed && prev_boot_state == 1) {
      toggle_conversation("BOOT button");
      vTaskDelay(pdMS_TO_TICKS(400));
    }
    prev_boot_state = !boot_pressed;

    uint16_t tca_val = bsp_board_read_tca9555_inputs();
    if (tca_val != prev_tca_val && tca_val != 0xFFFF) {
      uint8_t port1 = (uint8_t)(tca_val >> 8);
      uint8_t prev_port1 = (uint8_t)(prev_tca_val >> 8);

      if ((port1 & 0x02) == 0 &&
          (prev_port1 & 0x02) != 0) { // Button 1: Vol +15
        int v = bsp_board_get_volume() + 15;
        if (v > 100)
          v = 100;
        bsp_board_set_volume(v);
        ESP_LOGI(TAG, "🔊 Volume UP: %d%%", v);
        show_volume(v);
      }
      if ((port1 & 0x04) == 0 &&
          (prev_port1 & 0x04) != 0) { // Button 2: Vol -15
        int v = bsp_board_get_volume() - 15;
        if (v < 0)
          v = 0;
        bsp_board_set_volume(v);
        ESP_LOGI(TAG, "🔉 Volume DOWN: %d%%", v);
        show_volume(v);
      }
      if ((port1 & 0x08) == 0 && (prev_port1 & 0x08) != 0) // Button 3: toggle
        toggle_conversation("Waveshare button 3");

      prev_tca_val = tca_val;
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// Background task listening for USB Serial commands from Fleet Dashboard
static void usb_serial_listener_task(void *pvParameters) {
  char line[128];
  while (1) {
    if (fgets(line, sizeof(line), stdin) != NULL) {
      char ssid[33] = {0};
      char pass[65] = {0};
      if (sscanf(line, "SET_WIFI:%32[^:]:%64[^\r\n]", ssid, pass) >= 1) {
        ESP_LOGI(TAG, "⚡ Received Wi-Fi credentials via USB: SSID='%s'", ssid);
        nvs_handle_t nvs_h;
        if (nvs_open("storage", NVS_READWRITE, &nvs_h) == ESP_OK) {
          nvs_set_str(nvs_h, "wifi_ssid", ssid);
          nvs_set_str(nvs_h, "wifi_pass", pass);
          nvs_commit(nvs_h);
          nvs_close(nvs_h);
          printf("OK:WIFI_SAVED\n");
          fflush(stdout);
          vTaskDelay(pdMS_TO_TICKS(600));
          esp_restart();
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

// ==========================================================
// MAIN
// ==========================================================
void app_main(void) {
  ESP_LOGI(TAG, "================================================");
  ESP_LOGI(TAG, " ESP32-S3 Continuous Full-Duplex Voice Assistant");
  ESP_LOGI(TAG, "================================================");
  ESP_LOGI(TAG,
           "   • Say 'Hello Assistant' — it greets you and asks which patient");
  ESP_LOGI(TAG, "   • BOOT / Button 3: manual start-stop, Buttons 1&2: volume");

  ESP_ERROR_CHECK(esp_board_init(SAMPLE_RATE, 1, 16));
  wakeword_init();

  esp_err_t nvs_ret = nvs_flash_init();
  if (nvs_ret == ESP_ERR_NVS_NO_FREE_PAGES ||
      nvs_ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    nvs_ret = nvs_flash_init();
  }
  ESP_ERROR_CHECK(nvs_ret);

  rgb_led_init();
  rgb_led_set_all_hex(LED_COLOR_BOOTING);
  vTaskDelay(pdMS_TO_TICKS(300));

  s_playback_ctx.play_dev = esp_ret_play_dev();
  s_playback_ctx.total_audio_read = 0;
  s_playback_ctx.is_playing = false;

  uint8_t mac[6] = {0};
  if (esp_read_mac(mac, ESP_MAC_WIFI_STA) == ESP_OK) {
    snprintf(s_device_id, sizeof(s_device_id), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  }
  ESP_LOGI(TAG, "Device reconnect identity: %s", s_device_id);

  s_ws_connect_mutex = xSemaphoreCreateMutex();
  if (!s_ws_connect_mutex) {
    ESP_LOGE(TAG, "Failed to create WebSocket reconnect mutex!");
    rgb_led_set_all_hex(LED_COLOR_ERROR);
    return;
  }

  s_audio_play_rb = xRingbufferCreate(PLAYBACK_RB_SIZE, RINGBUF_TYPE_BYTEBUF);
  if (!s_audio_play_rb) {
    ESP_LOGE(TAG, "Failed to create playback ring buffer!");
    rgb_led_set_all_hex(LED_COLOR_ERROR);
    return;
  }
  xTaskCreatePinnedToCore(audio_playback_task, "audio_play_task", 6144, NULL,
                          10, NULL, 1);
  xTaskCreatePinnedToCore(gpio_button_task, "gpio_button_task", 6144, NULL, 4,
                          NULL, 0);
  xTaskCreatePinnedToCore(usb_serial_listener_task, "usb_serial_task", 3072,
                          NULL, 2, NULL, 0);

  ESP_LOGI(TAG, "Connecting to Wi-Fi...");
  if (wifi_init_sta() != ESP_OK) {
    ESP_LOGE(TAG, "Wi-Fi connection failed! Check SSID & password.");
    rgb_led_set_all_hex(LED_COLOR_ERROR);
    return;
  }
  rgb_led_set_all_hex(LED_COLOR_WIFI_OK);
  vTaskDelay(pdMS_TO_TICKS(400));

  ESP_LOGI(TAG, "Opening persistent WebSocket at boot...");
  ensure_websocket_connected(&s_playback_ctx);
  if (ws_ready())
    rgb_led_set_all_hex(LED_COLOR_RELAY_CONNECTED);
  else
    rgb_led_set_all_hex(LED_COLOR_RELAY_UNAVAILABLE);
  vTaskDelay(pdMS_TO_TICKS(400));

  xTaskCreatePinnedToCore(led_animation_task, "led_anim_task", 4096, NULL, 3,
                          NULL, 0);
  s_boot_anim_done = true;
  update_led_state(s_conv_state);

  xTaskCreatePinnedToCore(websocket_maintenance_task, "ws_maintenance_task",
                          4096, NULL, 4, NULL, 0);

  xTaskCreatePinnedToCore(heartbeat_task, "heartbeat_task", 4096, NULL, 3,
                          NULL, 0);

  xTaskCreatePinnedToCore(continuous_mic_stream_task, "mic_stream_task", 6144,
                          NULL, 9, NULL, 1);

  ESP_LOGI(TAG, "✅ Free heap after all tasks: %lu bytes",
           (unsigned long)esp_get_free_heap_size());
  ESP_LOGI(TAG, "System ready.");
}
