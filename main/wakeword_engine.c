#include "wakeword_engine.h"
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "WAKEWORD_LOCAL";

#define SAMPLE_RATE 16000.0f

// -----------------------------------------------------------------
// Biquad Bandpass Filter (Direct Form II Transposed)
// -----------------------------------------------------------------
typedef struct {
    float b0, b1, b2;
    float a1, a2;
    float d1, d2;
} biquad_t;

static void biquad_init_bandpass(biquad_t *f, float f0, float Q, float fs) {
    float omega = 2.0f * (float)M_PI * f0 / fs;
    float alpha = sinf(omega) / (2.0f * Q);
    float a0 = 1.0f + alpha;

    f->b0 = alpha / a0;
    f->b1 = 0.0f;
    f->b2 = -alpha / a0;
    f->a1 = (-2.0f * cosf(omega)) / a0;
    f->a2 = (1.0f - alpha) / a0;
    f->d1 = 0.0f;
    f->d2 = 0.0f;
}

static inline float biquad_process(biquad_t *f, float in) {
    float out = f->b0 * in + f->d1;
    f->d1 = f->b1 * in - f->a1 * out + f->d2;
    f->d2 = f->b2 * in - f->a2 * out;
    return out;
}

static inline void biquad_reset(biquad_t *f) {
    f->d1 = 0.0f;
    f->d2 = 0.0f;
}

// Low (700Hz), Mid (1400Hz), High (2600Hz) formant filters
static biquad_t s_bp_low;
static biquad_t s_bp_mid;
static biquad_t s_bp_high;

// DC blocker
static float s_dc_x1 = 0.0f;
static float s_dc_y1 = 0.0f;

// -----------------------------------------------------------------
// Noise Floor Estimator (NSNet-inspired sliding minimum)
// -----------------------------------------------------------------
#define NF_FRAMES 32 // ~1 second @ 32ms frames
typedef struct {
    float history[NF_FRAMES];
    size_t head;
    float current_floor;
    bool primed;
} noise_floor_t;

static noise_floor_t s_nf_low  = {0};
static noise_floor_t s_nf_mid  = {0};
static noise_floor_t s_nf_high = {0};

static void noise_floor_update(noise_floor_t *nf, float energy) {
    nf->history[nf->head] = energy;
    nf->head = (nf->head + 1) % NF_FRAMES;
    float min_val = nf->history[0];
    size_t lim = nf->primed ? NF_FRAMES : (nf->head ? nf->head : 1);
    for (size_t i = 1; i < lim; i++) {
        if (nf->history[i] < min_val) min_val = nf->history[i];
    }
    nf->current_floor = min_val;
    if (nf->head == 0) nf->primed = true;
}

static inline float noise_floor_gate(noise_floor_t *nf, float energy) {
    if (!nf->primed && nf->head < 4) return energy;
    float thresh = nf->current_floor * 1.20f;
    if (energy < thresh) return 0.0f;
    return energy - nf->current_floor;
}

// -----------------------------------------------------------------
// Syllable State Machine
// -----------------------------------------------------------------
// LIRA: "LEE" (high formant) -> "RAH" (low formant)
typedef struct {
    bool s1_confirmed;
    int64_t last_s1_ms;
} lira_detector_t;

// HELLO ASSISTANT: "HELLO" (mid/low formant) -> "ASSISTANT" (sibilant fricative high burst)
typedef struct {
    bool hello_confirmed;
    int64_t last_hello_ms;
} hello_assistant_detector_t;

static lira_detector_t s_lira = {0};
static hello_assistant_detector_t s_ha = {0};

static inline int64_t get_time_ms(void) {
    return esp_timer_get_time() / 1000;
}

void wakeword_init(void) {
    biquad_init_bandpass(&s_bp_low,  700.0f,  1.1f, SAMPLE_RATE);
    biquad_init_bandpass(&s_bp_mid,  1400.0f, 1.1f, SAMPLE_RATE);
    biquad_init_bandpass(&s_bp_high, 2600.0f, 1.1f, SAMPLE_RATE);
    wakeword_reset();
    ESP_LOGI(TAG, "Local wakeword engine initialized (targets: 'hello assistant', 'LIRA')");
}

void wakeword_reset(void) {
    biquad_reset(&s_bp_low);
    biquad_reset(&s_bp_mid);
    biquad_reset(&s_bp_high);
    s_dc_x1 = 0.0f;
    s_dc_y1 = 0.0f;
    memset(&s_lira, 0, sizeof(s_lira));
    memset(&s_ha, 0, sizeof(s_ha));
}

