/**
 * AudioWorkletProcessor for capturing mic audio and streaming 16kHz PCM chunks
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = 16000;
    this.inputSampleRate = options?.processorOptions?.sampleRate || sampleRate || 48000;
    this.bufferSize = 1024; // 1024 samples = 64ms @ 16kHz
    this.pcmBuffer = new Int16Array(this.bufferSize);
    this.pcmIndex = 0;
    this.ratio = this.inputSampleRate / this.targetSampleRate;
    this.accum = 0;
    this.count = 0;
    this.targetStep = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channelData = input[0]; // Mono channel

    for (let i = 0; i < channelData.length; i++) {
      this.accum += channelData[i];
      this.count++;

      if (this.count >= this.ratio) {
        const avg = this.accum / this.count;
        this.accum = 0;
        this.count = 0;

        // Clamp to [-1.0, 1.0] and convert to signed 16-bit PCM
        const s = Math.max(-1.0, Math.min(1.0, avg));
        const val = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7FFF);
        this.pcmBuffer[this.pcmIndex++] = val;

        if (this.pcmIndex >= this.bufferSize) {
          // Send 16-bit PCM buffer to main thread
          this.port.postMessage({
            type: 'pcm',
            buffer: this.pcmBuffer.slice(0, this.pcmIndex).buffer
          }, [this.pcmBuffer.slice(0, this.pcmIndex).buffer]);
          this.pcmIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
