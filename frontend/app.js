/**
 * YHealth Voice Assistant — Main Application Controller
 * Handles WebSocket connection to Gemini Voice Relay, Web Audio capture/playback,
 * real-time dual visualizers, live transcript feed, and barge-in interrupts.
 */

// Application State
const STATE = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  INTERRUPTED: 'interrupted'
};

const MODE = {
  CONTINUOUS: 'continuous',
  PUSH_TO_TALK: 'ptt'
};

class YHealthVoiceApp {
  constructor() {
    this.state = STATE.DISCONNECTED;
    this.mode = MODE.CONTINUOUS;

    // Config defaults
    this.wsUrl = localStorage.getItem('yh_ws_url') || 'ws://' + window.location.hostname + (window.location.port ? ':' + window.location.port : '') + '/ws/live';
    this.doctorId = localStorage.getItem('yh_doctor_id') || '6789ebb61a093d60fa691c39';
    this.doctorName = localStorage.getItem('yh_doctor_name') || 'Dr. Brij Mohan Makkar';
    this.deviceId = localStorage.getItem('yh_device_id') || '001122334455';
    this.selectedMicId = localStorage.getItem('yh_mic_id') || '';

    // Networking & Audio
    this.ws = null;
    this.audioManager = null;
    this.pingTimer = null;
    this.lastPingSentAt = 0;

    // Telemetry
    this.metrics = {
      micBytes: 0,
      spkBytes: 0,
      latencyMs: null,
      turnCount: 0
    };

    // Active transcript streaming
    this.currentDoctorMsgElem = null;
    this.currentAssistantMsgElem = null;

    // Web Speech API for instant client preview
    this.speechRecognizer = null;
    this.isPttActive = false;

    // Canvas references
    this.micCanvas = null;
    this.micCtx = null;
    this.speakerCanvas = null;
    this.speakerCtx = null;
    this.animationFrameId = null;

    // DOM Elements Cache
    this.dom = {};
  }

  init() {
    this._cacheDom();
    this._bindEvents();
    this._initAudioCanvases();
    this._loadSettingsToInputs();
    this._initSpeechRecognition();
    this._fetchClinicalNotes();
    this._fetchPatients();
    this._fetchDevices();
    this._startVisualizerLoop();
    this.setUiState(STATE.DISCONNECTED);
  }

  _cacheDom() {
    this.dom = {
      statusPill: document.getElementById('statusPill'),
      statusText: document.getElementById('statusText'),
      headerDoctorName: document.getElementById('headerDoctorName'),
      headerClinicName: document.getElementById('headerClinicName'),
      orbContainer: document.getElementById('orbContainer'),
      mainVoiceOrb: document.getElementById('mainVoiceOrb'),
      toggleConnectBtn: document.getElementById('toggleConnectBtn'),
      connectBtnLabel: document.getElementById('connectBtnLabel'),
      bargeInBtn: document.getElementById('bargeInBtn'),
      pttBtn: document.getElementById('pttBtn'),
      modeToggleBtn: document.getElementById('modeToggleBtn'),
      modeLabel: document.getElementById('modeLabel'),
      sendTurnEndBtn: document.getElementById('sendTurnEndBtn'),
      conversationFeed: document.getElementById('conversationFeed'),
      clearChatBtn: document.getElementById('clearChatBtn'),
      connBadge: document.getElementById('connBadge'),
      telemetryLatency: document.getElementById('telemetryLatency'),
      telemetryMicBytes: document.getElementById('telemetryMicBytes'),
      telemetrySpkBytes: document.getElementById('telemetrySpkBytes'),
      telemetryPing: document.getElementById('telemetryPing'),
      volumeSlider: document.getElementById('volumeSlider'),
      volLabel: document.getElementById('volLabel'),
      toggleMicMuteBtn: document.getElementById('toggleMicMuteBtn'),
      micMuteLabel: document.getElementById('micMuteLabel'),
      toggleSpkMuteBtn: document.getElementById('toggleSpkMuteBtn'),
      spkMuteLabel: document.getElementById('spkMuteLabel'),
      refreshNotesBtn: document.getElementById('refreshNotesBtn'),
      notesContainer: document.getElementById('notesContainer'),
      patientListContainer: document.getElementById('patientListContainer'),
      micIndicator: document.getElementById('micIndicator'),
      speakerIndicator: document.getElementById('speakerIndicator'),
      // Modal
      settingsModal: document.getElementById('settingsModal'),
      openSettingsBtn: document.getElementById('openSettingsBtn'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),
      saveSettingsBtn: document.getElementById('saveSettingsBtn'),
      doctorConfigBtn: document.getElementById('doctorConfigBtn'),
      cfgWsUrl: document.getElementById('cfgWsUrl'),
      cfgDoctorId: document.getElementById('cfgDoctorId'),
      cfgDoctorName: document.getElementById('cfgDoctorName'),
      cfgMicDevice: document.getElementById('cfgMicDevice'),
      cfgDeviceId: document.getElementById('cfgDeviceId')
    };
  }

