#ifndef WAKEWORD_ENGINE_H
#define WAKEWORD_ENGINE_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    bool detected;
    float confidence;
    const char *keyword;
} wakeword_result_t;

/**
 * Initialize the on-device wakeword detection engine.
 */
void wakeword_init(void);

/**
 * Feed a chunk of 16kHz 16-bit mono PCM samples into the on-device engine.
 * Evaluates local acoustics for "Hello Assistant" and "LIRA".
 * 
 * @param samples Pointer to PCM sample array
 * @param count Number of samples (e.g. 512 for a 32ms chunk)
 * @param out_result Output struct populated with detection status & keyword
 * @return true if wake word was detected, false otherwise
 */
bool wakeword_feed_samples(const int16_t *samples, size_t count, wakeword_result_t *out_result);

/**
 * Reset internal state of the wakeword engine.
 */
void wakeword_reset(void);

#ifdef __cplusplus
}
#endif

#endif // WAKEWORD_ENGINE_H
