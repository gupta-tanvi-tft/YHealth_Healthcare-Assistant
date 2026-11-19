#pragma once

#include <stdint.h>
#include "rgb_led_driver.h"

// ==============================================================================
// 🎨 SINGLE SOURCE OF TRUTH — ALL SPEAKER LED COLORS
// ==============================================================================
// To change ANY LED color on the speaker:
// 1. Pick your color code in standard HEX format (e.g. from Google Color Picker: #FF00FF).
// 2. Replace '#' with '0x' (e.g. 0xFF00FF).
// 3. Paste it directly below.
// 4. Flash firmware: idf.py flash
//
// That's it! NO other file has to be modified. Zero extra dependencies.
// ==============================================================================

// --- [1] INTERACTIVE CONVERSATION STATES ---
// State              Default Color     Hex Code     Description
// ─────────────────────────────────────────────────────────────────────────────
#define LED_COLOR_SLEEP             0x32F014   // Parrot Green  — WS disconnected, low-power sleep (wakes on wakeword)
#define LED_COLOR_STANDBY           0x32F014   // Parrot Green  — Standby, mic ready & waiting for voice
#define LED_COLOR_DISCONNECTED      0x37F519   // Parrot Green  — WebSocket reconnecting
#define LED_COLOR_LISTENING         0xF573A5   // Soft Pink     — Microphone active, listening to user
#define LED_COLOR_THINKING          0x5AE182   // Pastel Green  — AI processing & generating response
#define LED_COLOR_SPEAKING          0x0FD2E6   // Teal Blue     — Speaker playing AI speech response

// --- [2] HARDWARE BOOT & NETWORK STATUS ---
#define LED_COLOR_BOOTING           0x00C8FF   // Sky Blue      — Device powered on, initial boot
#define LED_COLOR_WIFI_OK           0x00FF00   // Green         — Wi-Fi successfully connected
#define LED_COLOR_RELAY_CONNECTED   0xFFFFFF   // White         — WebSocket relay server connected
#define LED_COLOR_RELAY_UNAVAILABLE 0xFF6400   // Amber Orange  — Wi-Fi OK, but relay not reached yet
#define LED_COLOR_ERROR             0xFF0000   // Bright Red    — Critical error (Wi-Fi fail, memory fail)

// --- [3] VOLUME VU METER BAR COLORS ---
#define LED_COLOR_VU_LOW            0x00B400   // Green         — Volume level 1 to 4
#define LED_COLOR_VU_MID            0xB4B400   // Yellow        — Volume level 5 to 6
#define LED_COLOR_VU_HIGH           0xDC0000   // Red           — Maximum volume level 7

// --- [4] ANIMATION SPEED & BRIGHTNESS ---
#define LED_ANIM_SLEEP_SPEED        0.08f      // Slow breathing rate
#define LED_ANIM_STANDBY_SPEED      0.10f      // Standby breathing rate
#define LED_ANIM_DISCONN_SPEED      0.20f      // Reconnect breathing rate
#define LED_ANIM_LISTEN_SPEED       0.25f      // Listening pulse rate
#define LED_ANIM_THINK_SPEED        0.30f      // Thinking rhythm rate
#define LED_ANIM_SPEAK_SPEED        0.35f      // Audio wave ripple speed

#define LED_BRIGHTNESS_MIN          0.35f      // Minimum breathing brightness (0.0 to 1.0)
#define LED_BRIGHTNESS_MAX          1.00f      // Maximum breathing brightness (0.0 to 1.0)

// ==============================================================================
// 🛠️ HELPER CONVENIENCE MACROS & FUNCTIONS (Auto-translates HEX -> RGB)
// ==============================================================================
#define HEX_R(c) ((uint8_t)(((uint32_t)(c) >> 16) & 0xFF))
#define HEX_G(c) ((uint8_t)(((uint32_t)(c) >>  8) & 0xFF))
#define HEX_B(c) ((uint8_t)(((uint32_t)(c)      ) & 0xFF))

static inline void rgb_led_set_all_hex(uint32_t hex) {
    rgb_led_set_all(HEX_R(hex), HEX_G(hex), HEX_B(hex));
}

static inline void rgb_led_set_pixel_hex(uint32_t index, uint32_t hex) {
    rgb_led_set_pixel(index, HEX_R(hex), HEX_G(hex), HEX_B(hex));
}
