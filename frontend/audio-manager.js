
/**
 * AudioManager: Handles real-time microphone capture (resampled to 16kHz mono PCM)
 * and gapless speaker playback of incoming 16kHz PCM chunks with jitter buffering.
 */
class AudioManager {
  constructor(options = {}) {
    this.targetSampleRate = 16000;
    this.onMicData = options.onMicData || (() => {});
    this.onStateChange = options.onStateChange || (() => {});
    this.onPlaybackEnd = options.onPlaybackEnd || (() => {});

    // Audio Contexts
    this.inputCtx = null;
    this.outputCtx = null;
    this.micStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.scriptNode = null;

    // Analysers for visualizers
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.outputGainNode = null;

    // Output playback scheduling
    this.playbackQueue = [];
    this.activeSources = [];
    this.nextStartTime = 0;
    this.isPlaying = false;
    this.playbackCheckTimer = null;

    // Settings
    this.volume = 1.0;
    this.isMuted = false;
    this.isMicMuted = false;
  }

  /**
   * Initialize microphone capture
   */
  async startMicrophone(deviceId = null) {
    // Teardown any previous stream/nodes
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch(e){}
      this.sourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    if (!this.inputCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.inputCtx = new AudioCtx();
    }

    if (this.inputCtx.state === 'suspended') {
      await this.inputCtx.resume();
    }

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {})
      }
    };

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      throw new Error(`Microphone access failed: ${err.message}`);
    }

    this.sourceNode = this.inputCtx.createMediaStreamSource(this.micStream);

    // Setup Analyser for Mic Input visualizer
    this.inputAnalyser = this.inputCtx.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this.inputAnalyser.smoothingTimeConstant = 0.8;
    this.sourceNode.connect(this.inputAnalyser);

    // Try AudioWorklet first, fall back to ScriptProcessorNode
    let workletLoaded = false;
    try {
      if (this.inputCtx.audioWorklet) {
        await this.inputCtx.audioWorklet.addModule('/static/pcm-processor.js');
        this.workletNode = new AudioWorkletNode(this.inputCtx, 'pcm-processor', {
          processorOptions: { sampleRate: this.inputCtx.sampleRate }
        });
        this.workletNode.port.onmessage = (event) => {
          if (!this.isMicMuted && event.data.type === 'pcm') {
            this.onMicData(event.data.buffer);
          }
        };
        this.sourceNode.connect(this.workletNode);
        this.workletNode.connect(this.inputCtx.destination); // Required by some browsers to keep active
        workletLoaded = true;
      }
    } catch (e) {
      console.warn('AudioWorklet failed to load, falling back to ScriptProcessor:', e);
      workletLoaded = false;
    }

    if (!workletLoaded) {
      this._setupScriptProcessor();
    }

    // Ensure output context is ready
    this._ensureOutputContext();
    return true;
  }

  /**
   * ScriptProcessor fallback for resampling to 16kHz PCM
   */
  _setupScriptProcessor() {
    const bufferSize = 4096;
    this.scriptNode = this.inputCtx.createScriptProcessor(bufferSize, 1, 1);
    const inputSampleRate = this.inputCtx.sampleRate;
    const targetSampleRate = this.targetSampleRate;
    const ratio = inputSampleRate / targetSampleRate;

    let accum = 0;
    let count = 0;
    const outChunkSize = 1024;
    let outPcm = new Int16Array(outChunkSize);
    let outIdx = 0;

    this.scriptNode.onaudioprocess = (e) => {
      if (this.isMicMuted) return;
      const input = e.inputBuffer.getChannelData(0);

      for (let i = 0; i < input.length; i++) {
        accum += input[i];
        count++;

        if (count >= ratio) {
          const avg = accum / count;
          accum = 0;
          count = 0;

          const s = Math.max(-1.0, Math.min(1.0, avg));
          const val = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7FFF);
          outPcm[outIdx++] = val;

          if (outIdx >= outChunkSize) {
            const bufToSend = outPcm.slice(0, outIdx).buffer;
            this.onMicData(bufToSend);
            outIdx = 0;
          }
        }
      }
    };

    this.sourceNode.connect(this.scriptNode);
    this.scriptNode.connect(this.inputCtx.destination);
  }

  /**
   * Ensure output AudioContext exists
   */
  _ensureOutputContext() {
    if (!this.outputCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.outputCtx = new AudioCtx();

      this.outputGainNode = this.outputCtx.createGain();
      this.outputGainNode.gain.value = this.volume;

      this.outputAnalyser = this.outputCtx.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.smoothingTimeConstant = 0.8;

      this.outputGainNode.connect(this.outputAnalyser);
      this.outputAnalyser.connect(this.outputCtx.destination);
    }
  }

  /**
   * Feed incoming 16kHz 16-bit mono PCM chunks from backend to speaker
   */
  queuePcmAudio(arrayBuffer) {
    this._ensureOutputContext();
    if (this.outputCtx.state === 'suspended') {
      this.outputCtx.resume();
    }

    const pcm16 = new Int16Array(arrayBuffer);
    if (pcm16.length === 0) return;

    // Convert 16-bit integer PCM to Float32 [-1.0, 1.0]
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    // Create an audio buffer at 16,000 Hz
    const audioBuffer = this.outputCtx.createBuffer(1, float32.length, this.targetSampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.outputCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.outputGainNode);

    const currentTime = this.outputCtx.currentTime;
    // Add 40ms lead for jitter smoothing
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime + 0.04;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;

    this.activeSources.push(source);
    this.isPlaying = true;

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (this.activeSources.length === 0 && this.outputCtx.currentTime >= this.nextStartTime - 0.05) {
        this.isPlaying = false;
        this.onPlaybackEnd();
      }
    };
  }

  /**
   * Instantly stop assistant playback (barge-in / interrupt)
   */
  stopPlayback() {
    for (const src of this.activeSources) {
      try {
        src.stop(0);
        src.disconnect();
      } catch (e) {}
    }
    this.activeSources = [];
    this.nextStartTime = 0;
    this.isPlaying = false;
    this.onPlaybackEnd();
  }

  /**
   * Set output speaker volume (0.0 to 1.0)
   */
  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.outputGainNode) {
      this.outputGainNode.gain.value = this.isMuted ? 0 : this.volume;
    }
  }

  /**
   * Toggle speaker mute
   */
  toggleSpeakerMute() {
    this.isMuted = !this.isMuted;
    if (this.outputGainNode) {
      this.outputGainNode.gain.value = this.isMuted ? 0 : this.volume;
    }
    return this.isMuted;
  }

  /**
   * Toggle mic mute
   */
  toggleMicMute() {
    this.isMicMuted = !this.isMicMuted;
    return this.isMicMuted;
  }

  /**
   * Get Mic input frequency data for visualizer
   */
  getMicFrequencyData(dataArray) {
    if (this.inputAnalyser && !this.isMicMuted) {
      this.inputAnalyser.getByteFrequencyData(dataArray);
      return true;
    }
    dataArray.fill(0);
    return false;
  }

  /**
   * Get Speaker output frequency data for visualizer
   */
  getSpeakerFrequencyData(dataArray) {
    if (this.outputAnalyser && this.isPlaying && !this.isMuted) {
      this.outputAnalyser.getByteFrequencyData(dataArray);
      return true;
    }
    dataArray.fill(0);
    return false;
  }

  /**
   * Cleanup all resources
   */
  stopAll() {
    this.stopPlayback();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.inputCtx) {
      this.inputCtx.close();
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      this.outputCtx.close();
      this.outputCtx = null;
    }
  }
}