bool wakeword_feed_samples(const int16_t *samples, size_t count, wakeword_result_t *out_result) {
    if (!samples || count == 0 || !out_result) return false;
    out_result->detected = false;
    out_result->confidence = 0.0f;
    out_result->keyword = "";

    int64_t now = get_time_ms();

    // 1. RMS and peak calculation with DC offset blocking
    double sum_sq = 0.0;
    float max_peak = 0.0f;
    for (size_t i = 0; i < count; i++) {
        float x = (float)samples[i];
        // 1st order DC blocker (R = 0.995)
        float y = x - s_dc_x1 + 0.995f * s_dc_y1;
        s_dc_x1 = x;
        s_dc_y1 = y;

        float val = fabsf(y);
        if (val > max_peak) max_peak = val;
        sum_sq += (double)y * (double)y;
    }
    float raw_rms = sqrtf((float)(sum_sq / count));

    // Fast reject on extreme silence (quiet room ambient is < 25)
    if (raw_rms < 25.0f) {
        if (s_lira.s1_confirmed && (now - s_lira.last_s1_ms > 900)) s_lira.s1_confirmed = false;
        if (s_ha.hello_confirmed && (now - s_ha.last_hello_ms > 1200)) s_ha.hello_confirmed = false;
        return false;
    }

    // 2. Transient rejection (clicks, sharp taps have crest factor > 5.5 and very high peak)
    float crest_factor = (raw_rms > 10.0f) ? (max_peak / raw_rms) : 0.0f;
    if (crest_factor > 5.5f && raw_rms > 450.0f) {
        return false;
    }

    // 3. Bandpass decomposition
    float energy_low = 0.0f;
    float energy_mid = 0.0f;
    float energy_high = 0.0f;

    for (size_t i = 0; i < count; i++) {
        float s = (float)samples[i];
        float l = biquad_process(&s_bp_low, s);
        float m = biquad_process(&s_bp_mid, s);
        float h = biquad_process(&s_bp_high, s);
        energy_low  += l * l;
        energy_mid  += m * m;
        energy_high += h * h;
    }
    energy_low  = sqrtf(energy_low / count);
    energy_mid  = sqrtf(energy_mid / count);
    energy_high = sqrtf(energy_high / count);

    // 4. Update noise floor and apply spectral gating
    noise_floor_update(&s_nf_low,  energy_low);
    noise_floor_update(&s_nf_mid,  energy_mid);
    noise_floor_update(&s_nf_high, energy_high);

    float det_low  = noise_floor_gate(&s_nf_low,  energy_low);
    float det_mid  = noise_floor_gate(&s_nf_mid,  energy_mid);
    float det_high = noise_floor_gate(&s_nf_high, energy_high);

    // -------------------------------------------------------------
    // DETECTOR A: "LIRA" ("LEE" -> "RAH")
    // -------------------------------------------------------------
    // Stage 1: "LEE" (/liː/) -> High formant dominance (~2600Hz)
    if (det_high >= 18.0f && det_high > 1.20f * det_low && raw_rms >= 35.0f) {
        s_lira.s1_confirmed = true;
        s_lira.last_s1_ms = now;
    }

    // Stage 2: "RAH" (/rɑː/) -> Low formant dominance (~700Hz)
    if (s_lira.s1_confirmed) {
        int64_t delta = now - s_lira.last_s1_ms;
        if (delta >= 80 && delta <= 950) {
            if (det_low >= 18.0f && det_low > 1.20f * det_high) {
                out_result->detected = true;
                out_result->confidence = 0.95f;
                out_result->keyword = "LIRA";
                wakeword_reset();
                ESP_LOGI(TAG, "🎯 Wakeword confirmed: 'LIRA' (delta=%lld ms, rms=%.1f)", delta, raw_rms);
                return true;
            }
        } else if (delta > 950) {
            s_lira.s1_confirmed = false;
        }
    }

    // -------------------------------------------------------------
    // DETECTOR B: "HELLO ASSISTANT" ("HELLO" / "HEY" -> "ASSISTANT")
    // -------------------------------------------------------------
    // Stage 1: "HELLO" / "HEY" -> Mid/Low vowel formant concentration
    if ((det_mid + det_low) >= 24.0f && (det_mid + det_low) > 1.25f * det_high && raw_rms >= 40.0f) {
        s_ha.hello_confirmed = true;
        s_ha.last_hello_ms = now;
    }

    // Stage 2: "ASSISTANT" -> Sibilant "SIS" burst (high frequency)
    if (s_ha.hello_confirmed) {
        int64_t delta_ha = now - s_ha.last_hello_ms;
        if (delta_ha >= 100 && delta_ha <= 1250) {
            if (det_high >= 20.0f && det_high > 1.15f * det_mid) {
                out_result->detected = true;
                out_result->confidence = 0.95f;
                out_result->keyword = "HELLO ASSISTANT";
                wakeword_reset();
                ESP_LOGI(TAG, "🎯 Wakeword confirmed: 'HELLO ASSISTANT' (delta=%lld ms, rms=%.1f)", delta_ha, raw_rms);
                return true;
            }
        } else if (delta_ha > 1250) {
            s_ha.hello_confirmed = false;
        }
    }

    return false;
}
