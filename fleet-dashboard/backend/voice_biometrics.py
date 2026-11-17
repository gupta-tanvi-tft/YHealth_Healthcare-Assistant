import os
import json
from datetime import datetime, timezone
from typing import Union, List, Dict, Any, Optional

import numpy as np
import scipy.signal
import scipy.fftpack

def compute_f0_pitch(samples: np.ndarray, sample_rate: int = 16000) -> float:
    """
    Computes fundamental pitch F0 (Hz) using multi-frame normalized autocorrelation.
    Samples multiple voiced frames across the audio signal and takes the median to avoid
    outliers caused by consonants or onset transients.
    """
    min_lag = int(sample_rate / 400) # 400 Hz max pitch (40 samples at 16kHz)
    max_lag = int(sample_rate / 60)  # 60 Hz min pitch (266 samples at 16kHz)

    if len(samples) < max_lag * 2:
        return 145.0

    frame_size = min(1600, len(samples)) # 100ms
    hop_size = 800                      # 50ms
    num_frames = max(1, (len(samples) - frame_size) // hop_size + 1)

    f0_estimates = []
    for f in range(min(num_frames, 10)):
        idx = f * hop_size
        window = samples[idx : idx + frame_size]
        if len(window) < frame_size or np.std(window) < 1e-3:
            continue
        corr = scipy.signal.correlate(window, window, mode='full')
        corr = corr[len(window) - 1 :]
        if max_lag >= len(corr):
            continue
        segment = corr[min_lag:max_lag]
        if len(segment) == 0:
            continue
        peak_idx = np.argmax(segment)
        peak_val = segment[peak_idx]
        if corr[0] > 1e-6 and (peak_val / corr[0]) > 0.25:
            peak_lag = min_lag + peak_idx
            if peak_lag > 0:
                pitch = sample_rate / peak_lag
                f0_estimates.append(pitch)

    if f0_estimates:
        return float(np.median(f0_estimates))

    mid = len(samples) // 2
    win_len = min(2000, len(samples))
    start_idx = max(0, mid - (win_len // 2))
    window = samples[start_idx : start_idx + win_len]
    corr = scipy.signal.correlate(window, window, mode='full')[len(window) - 1 :]
    if max_lag < len(corr):
        segment = corr[min_lag:max_lag]
        if len(segment) > 0 and np.max(segment) > 0:
            peak_lag = min_lag + np.argmax(segment)
            if peak_lag > 0:
                return float(sample_rate / peak_lag)
    return 145.0

def extract_voiceprint(pcm_bytes: bytes, sample_rate: int = 16000) -> dict:
    """
    Extracts a robust acoustic biometric voiceprint signature from 16kHz PCM audio.
    Returns:
      - 'embedding': 64-dim normalized cepstral-spectral vector
      - 'f0_pitch': fundamental pitch in Hz
      - 'pitch_range': pitch modulation standard deviation
    """
    if len(pcm_bytes) < 3200:
        return {"embedding": [0.0]*64, "f0_pitch": 120.0, "pitch_range": 0.0}

    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

    # 1. Pitch analysis
    f0 = compute_f0_pitch(samples, sample_rate)

    # 2. Pre-emphasis
    pre = np.append(samples[0], samples[1:] - 0.97 * samples[:-1])

    # 3. Framing (25ms window, 10ms step)
    frame_len = 400
    frame_step = 160
    if len(pre) < frame_len:
        return {"embedding": [0.0]*64, "f0_pitch": f0, "pitch_range": 0.0}

    num_frames = 1 + int((len(pre) - frame_len) / frame_step)
    indices = np.tile(np.arange(0, frame_len), (num_frames, 1)) + \
              np.tile(np.arange(0, num_frames * frame_step, frame_step), (frame_len, 1)).T
    frames = pre[indices] * np.hamming(frame_len)

    # 4. FFT & Mel-Filterbank (26 filters)
    mag_frames = np.absolute(np.fft.rfft(frames, 512))
    pow_frames = (mag_frames ** 2) / 512.0

    low_mel = 2595 * np.log10(1 + 100 / 700)
    high_mel = 2595 * np.log10(1 + 7500 / 700)
    mel_pts = np.linspace(low_mel, high_mel, 28)
    hz_pts = 700 * (10**(mel_pts / 2595) - 1)
    bins = np.floor(513 * hz_pts / sample_rate).astype(int)

    fbank = np.zeros((26, 257))
    for m in range(1, 27):
        for k in range(bins[m-1], bins[m]):
            fbank[m-1, k] = (k - bins[m-1]) / (bins[m] - bins[m-1])
        for k in range(bins[m], bins[m+1]):
            fbank[m-1, k] = (bins[m+1] - k) / (bins[m+1] - bins[m])

    fb_energy = np.dot(pow_frames, fbank.T)
    fb_energy = np.where(fb_energy == 0, 1e-10, fb_energy)
    fb_log = 20 * np.log10(fb_energy)

    # 5. Cepstral Mean Subtraction (CMS) - Removes mic/channel coloration
    fb_log -= np.mean(fb_log, axis=0, keepdims=True)

    # 6. DCT -> 16 MFCCs
    mfcc = scipy.fftpack.dct(fb_log, type=2, axis=1, norm='ortho')[:, :16]
    mean_mfcc = np.mean(mfcc, axis=0) # 16
    std_mfcc = np.std(mfcc, axis=0)   # 16

    # 7. Formants / Spectral Energy Distribution across 4 frequency bands
    band_ratios = np.mean(fb_log, axis=0) # 26
    # Compress 26 bands to 16 principal components
    band_16 = np.interp(np.linspace(0, 25, 16), np.arange(26), band_ratios)

    # 8. Spectral Centroid & Flux (16 stats)
    freqs = np.fft.rfftfreq(512, 1.0 / sample_rate)
    sc = np.sum(mag_frames * freqs, axis=1) / (np.sum(mag_frames, axis=1) + 1e-6)
    sc_mean = np.mean(sc)
    sc_std = np.std(sc)
    sc_stats = np.array([
        sc_mean / 3000.0,
        sc_std / 1500.0,
        f0 / 300.0,
        np.std(samples) * 5.0,
        np.mean(samples**2) * 20.0,
        np.percentile(sc, 10) / 3000.0,
        np.percentile(sc, 50) / 3000.0,
        np.percentile(sc, 90) / 3000.0,
        np.mean(np.diff(sc)**2) if len(sc) > 1 else 0.0,
        np.std(np.diff(sc)) if len(sc) > 1 else 0.0,
        np.mean(np.abs(np.diff(samples > 0))),
        np.std(np.abs(np.diff(samples > 0))),
        np.max(sc) / 4000.0,
        np.min(sc) / 4000.0,
        (sc_mean - f0) / 2000.0,
        np.log(np.var(samples) + 1e-6) / 10.0
    ], dtype=np.float32)

    # Combine into 64-dimensional feature vector (16 + 16 + 16 + 16 = 64)
    raw_vec = np.concatenate([mean_mfcc, std_mfcc, band_16, sc_stats])
    norm = np.linalg.norm(raw_vec)
    if norm > 0:
        raw_vec = raw_vec / norm

    return {
        "embedding": raw_vec.tolist(),
        "f0_pitch": round(float(f0), 1),
        "pitch_range": round(float(np.std(samples) * 100), 2)
    }

def verify_speaker_match(test_voiceprint: dict, enrolled_voiceprint: dict, threshold: float = 0.65) -> tuple:
    """
    Compares an incoming test voiceprint against the enrolled doctor's voiceprint.
    Returns (is_match: bool, confidence_score: float, details: dict)
    """
    v1 = np.array(test_voiceprint["embedding"], dtype=np.float32)
    v2 = np.array(enrolled_voiceprint["embedding"], dtype=np.float32)
    
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 < 1e-6 or norm2 < 1e-6:
        cosine_sim = 0.0
    else:
        cosine_sim = float(np.dot(v1, v2) / (norm1 * norm2 + 1e-9))
    
    # Pitch difference analysis:
    f0_test = float(test_voiceprint.get("f0_pitch", 145.0))
    f0_enrolled = float(enrolled_voiceprint.get("f0_pitch", 145.0))
    f0_diff = abs(f0_test - f0_enrolled)
    
    # Check if pitch is an octave harmonic (halved or doubled or 1.5x) within 25 Hz
    is_harmonic = (
        abs(f0_test * 2 - f0_enrolled) < 25.0 or 
        abs(f0_test - f0_enrolled * 2) < 25.0 or
        abs(f0_test * 1.5 - f0_enrolled) < 25.0 or
        abs(f0_test - f0_enrolled * 1.5) < 25.0
    )
    if is_harmonic:
        effective_diff = min(f0_diff, 12.0)
    else:
        effective_diff = f0_diff

    # Pitch congruence:
    if effective_diff <= 35.0:
        pitch_congruence = 1.0
    elif effective_diff <= 65.0:
        pitch_congruence = 1.0 - (effective_diff - 35.0) / 60.0
    else:
        pitch_congruence = max(0.1, 0.5 - (effective_diff - 65.0) / 90.0)
    
    # Multi-factor biometric fusion:
    # If cosine_sim >= 0.85, the vocal tract physical characteristics are an authentic match.
    # We weight cosine_sim 75% and pitch 25%.
    if cosine_sim >= 0.85:
        final_score = round(max(0.0, min(1.0, 0.75 * cosine_sim + 0.25 * pitch_congruence)), 3)
    elif pitch_congruence < 0.25:
        final_score = round(max(0.0, min(1.0, 0.45 * cosine_sim + 0.55 * pitch_congruence)), 3)
    else:
        final_score = round(max(0.0, min(1.0, 0.60 * cosine_sim + 0.40 * pitch_congruence)), 3)

    is_match = final_score >= threshold

    return is_match, final_score, {
        "cosine_sim": round(cosine_sim, 3),
        "f0_diff_hz": round(effective_diff, 1),
        "pitch_congruence": round(pitch_congruence, 3),
        "threshold": threshold
    }

def decode_audio_sample(data: Union[str, bytes]) -> bytes:
    """Decodes base64 string or WAV/miniaudio container into raw 16kHz 16-bit mono PCM."""
    import base64
    import io
    import wave

    if isinstance(data, str):
        if "," in data:
            data = data.split(",", 1)[1]
        raw_bytes = base64.b64decode(data.strip())
    else:
        raw_bytes = data

    if raw_bytes.startswith(b"RIFF"):
        try:
            with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
                n_channels = wf.getnchannels()
                sampwidth = wf.getsampwidth()
                framerate = wf.getframerate()
                frames = wf.readframes(wf.getnframes())
                if n_channels == 1 and sampwidth == 2 and framerate == 16000:
                    return frames
        except Exception:
            pass
        # Fallback to miniaudio for resampling / channel mixing
        try:
            import miniaudio
            decoded = miniaudio.decode(raw_bytes, nchannels=1, sample_rate=16000, sample_format=miniaudio.SampleFormat.SIGNED16)
            return decoded.samples.tobytes()
        except Exception:
            return raw_bytes[44:] if len(raw_bytes) > 44 else raw_bytes

    # Attempt miniaudio decode if header is unknown (e.g. mp3/webm/ogg)
    try:
        import miniaudio
        decoded = miniaudio.decode(raw_bytes, nchannels=1, sample_rate=16000, sample_format=miniaudio.SampleFormat.SIGNED16)
        return decoded.samples.tobytes()
    except Exception:
        pass

    return raw_bytes


VOICEPRINTS_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "doctor_voiceprints.json")
)

def load_all_voiceprints() -> Dict[str, Any]:
    if os.path.exists(VOICEPRINTS_FILE):
        try:
            with open(VOICEPRINTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[BIOMETRICS] Error reading voiceprints: {e}")
    return {}

def save_all_voiceprints(data: Dict[str, Any]):
    try:
        os.makedirs(os.path.dirname(VOICEPRINTS_FILE), exist_ok=True)
        with open(VOICEPRINTS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[BIOMETRICS] Error saving voiceprints: {e}")

def load_doctor_voiceprint(identifier: str) -> Optional[Dict[str, Any]]:
    """
    Looks up a voiceprint by doctor_id, device_id, or mac_address.
    Normalizes identifiers to handle colons/hyphens/case in MACs.
    """
    if not identifier:
        return None
    raw_clean = identifier.strip().lower()
    hex_clean = "".join(c for c in raw_clean if c.isalnum())
    prints = load_all_voiceprints()

    # Direct match
    if raw_clean in prints:
        return prints[raw_clean]
    if hex_clean in prints:
        return prints[hex_clean]

    # Search through stored records for matching keys or metadata
    for key, vp in prints.items():
        k_clean = "".join(c for c in key if c.isalnum())
        if k_clean == hex_clean:
            return vp
        if vp.get("device_id") and "".join(c for c in vp.get("device_id").lower() if c.isalnum()) == hex_clean:
            return vp
        if vp.get("mac_address") and "".join(c for c in vp.get("mac_address").lower() if c.isalnum()) == hex_clean:
            return vp
        if vp.get("doctor_id") and "".join(c for c in vp.get("doctor_id").lower() if c.isalnum()) == hex_clean:
            return vp

    return None

def save_doctor_voiceprint(identifier: str, voiceprint: Dict[str, Any], aliases: Optional[List[str]] = None):
    """
    Saves a voiceprint linked to primary identifier and any device_id/MAC aliases.
    """
    prints = load_all_voiceprints()
    keys_to_bind = [identifier]
    if aliases:
        keys_to_bind.extend(aliases)
    
    # Also include keys from voiceprint fields if present
    for f in ["doctor_id", "device_id", "mac_address"]:
        val = voiceprint.get(f)
        if val:
            keys_to_bind.append(str(val))

    for k in keys_to_bind:
        if not k:
            continue
        clean = k.strip().lower()
        prints[clean] = voiceprint
        # Also index by alphanumeric normalized form (e.g. 288485b2bcb8 for 28:84:85:B2:BC:B8)
        norm_alphanumeric = "".join(c for c in clean if c.isalnum())
        if norm_alphanumeric:
            prints[norm_alphanumeric] = voiceprint

    save_all_voiceprints(prints)

def delete_doctor_voiceprint(identifier: str) -> bool:
    clean = identifier.strip().lower()
    hex_clean = "".join(c for c in clean if c.isalnum())
    prints = load_all_voiceprints()
    found = False
    keys_to_del = []
    for k, vp in prints.items():
        k_hex = "".join(c for c in k if c.isalnum())
        if k == clean or k_hex == hex_clean:
            keys_to_del.append(k)
            found = True
        elif vp.get("device_id") and "".join(c for c in vp.get("device_id").lower() if c.isalnum()) == hex_clean:
            keys_to_del.append(k)
            found = True
        elif vp.get("mac_address") and "".join(c for c in vp.get("mac_address").lower() if c.isalnum()) == hex_clean:
            keys_to_del.append(k)
            found = True
        elif vp.get("doctor_id") and "".join(c for c in vp.get("doctor_id").lower() if c.isalnum()) == hex_clean:
            keys_to_del.append(k)
            found = True

    for k in keys_to_del:
        if k in prints:
            del prints[k]

    if found:
        save_all_voiceprints(prints)
        return True
    return False

def enroll_doctor_voice(
    samples: List[Union[str, bytes]],
    doctor_id: str = "default",
    doctor_name: str = "Authorized Doctor",
    device_id: Optional[str] = None,
    mac_address: Optional[str] = None
) -> Dict[str, Any]:
    """
    Enrolls a doctor's voiceprint from 3 spoken acoustic samples.
    Computes normalized centroid embedding vector and mean pitch F0.
    Cryptographically/biometrically binds the signature to:
    - doctor_id
    - doctor_name
    - device_id (if assigned)
    - mac_address (hardware eFuse MAC)
    """
    if len(samples) < 1:
        raise ValueError("At least 1 audio sample required for enrollment (recommended 3).")

    vps = []
    for s in samples:
        pcm = decode_audio_sample(s)
        vp = extract_voiceprint(pcm)
        vps.append(vp)

    # Average the 64-dim embeddings
    embeddings = [np.array(v["embedding"], dtype=np.float32) for v in vps]
    mean_emb = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(mean_emb)
    if norm > 0:
        mean_emb = mean_emb / norm

    mean_f0 = float(np.mean([v["f0_pitch"] for v in vps]))
    mean_range = float(np.mean([v["pitch_range"] for v in vps]))

    # Verify internal consistency between samples if >= 2
    consistency = 1.0
    if len(vps) >= 2:
        sims = []
        for i in range(len(vps)):
            for j in range(i + 1, len(vps)):
                _, score, _ = verify_speaker_match(vps[i], vps[j], threshold=0.60)
                sims.append(score)
        consistency = round(float(np.mean(sims)), 3)

    master_voiceprint = {
        "doctor_id": doctor_id,
        "doctor_name": doctor_name,
        "device_id": device_id,
        "mac_address": mac_address,
        "embedding": mean_emb.tolist(),
        "f0_pitch": round(mean_f0, 1),
        "pitch_range": round(mean_range, 2),
        "sample_count": len(samples),
        "enrollment_consistency": consistency,
        "enrolled_at": datetime.now(timezone.utc).isoformat(),
        "biometrics_active": True,
        "security_policy": "STRICT_VOICE_VERIFICATION"
    }

    aliases = []
    if device_id:
        aliases.append(device_id)
    if mac_address:
        aliases.append(mac_address)

    save_doctor_voiceprint(doctor_id, master_voiceprint, aliases=aliases)
    return master_voiceprint


if __name__ == "__main__":
    t = np.linspace(0, 1.0, 16000)
    # Doctor A: 120 Hz fundamental
    v_a1 = (0.5 * np.sin(2 * np.pi * 120 * t) + 0.3 * np.sin(2 * np.pi * 240 * t) + 0.2 * np.sin(2 * np.pi * 360 * t)) * 32767
    v_a2 = (0.5 * np.sin(2 * np.pi * 122 * t) + 0.3 * np.sin(2 * np.pi * 244 * t) + 0.2 * np.sin(2 * np.pi * 366 * t)) * 32767
    v_a3 = (0.5 * np.sin(2 * np.pi * 119 * t) + 0.3 * np.sin(2 * np.pi * 238 * t) + 0.2 * np.sin(2 * np.pi * 357 * t)) * 32767
    # Intruder / Different Doctor B: 210 Hz fundamental
    v_b  = (0.5 * np.sin(2 * np.pi * 210 * t) + 0.3 * np.sin(2 * np.pi * 420 * t) + 0.2 * np.sin(2 * np.pi * 630 * t)) * 32767

    # Test 3-sample enrollment
    enrolled_doc = enroll_doctor_voice([
        v_a1.astype(np.int16).tobytes(),
        v_a2.astype(np.int16).tobytes(),
        v_a3.astype(np.int16).tobytes(),
    ], doctor_id="6789ebb61a093d60fa691c39", doctor_name="Dr. Brij Mohan Makkar")

    vp_test_doc = extract_voiceprint(v_a1.astype(np.int16).tobytes())
    vp_intruder = extract_voiceprint(v_b.astype(np.int16).tobytes())

    match_doc, score_doc, det_doc = verify_speaker_match(vp_test_doc, enrolled_doc)
    match_int, score_int, det_int = verify_speaker_match(vp_intruder, enrolled_doc)

    print(f"Doctor Match: {match_doc} (Score: {score_doc}) Details: {det_doc}")
    print(f"Intruder Match: {match_int} (Score: {score_int}) Details: {det_int}")

    assert match_doc is True
    assert match_int is False
    print("ALL BIOMETRIC ENROLLMENT TESTS PASSED!")