  _bindEvents() {
    // Connect / Disconnect button & Voice Orb
    this.dom.toggleConnectBtn.addEventListener('click', () => this.toggleConnection());
    this.dom.mainVoiceOrb.addEventListener('click', () => this.toggleConnection());

    // Barge-In / Interrupt
    this.dom.bargeInBtn.addEventListener('click', () => this.triggerBargeIn());

    // Push to Talk (pointer events)
    this.dom.pttBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._startPtt();
    });
    this.dom.pttBtn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      this._stopPtt();
    });
    this.dom.pttBtn.addEventListener('pointerleave', (e) => {
      if (this.isPttActive) this._stopPtt();
    });

    // Spacebar PTT shortcut when connected
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.mode === MODE.PUSH_TO_TALK && !this.isPttActive && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        this._startPtt();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.mode === MODE.PUSH_TO_TALK && this.isPttActive && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        this._stopPtt();
      }
    });

    // Mode Toggle
    this.dom.modeToggleBtn.addEventListener('click', () => this.toggleMode());

    // Force Turn End
    this.dom.sendTurnEndBtn.addEventListener('click', () => this.sendTurnEnd());

    // Clear Chat
    this.dom.clearChatBtn.addEventListener('click', () => {
      this.dom.conversationFeed.innerHTML = '';
      this.appendAssistantMessage('Chat cleared. Assistant is ready.');
    });

    // Volume Slider
    this.dom.volumeSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.dom.volLabel.textContent = `${val}%`;
      if (this.audioManager) {
        this.audioManager.setVolume(val / 100);
      }
    });

    // Mute Toggles
    this.dom.toggleMicMuteBtn.addEventListener('click', () => {
      if (this.audioManager) {
        const isMuted = this.audioManager.toggleMicMute();
        this.dom.micMuteLabel.textContent = isMuted ? 'Unmute Mic' : 'Mute Mic';
        this.dom.toggleMicMuteBtn.classList.toggle('active', isMuted);
      }
    });

    this.dom.toggleSpkMuteBtn.addEventListener('click', () => {
      if (this.audioManager) {
        const isMuted = this.audioManager.toggleSpeakerMute();
        this.dom.spkMuteLabel.textContent = isMuted ? 'Unmute Audio' : 'Mute Audio';
        this.dom.toggleSpkMuteBtn.classList.toggle('active', isMuted);
      }
    });

    // Quick Prompts
    document.querySelectorAll('.prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        this.handleQuickQuery(query);
      });
    });

    // Patient cards
    document.querySelectorAll('.patient-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.getAttribute('data-name');
        document.querySelectorAll('.patient-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        this.handleQuickQuery(`Pull up the record for ${name}.`);
      });
    });

    // Refresh Notes
    this.dom.refreshNotesBtn.addEventListener('click', () => this._fetchClinicalNotes());

    // Settings Modal
    this.dom.openSettingsBtn.addEventListener('click', () => this._openModal());
    this.dom.doctorConfigBtn.addEventListener('click', () => this._openModal());
    this.dom.closeSettingsBtn.addEventListener('click', () => this._closeModal());
    this.dom.saveSettingsBtn.addEventListener('click', () => this._saveSettings());
    this.dom.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.dom.settingsModal) this._closeModal();
    });
  }

  _initAudioCanvases() {
    this.micCanvas = document.getElementById('micCanvas');
    this.micCtx = this.micCanvas.getContext('2d');
    this.speakerCanvas = document.getElementById('speakerCanvas');
    this.speakerCtx = this.speakerCanvas.getContext('2d');

    // High-DPI Canvas scaling
    const scale = window.devicePixelRatio || 1;
    [this.micCanvas, this.speakerCanvas].forEach(c => {
      const rect = c.getBoundingClientRect();
      c.width = rect.width * scale;
      c.height = rect.height * scale;
    });
  }

  async _fetchDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      this.dom.cfgMicDevice.innerHTML = '<option value="">Default Laptop Microphone</option>';
      audioInputs.forEach((d, idx) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone ${idx + 1}`;
        if (d.deviceId === this.selectedMicId) opt.selected = true;
        this.dom.cfgMicDevice.appendChild(opt);
      });
    } catch (e) {
      console.warn('Could not list media devices:', e);
    }
  }

  _initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        this.speechRecognizer = new SpeechRecognition();
        this.speechRecognizer.continuous = true;
        this.speechRecognizer.interimResults = true;
        this.speechRecognizer.lang = 'en-IN'; // Indian English default

        this.speechRecognizer.onresult = (event) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          const text = final || interim;
          if (text.trim() && this.state !== STATE.SPEAKING) {
            this.lastDoctorUtterance = text.trim();
            this.updateDoctorTranscription(text.trim(), !!final);
            this.setUiState(STATE.LISTENING);
            if (final) {
              this.sendDoctorUtterance(final.trim());
            } else {
              clearTimeout(this.utteranceTimer);
              this.utteranceTimer = setTimeout(() => {
                if (interim.trim() && this.state === STATE.LISTENING) {
                  this.sendDoctorUtterance(interim.trim());
                }
              }, 1200);
            }
          }
        };

        this.speechRecognizer.onerror = (err) => {
          // Graceful ignore
        };
      } catch (e) {
        console.warn('SpeechRecognition init error:', e);
      }
    }
  }

  /**
   * Main Connection Toggle
   */
  async toggleConnection() {
    if (this.state === STATE.DISCONNECTED) {
      await this.connect();
    } else {
      this.disconnect();
    }
  }

  async connect() {
    this.setUiState(STATE.CONNECTING);
    this.appendSystemMessage('Initializing microphone and connecting to live relay...');

    // 1. Initialize AudioManager
    try {
      if (!this.audioManager) {
        this.audioManager = new AudioManager({
          onMicData: (pcmBuffer) => this.handleMicPcmChunk(pcmBuffer),
          onPlaybackEnd: () => {
            if (this.state === STATE.SPEAKING) {
              this.setUiState(STATE.IDLE);
            }
          }
        });
      }
      await this.audioManager.startMicrophone(this.selectedMicId || null);
    } catch (err) {
      console.error('Audio initialization error:', err);
      this.appendSystemMessage(`Microphone Error: ${err.message}`, 'error');
      this.setUiState(STATE.DISCONNECTED);
      return;
    }

    // 2. Build WebSocket URL
    let url = this.wsUrl.trim();
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
    }
    // Append doctor ID and device ID
    if (!url.includes('/' + this.doctorId)) {
      url = url.replace(/\/+$/, '') + '/' + this.doctorId;
    }
    const sep = url.includes('?') ? '&' : '?';
    const fullWsUrl = `${url}${sep}device_id=${encodeURIComponent(this.deviceId)}`;

    try {
      this.ws = new WebSocket(fullWsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.setUiState(STATE.IDLE);
        this.dom.connBadge.textContent = 'CONNECTED';
        this.dom.connBadge.style.color = 'var(--emerald)';
        this.appendSystemMessage(`Connected to YHealth Live Assistant (${this.doctorName})`, 'success');
        this._startPingTimer();

        if (this.speechRecognizer && this.mode === MODE.CONTINUOUS) {
          try { this.speechRecognizer.start(); } catch(e){}
        }
      };

      this.ws.onmessage = (event) => this.handleWsMessage(event);

      this.ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        this.appendSystemMessage('WebSocket relay error.', 'error');
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event);
        this.dom.connBadge.textContent = 'DISCONNECTED';
        this.dom.connBadge.style.color = '#64748b';
        this.appendSystemMessage(`Session disconnected (Code: ${event.code}).`, 'info');
        this.disconnect();
      };
    } catch (err) {
      console.error('Connection attempt failed:', err);
      this.appendSystemMessage(`Connection failed: ${err.message}`, 'error');
      this.disconnect();
    }
  }

  disconnect() {
    this._stopPingTimer();
    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
      this.ws = null;
    }
    if (this.audioManager) {
      this.audioManager.stopAll();
      this.audioManager = null;
    }
    if (this.speechRecognizer) {
      try { this.speechRecognizer.stop(); } catch(e){}
    }
    this.setUiState(STATE.DISCONNECTED);
    this.dom.connBadge.textContent = 'DISCONNECTED';
    this.dom.connBadge.style.color = '#64748b';
  }

  /**
   * Handle incoming 16kHz PCM from Mic and stream to WebSocket
   */
  handleMicPcmChunk(pcmBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // In PTT mode, only stream when button is pressed
    if (this.mode === MODE.PUSH_TO_TALK && !this.isPttActive) return;

    try {
      this.ws.send(pcmBuffer);
      this.metrics.micBytes += pcmBuffer.byteLength;
      this.dom.telemetryMicBytes.textContent = `${(this.metrics.micBytes / 1024).toFixed(1)} kB`;

      if (this.state === STATE.IDLE || this.state === STATE.INTERRUPTED) {
        this.setUiState(STATE.LISTENING);
      }
    } catch (e) {
      console.error('Error sending mic audio to websocket:', e);
    }
  }

  /**
   * Handle WebSocket messages from backend
   */
  handleWsMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      // Binary 16kHz 16-bit mono PCM speaker stream!
      this.metrics.spkBytes += event.data.byteLength;
      this.dom.telemetrySpkBytes.textContent = `${(this.metrics.spkBytes / 1024).toFixed(1)} kB`;

      if (this.audioManager) {
        this.audioManager.queuePcmAudio(event.data);
      }
      this.setUiState(STATE.SPEAKING);
      return;
    }

    // Text JSON messages from backend
    try {
      const data = JSON.parse(event.data);
      console.log('WS Event:', data);

      if (data.event === 'pong') {
        const rtt = Math.round((performance.now() - this.lastPingSentAt));
        this.metrics.latencyMs = rtt;
        this.dom.telemetryLatency.textContent = `${rtt} ms`;
        this.dom.telemetryPing.textContent = 'Healthy';
      } else if (data.event === 'turn_complete') {
        this.setUiState(STATE.IDLE);
        this.finalizeTurn(data);
      } else if (data.event === 'interrupt_ack') {
        if (this.audioManager) {
          this.audioManager.stopPlayback();
        }
        this.setUiState(STATE.INTERRUPTED);
        this.appendSystemMessage('Assistant playback interrupted by doctor.', 'info');
      } else if (data.event === 'transcription') {
        if (data.role === 'user') {
          this.updateDoctorTranscription(data.text, true);
        } else {
          this.updateAssistantTranscription(data.text);
        }
      } else if (data.event === 'turn_text') {
        if (data.role === 'user') {
          this.appendDoctorMessage(data.text);
        } else {
          this.appendAssistantMessage(data.text);
        }
      } else if (data.event === 'tool_call') {
        this.setUiState(STATE.THINKING);
        this.renderToolCall(data.name, data.args);
      } else if (data.event === 'tool_result') {
        this.renderToolResult(data.name, data.result);
      } else if (data.event === 'status_announcement') {
        this.appendSystemMessage(`Notice: ${data.text}`, 'info');
      } else if (data.event === 'conversation_end') {
        this.appendSystemMessage('Assistant signed off. Conversation completed.', 'info');
        this.setUiState(STATE.IDLE);
      }
    } catch (e) {
      console.warn('Non-JSON text frame:', event.data);
    }
  }

  /**
   * Barge-In / Interrupt trigger
   */
  triggerBargeIn() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    console.log('⚡ Triggering Barge-In / Interrupt');
    if (this.audioManager) {
      this.audioManager.stopPlayback();
    }
    // Send text message "interrupt" as expected by server.py
    try {
      this.ws.send(JSON.stringify({ event: 'interrupt' }));
    } catch(e){}

    this.setUiState(STATE.INTERRUPTED);
  }

  /**
   * Push to Talk controls
   */
  _startPtt() {
    if (this.state === STATE.DISCONNECTED) return;
    this.isPttActive = true;
    this.dom.pttBtn.classList.add('active');
    this.dom.pttBtn.querySelector('span').textContent = 'Listening... (Release to Send)';
    this.setUiState(STATE.LISTENING);
  }

  _stopPtt() {
    if (!this.isPttActive) return;
    this.isPttActive = false;
    this.dom.pttBtn.classList.remove('active');
    this.dom.pttBtn.querySelector('span').textContent = 'Hold to Speak';
    this.sendTurnEnd();
    this.setUiState(STATE.THINKING);
  }

  toggleMode() {
    if (this.mode === MODE.CONTINUOUS) {
      this.mode = MODE.PUSH_TO_TALK;
      this.dom.modeLabel.textContent = 'Push-to-Talk';
      this.dom.modeToggleBtn.classList.add('active');
      this.dom.pttBtn.style.display = 'inline-flex';
    } else {
      this.mode = MODE.CONTINUOUS;
      this.dom.modeLabel.textContent = 'Continuous VAD';
      this.dom.modeToggleBtn.classList.remove('active');
      this.dom.pttBtn.style.display = 'none';
    }
  }

  sendDoctorUtterance(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    console.log('Sending doctor utterance to backend:', text);
    try {
      this.ws.send(JSON.stringify({ event: 'user_utterance', text: text }));
      this.setUiState(STATE.THINKING);
    } catch (e) {
      console.error('Error sending user_utterance:', e);
    }
  }

  sendTurnEnd() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ event: 'audio_end' }));
      if (this.lastDoctorUtterance) {
        this.sendDoctorUtterance(this.lastDoctorUtterance);
        this.lastDoctorUtterance = '';
      }
      this.setUiState(STATE.THINKING);
    } catch (e) {
      console.error('Error sending audio_end:', e);
    }
  }

  handleQuickQuery(query) {
    if (this.state === STATE.DISCONNECTED) {
      this.connect().then(() => {
        setTimeout(() => this.speakSyntheticDoctorUtterance(query), 800);
      });
    } else {
      this.speakSyntheticDoctorUtterance(query);
    }
  }

  speakSyntheticDoctorUtterance(text) {
    this.appendDoctorMessage(text);
    this.sendDoctorUtterance(text);
    this.setUiState(STATE.THINKING);
  }

  /**
   * Update UI State & Badges
   */
  setUiState(newState) {
    this.state = newState;
    const pill = this.dom.statusPill;
    const text = this.dom.statusText;
    const orb = this.dom.orbContainer;
    const bargeIn = this.dom.bargeInBtn;

    pill.className = `status-pill ${newState}`;
    orb.className = `orb-container ${newState}`;

    switch (newState) {
      case STATE.DISCONNECTED:
        text.textContent = 'Disconnected';
        this.dom.connectBtnLabel.textContent = 'Start Voice Assistant';
        this.dom.toggleConnectBtn.classList.remove('btn-danger');
        this.dom.toggleConnectBtn.classList.add('btn-primary');
        bargeIn.disabled = true;
        this.dom.micIndicator.classList.remove('active');
        this.dom.speakerIndicator.classList.remove('active');
        break;

      case STATE.CONNECTING:
        text.textContent = 'Connecting...';
        this.dom.connectBtnLabel.textContent = 'Connecting...';
        bargeIn.disabled = true;
        break;

      case STATE.IDLE:
        text.textContent = 'Ready / Idle';
        this.dom.connectBtnLabel.textContent = 'Disconnect';
        this.dom.toggleConnectBtn.classList.remove('btn-primary');
        this.dom.toggleConnectBtn.classList.add('btn-danger');
        bargeIn.disabled = true;
        this.dom.micIndicator.classList.remove('active');
        this.dom.speakerIndicator.classList.remove('active');
        break;

      case STATE.LISTENING:
        text.textContent = 'Doctor Speaking';
        bargeIn.disabled = true;
        this.dom.micIndicator.classList.add('active');
        this.dom.speakerIndicator.classList.remove('active');
        break;

      case STATE.THINKING:
        text.textContent = 'AI Processing...';
        bargeIn.disabled = true;
        this.dom.micIndicator.classList.remove('active');
        this.dom.speakerIndicator.classList.remove('active');
        break;

      case STATE.SPEAKING:
        text.textContent = 'Assistant Speaking';
        bargeIn.disabled = false; // Enable Barge-In!
        this.dom.micIndicator.classList.remove('active');
        this.dom.speakerIndicator.classList.add('active');
        break;

      case STATE.INTERRUPTED:
        text.textContent = 'Interrupted';
        bargeIn.disabled = true;
        this.dom.speakerIndicator.classList.remove('active');
        break;
    }
  }

  /**
   * Conversation Feed Renderers
   */
  appendDoctorMessage(text) {
    const row = document.createElement('div');
    row.className = 'msg-row user';
    row.innerHTML = `
      <div class="msg-avatar">DR</div>
      <div class="msg-bubble">
        <div>${this._escapeHtml(text)}</div>
        <div class="msg-meta">
          <span>Dr. Makkar</span> • <span>${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
        </div>
      </div>
    `;
    this.dom.conversationFeed.appendChild(row);
    this._scrollChat();
  }

  updateDoctorTranscription(text, isFinal = false) {
    if (!this.currentDoctorMsgElem) {
      this.currentDoctorMsgElem = document.createElement('div');
      this.currentDoctorMsgElem.className = 'msg-row user';
      this.currentDoctorMsgElem.innerHTML = `
        <div class="msg-avatar">DR</div>
        <div class="msg-bubble">
          <div class="live-text">${this._escapeHtml(text)}</div>
          <div class="msg-meta">
            <span>Doctor (Speaking...)</span>
          </div>
        </div>
      `;
      this.dom.conversationFeed.appendChild(this.currentDoctorMsgElem);
    } else {
      const textElem = this.currentDoctorMsgElem.querySelector('.live-text');
      if (textElem) textElem.textContent = text;
    }

    if (isFinal) {
      this.currentDoctorMsgElem.querySelector('.msg-meta').innerHTML = `<span>Dr. Makkar</span> • <span>${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>`;
      this.currentDoctorMsgElem = null;
    }
    this._scrollChat();
  }

  appendAssistantMessage(text) {
    const row = document.createElement('div');
    row.className = 'msg-row assistant';
    row.innerHTML = `
      <div class="msg-avatar">AI</div>
      <div class="msg-bubble">
        <div>${this._escapeHtml(text)}</div>
        <div class="msg-meta">
          <span>YHealth AI</span> • <span>${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
        </div>
      </div>
    `;
    this.dom.conversationFeed.appendChild(row);
    this._scrollChat();
  }

  updateAssistantTranscription(text) {
    if (!this.currentAssistantMsgElem) {
      this.currentAssistantMsgElem = document.createElement('div');
      this.currentAssistantMsgElem.className = 'msg-row assistant';
      this.currentAssistantMsgElem.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-bubble">
          <div class="live-text">${this._escapeHtml(text)}</div>
          <div class="msg-meta">
            <span>YHealth AI (Live Speech)</span>
          </div>
        </div>
      `;
      this.dom.conversationFeed.appendChild(this.currentAssistantMsgElem);
    } else {
      const textElem = this.currentAssistantMsgElem.querySelector('.live-text');
      if (textElem) textElem.textContent += text;
    }
    this._scrollChat();
  }

  finalizeTurn(data) {
    if (this.currentAssistantMsgElem) {
      this.currentAssistantMsgElem.querySelector('.msg-meta').innerHTML = `<span>YHealth AI</span> • <span>${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>`;
      this.currentAssistantMsgElem = null;
    }
    this.currentDoctorMsgElem = null;
    this.metrics.turnCount++;
  }

  renderToolCall(toolName, args) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-header">
        <span>⚡ CLINICAL TOOL: ${this._escapeHtml(toolName)}</span>
        <span style="color: var(--amber);">Executing...</span>
      </div>
      <div class="tool-content">
        ${this._escapeHtml(JSON.stringify(args, null, 2))}
      </div>
    `;
    this.dom.conversationFeed.appendChild(card);
    this._scrollChat();
  }

  renderToolResult(toolName, result) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    card.innerHTML = `
      <div class="tool-header">
        <span style="color: var(--emerald-light);">✓ RESULT: ${this._escapeHtml(toolName)}</span>
        <span style="color: var(--emerald);">${result?.status || 'Completed'}</span>
      </div>
      <div class="tool-content">
        ${this._escapeHtml(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result))}
      </div>
    `;
    this.dom.conversationFeed.appendChild(card);
    this._scrollChat();
  }

  appendSystemMessage(text, type = 'info') {
    const color = type === 'error' ? 'var(--rose)' : type === 'success' ? 'var(--emerald)' : 'var(--text-dim)';
    const div = document.createElement('div');
    div.style.cssText = `text-align: center; font-size: 0.72rem; color: ${color}; margin: 0.4rem 0; font-family: var(--font-mono);`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    this.dom.conversationFeed.appendChild(div);
    this._scrollChat();
  }

  _scrollChat() {
    this.dom.conversationFeed.scrollTop = this.dom.conversationFeed.scrollHeight;
  }

  _escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[m]));
  }

  /**
   * Dual Audio Visualizer Animation Loop
   */
  _startVisualizerLoop() {
    const micData = new Uint8Array(128);
    const speakerData = new Uint8Array(128);

    const render = () => {
      // 1. Draw Mic Input Canvas
      if (this.micCtx && this.micCanvas) {
        const w = this.micCanvas.width;
        const h = this.micCanvas.height;
        this.micCtx.clearRect(0, 0, w, h);

        const hasMicAudio = this.audioManager?.getMicFrequencyData(micData);
        const barCount = 36;
        const barWidth = (w / barCount) - 2;

        for (let i = 0; i < barCount; i++) {
          const sampleIdx = Math.floor(i * (micData.length / barCount));
          const val = hasMicAudio ? micData[sampleIdx] / 255.0 : 0.02;
          const barHeight = Math.max(3, val * h * 0.9);
          const x = i * (barWidth + 2);
          const y = h - barHeight;

          const grad = this.micCtx.createLinearGradient(0, y, 0, h);
          grad.addColorStop(0, '#10b981');
          grad.addColorStop(1, '#059669');

          this.micCtx.fillStyle = grad;
          this.micCtx.fillRect(x, y, barWidth, barHeight);
        }
      }

      // 2. Draw Assistant Speaker Output Canvas
      if (this.speakerCtx && this.speakerCanvas) {
        const w = this.speakerCanvas.width;
        const h = this.speakerCanvas.height;
        this.speakerCtx.clearRect(0, 0, w, h);

        const hasSpkAudio = this.audioManager?.getSpeakerFrequencyData(speakerData);
        const barCount = 36;
        const barWidth = (w / barCount) - 2;

        for (let i = 0; i < barCount; i++) {
          const sampleIdx = Math.floor(i * (speakerData.length / barCount));
          const val = hasSpkAudio ? speakerData[sampleIdx] / 255.0 : 0.02;
          const barHeight = Math.max(3, val * h * 0.9);
          const x = i * (barWidth + 2);
          const y = h - barHeight;

          const grad = this.speakerCtx.createLinearGradient(0, y, 0, h);
          grad.addColorStop(0, '#f59e0b');
          grad.addColorStop(1, '#d97706');

          this.speakerCtx.fillStyle = grad;
          this.speakerCtx.fillRect(x, y, barWidth, barHeight);
        }
      }

      this.animationFrameId = requestAnimationFrame(render);
    };

    render();
  }

  /**
   * Ping / Latency Telemetry
   */
  _startPingTimer() {
    this._stopPingTimer();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.lastPingSentAt = performance.now();
        this.ws.send(JSON.stringify({ event: 'ping' }));
      }
    }, 5000);
  }

  _stopPingTimer() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _getHttpBase() {
    try {
      if (this.wsUrl && (this.wsUrl.startsWith('ws://') || this.wsUrl.startsWith('wss://'))) {
        const url = new URL(this.wsUrl);
        const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
        return `${protocol}//${url.host}`;
      }
    } catch (e) {}
    return '';
  }

  /**
   * Clinical Notes REST fetch
   */
  async _fetchClinicalNotes() {
    try {
      const res = await fetch(`${this._getHttpBase()}/api/clinical-notes`);
      if (res.ok) {
        const notes = await res.json();
        if (Array.isArray(notes) && notes.length > 0) {
          this.dom.notesContainer.innerHTML = '';
          notes.slice(0, 5).forEach(n => {
            const item = document.createElement('div');
            item.style.cssText = 'padding: 0.55rem; border-radius: var(--radius-sm); background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle);';
            item.innerHTML = `
              <div style="font-weight: 600; color: #fff;">${this._escapeHtml(n.patient_name || n.patient_id || 'Note')}</div>
              <div style="color: #cbd5e1; font-size: 0.74rem; margin-top: 0.2rem;">${this._escapeHtml(n.note || '')}</div>
            `;
            this.dom.notesContainer.appendChild(item);
          });
        }
      }
    } catch (e) {
      // Quiet fail if API not available
    }
  }

  /**
   * Fetch active patients from /api/patients
   */
  async _fetchPatients() {
    try {
      const res = await fetch(`${this._getHttpBase()}/api/patients`);
      if (res.ok) {
        const patients = await res.json();
        if (Array.isArray(patients) && patients.length > 0) {
          this.dom.patientListContainer.innerHTML = '';
          const countElem = document.getElementById('rosterCount');
          if (countElem) countElem.textContent = `${patients.length} Patients`;
          patients.forEach((p, idx) => {
            const card = document.createElement('div');
            card.className = 'patient-card';
            card.setAttribute('data-name', p.name);
            card.innerHTML = `
              <div>
                <div class="patient-name">${this._escapeHtml(p.name)}</div>
                <div class="patient-phone">📞 •••• ••${p.mobile ? p.mobile.slice(-4) : '••••'}</div>
              </div>
              <span style="font-size: 0.72rem; color: ${idx === 0 ? 'var(--emerald)' : 'var(--text-dim)'};">${idx === 0 ? 'Active' : 'Chart'}</span>
            `;
            card.addEventListener('click', () => {
              document.querySelectorAll('.patient-card').forEach(c => c.classList.remove('active'));
              card.classList.add('active');
              this.handleQuickQuery(`Pull up the record for ${p.name}.`);
            });
            this.dom.patientListContainer.appendChild(card);
          });
        }
      }
    } catch (e) {
      console.warn('Could not fetch real patients:', e);
    }
  }

  /**
   * Settings Modal handlers
   */
  _openModal() {
    this._loadSettingsToInputs();
    this.dom.settingsModal.classList.add('open');
  }

  _closeModal() {
    this.dom.settingsModal.classList.remove('open');
  }

  _loadSettingsToInputs() {
    this.dom.cfgWsUrl.value = this.wsUrl;
    this.dom.cfgDoctorId.value = this.doctorId;
    this.dom.cfgDoctorName.value = this.doctorName;
    this.dom.cfgDeviceId.value = this.deviceId;
    this.dom.headerDoctorName.textContent = this.doctorName;
  }

  _saveSettings() {
    this.wsUrl = this.dom.cfgWsUrl.value.trim();
    this.doctorId = this.dom.cfgDoctorId.value.trim();
    this.doctorName = this.dom.cfgDoctorName.value.trim();
    this.deviceId = this.dom.cfgDeviceId.value.trim();
    this.selectedMicId = this.dom.cfgMicDevice.value;

    localStorage.setItem('yh_ws_url', this.wsUrl);
    localStorage.setItem('yh_doctor_id', this.doctorId);
    localStorage.setItem('yh_doctor_name', this.doctorName);
    localStorage.setItem('yh_device_id', this.deviceId);
    localStorage.setItem('yh_mic_id', this.selectedMicId);

    this.dom.headerDoctorName.textContent = this.doctorName;
    this._closeModal();
    this.appendSystemMessage('Settings saved. Reconnect to apply new WebSocket endpoint or Doctor ID.', 'success');
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const app = new YHealthVoiceApp();
  app.init();
  window.YHealthApp = app;
});
