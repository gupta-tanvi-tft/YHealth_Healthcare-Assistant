import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AudioLines, Bell, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, ExternalLink, Filter, LayoutDashboard, RefreshCw, Search, Server, Settings2,
  ShieldCheck, Signal, XCircle, AlertTriangle, CircleHelp, Wifi, WifiOff,
  UserCheck, Stethoscope, PlusCircle, Sparkles, Building2, Radio, Edit3, Users,
  HeartPulse, FileText, Check, Cpu, Phone, Hash, Trash2, Zap, Usb, Cable,
  Bed, ArrowRightLeft, UserPlus
} from 'lucide-react'

const GRAFANA_BASE = (import.meta.env.VITE_GRAFANA_BASE_URL || 'https://monitoring.yhealth.me').replace(/\/$/, '')
const DASHBOARD_UID = import.meta.env.VITE_GRAFANA_DASHBOARD_UID || 'ad7r252'

const INITIAL_ACTIVE_SPEAKER = {
  id: 'SPK-a0f262e34c70',
  mac: 'A0:F2:62:E3:4C:70',
  wifi_ssid: 'TFTus-WiFi',
  owner: 'Dr. Samarth Gupta',
  doctor_id: '673334d939a1270181963600',
  type: 'HCP',
  status: 'online',
  site: 'Endocrinology Consultation Suite 1',
  department: 'Endocrinology',
  seen: 2,
  firmware: 'ESP32-S3 Audio v1.2.0 (Dual Mic ES7210 + ES8311 DAC)',
  signal: 94,
  audio_stream: '16 kHz Mono PCM (32 KB/s) — Lead: 600ms',
  gemini_mode: 'Gemini Live Multilingual (English, हिन्दी, Hinglish, Regional)'
}

const INITIAL_LOGS = [
  { id: 'l1', ts: Date.now() - 45000, level: 'INFO', source: 'esp32_hw', message: 'ESP32-S3 hardware booted. Dual MEMS microphones initialized via ES7210 I2S0 @ 16kHz.', device: 'SPK-a0f262e34c70' },
  { id: 'l2', ts: Date.now() - 38000, level: 'INFO', source: 'wifi_driver', message: "Wi-Fi associated to SSID 'TFTus-WiFi' (BSSID synced, RSSI: -54 dBm).", device: 'SPK-a0f262e34c70' },
  { id: 'l3', ts: Date.now() - 30000, level: 'INFO', source: 'websocket', message: 'Persistent WebSocket connected: wss://speaker.yhealth.me/ws/live/673334d939a1270181963600?device_id=a0f262e34c70', device: 'SPK-a0f262e34c70' },
  { id: 'l4', ts: Date.now() - 22000, level: 'INFO', source: 'gemini_live', message: 'Gemini Live session active. System prompt injected for Dr. Samarth Gupta (Endocrinologist). Voice: Kore.', device: 'SPK-a0f262e34c70' },
  { id: 'l5', ts: Date.now() - 16000, level: 'INFO', source: 'clinical_api', message: 'Fetched live patient roster from http://200.97.162.162:8000/agent/patients/673334d939a1270181963600', device: 'SPK-a0f262e34c70' },
  { id: 'l6', ts: Date.now() - 9000, level: 'INFO', source: 'audio_engine', message: 'Voice VAD trigger: Query for patient report detected. 1000ms silence -> audio_end sent.', device: 'SPK-a0f262e34c70' },
  { id: 'l7', ts: Date.now() - 4000, level: 'INFO', source: 'gemini_audio', message: 'Synthesized 24kHz audio resampled to 16kHz. Paced to ES8311 DAC via DMA (lead buffer: 600ms).', device: 'SPK-a0f262e34c70' },
  { id: 'l8', ts: Date.now() - 1000, level: 'INFO', source: 'turn_engine', message: 'Turn complete received. Ring buffer drained. Returned to CONV_STATE_STANDBY (Breathing Blue).', device: 'SPK-a0f262e34c70' }
]

function formatRelativeTime(seconds) {
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

export default function App() {
  const [currentView, setCurrentView] = useState('fleet') // 'fleet' | 'patients'
  const [speakers, setSpeakers] = useState(() => {
    const saved = localStorage.getItem('yhealth_speakers_fleet_v2')
    return saved ? JSON.parse(saved) : [INITIAL_ACTIVE_SPEAKER]
  })
  const [selectedId, setSelectedId] = useState(INITIAL_ACTIVE_SPEAKER.id)
  const [activeTab, setActiveTab] = useState('patients') // 'patients' | 'logs'
  const [patients, setPatients] = useState([])
  const [loadingPatients, setLoadingPatients] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [patientFilter, setPatientFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [wifiModalOpen, setWifiModalOpen] = useState(false)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [selectedPatientForAssign, setSelectedPatientForAssign] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [statusMessage, setStatusMessage] = useState('')

  // Clinical Notes & Voice Dictations state
  const [clinicalNotes, setClinicalNotes] = useState(() => {
    const saved = localStorage.getItem('yhealth_clinical_notes_v1')
    return saved ? JSON.parse(saved) : [
      {
        id: 'cn-1',
        patient_name: 'Priya Sharma',
        note: 'Advised fasting plasma glucose retest after 4 weeks. Incremented Metformin to 1000mg twice daily with meals. Suggested daily 30-minute brisk walk.',
        author: 'Dr. Samarth Gupta',
        category: 'Prescription & Lifestyle',
        timestamp: 'Today, 15:42',
        source: 'ESP32 Voice Speaker (SPK-a0f262e34c70)'
      },
      {
        id: 'cn-2',
        patient_name: 'Arun Kumar',
        note: 'Review continuous glucose monitoring (CGM) report. Time-in-range improved to 76%. Continue current Basal Insulin dosage (14 units bedtime).',
        author: 'Dr. Samarth Gupta',
        category: 'CGM Review',
        timestamp: 'Today, 14:15',
        source: 'ESP32 Voice Speaker (SPK-a0f262e34c70)'
      }
    ]
  })
  const [notesModalOpen, setNotesModalOpen] = useState(false)
  const [selectedPatientForNote, setSelectedPatientForNote] = useState(null)
  const [newNoteInput, setNewNoteInput] = useState('')
  const [newNoteCategory, setNewNoteCategory] = useState('Consultation Note')

  // Mapping of patientId -> speakerId stored in local storage
  const [patientSpeakerAssignments, setPatientSpeakerAssignments] = useState(() => {
    const saved = localStorage.getItem('yhealth_patient_speaker_map')
    return saved ? JSON.parse(saved) : {}
  })

  // Wi-Fi USB update form
  const [wifiForm, setWifiForm] = useState({
    ssid: 'TFTus-WiFi',
    password: '',
    altSsid: '',
    altPassword: '',
    isFlashing: false
  })

  // New speaker registration state
  const [newSpeakerForm, setNewSpeakerForm] = useState({
    id: '',
    mac: '',
    wifi_ssid: 'TFTus-WiFi',
    owner: '',
    type: 'HCP',
    site: 'Consultation Room 2',
    department: 'General Medicine',
    status: 'offline'
  })

  // Persist fleet changes
  useEffect(() => {
    localStorage.setItem('yhealth_speakers_fleet_v2', JSON.stringify(speakers))
  }, [speakers])

  // Persist patient assignments
  useEffect(() => {
    localStorage.setItem('yhealth_patient_speaker_map', JSON.stringify(patientSpeakerAssignments))
  }, [patientSpeakerAssignments])

  // Persist clinical notes
  useEffect(() => {
    localStorage.setItem('yhealth_clinical_notes_v1', JSON.stringify(clinicalNotes))
  }, [clinicalNotes])

  async function fetchBackendNotes() {
    try {
      const res = await fetch('http://localhost:8008/api/clinical-notes')
      if (res.ok) {
        const data = await res.json()
        if (data.notes && data.notes.length > 0) {
          setClinicalNotes(prev => {
            const existingIds = new Set(prev.map(n => n.id))
            const newOnes = data.notes.filter(n => !existingIds.has(n.id))
            return [...newOnes, ...prev]
          })
        }
      }
    } catch {}
  }

  // Fetch real patients from API 1
  async function fetchLivePatients() {
    setLoadingPatients(true)
    try {
      const res = await fetch(`http://200.97.162.162:8000/agent/patients/${INITIAL_ACTIVE_SPEAKER.doctor_id}`)
      if (res.ok) {
        const data = await res.json()
        const raw = data.patients || []
        const clean = raw
          .filter(p => {
            const name = `${p.first_name || ''} ${p.last_name || ''}`.trim()
            return name.length >= 2 && /[a-zA-Z]/.test(name) && !/(test|clevertap|delete|@|#)/i.test(name)
          })
          .map((p, idx) => ({
            id: p.id,
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            mobile: p.mobile || '—',
            room: idx === 0 ? 'ICU Bed 4' : idx < 4 ? `Ward 3 Bed ${idx}` : 'OPD Consultation'
          }))
        if (clean.length > 0) {
          setPatients(clean)
          setLoadingPatients(false)
          setLastRefresh(new Date())

          // Auto-assign first patient to primary speaker if no assignment exists yet
          setPatientSpeakerAssignments(prev => {
            if (Object.keys(prev).length === 0 && clean[0]) {
              return { [clean[0].id]: INITIAL_ACTIVE_SPEAKER.id }
            }
            return prev
          })
          return
        }
      }
    } catch (e) {
      console.warn('Direct fetch failed, falling back to local cached API:', e)
    }

    try {
      const res2 = await fetch('http://localhost:8010/api/patients')
      if (res2.ok) {
        const data2 = await res2.json()
        if (data2.patients) {
          setPatients(data2.patients)
          setLoadingPatients(false)
          setLastRefresh(new Date())
          return
        }
      }
    } catch {}

    setLoadingPatients(false)
  }

  useEffect(() => {
    fetchLivePatients()
    fetchBackendNotes()
    const intv = setInterval(fetchBackendNotes, 15000)
    return () => clearInterval(intv)
  }, [])

  const selected = speakers.find(s => s.id === selectedId) || speakers[0]

  const filteredSpeakers = useMemo(() => {
    return speakers.filter(s => {
      const matchSearch = `${s.id} ${s.mac} ${s.owner} ${s.site}`.toLowerCase().includes(searchQuery.toLowerCase())
      const matchStatus = statusFilter === 'all' || s.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [speakers, searchQuery, statusFilter])

  const filteredPatients = useMemo(() => {
    return patients.filter(p =>
      `${p.name} ${p.id} ${p.mobile}`.toLowerCase().includes(patientFilter.toLowerCase())
    )
  }, [patients, patientFilter])

  const onlineCount = speakers.filter(s => s.status === 'online').length

  // Web Serial USB Wi-Fi Flash Handler
  async function handleFlashWifiOverUsb(e) {
    e.preventDefault()
    if (!wifiForm.ssid.trim()) {
      alert("Please enter a valid Wi-Fi SSID.")
      return
    }

    if (!('serial' in navigator)) {
      alert("Web Serial API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera on desktop to flash over USB.")
      return
    }

    setWifiForm(prev => ({ ...prev, isFlashing: true }))

    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 115200 })

      const encoder = new TextEncoder()
      const writer = port.writable.getWriter()

      const cmd = `SET_WIFI:${wifiForm.ssid.trim()}:${wifiForm.password.trim()}\n`
      await writer.write(encoder.encode(cmd))
      writer.releaseLock()
      await port.close()

      setSpeakers(prev => prev.map(s => s.id === selected.id ? { ...s, wifi_ssid: wifiForm.ssid.trim() } : s))

      setStatusMessage(`Wi-Fi credentials for "${wifiForm.ssid}" successfully sent to ${selected.id} over USB!`)
      setWifiModalOpen(false)
      setTimeout(() => setStatusMessage(''), 6000)
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        alert("USB Provisioning Error: " + err.message)
      }
    } finally {
      setWifiForm(prev => ({ ...prev, isFlashing: false }))
    }
  }

  function handleAssignSpeakerToPatient(speakerId) {
    if (!selectedPatientForAssign) return
    setPatientSpeakerAssignments(prev => {
      const updated = { ...prev }
      if (speakerId === 'none') {
        delete updated[selectedPatientForAssign.id]
      } else {
        updated[selectedPatientForAssign.id] = speakerId
      }
      return updated
    })
    setAssignModalOpen(false)
    setStatusMessage(`Updated speaker assignment for patient ${selectedPatientForAssign.name}!`)
    setTimeout(() => setStatusMessage(''), 4000)
  }

  function handleAddSpeakerSubmit(e) {
    e.preventDefault()
    const id = newSpeakerForm.id.trim().toUpperCase() || `SPK-${Math.random().toString(16).substring(2, 6).toUpperCase()}`
    const mac = newSpeakerForm.mac.trim().toUpperCase() || Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join(':')

    const newUnit = {
      id: id.startsWith('SPK-') ? id : `SPK-${id}`,
      mac: mac,
      wifi_ssid: newSpeakerForm.wifi_ssid || 'TFTus-WiFi',
      owner: newSpeakerForm.owner || 'Unassigned (Configured via BLE)',
      doctor_id: INITIAL_ACTIVE_SPEAKER.doctor_id,
      type: newSpeakerForm.type,
      status: 'offline',
      site: newSpeakerForm.site || 'Clinic Storage',
      department: newSpeakerForm.department || 'Outpatient',
      seen: 3600,
      firmware: 'ESP32-S3 Audio v1.2.0',
      signal: 0,
      audio_stream: 'Standby / BLE Provisioning',
      gemini_mode: 'Gemini Live Multilingual'
    }

    setSpeakers(prev => [...prev, newUnit])
    setSelectedId(newUnit.id)
    setAddModalOpen(false)
  }

  function handleRemoveSpeaker(idToRemove, e) {
    e.stopPropagation()
    if (idToRemove === INITIAL_ACTIVE_SPEAKER.id) {
      alert("The active physical speaker (SPK-a0f262e34c70) cannot be deleted as it is your active hardware unit.")
      return
    }
    if (confirm(`Remove ${idToRemove} from fleet?`)) {
      setSpeakers(prev => prev.filter(s => s.id !== idToRemove))
      if (selectedId === idToRemove) {
        setSelectedId(INITIAL_ACTIVE_SPEAKER.id)
      }
    }
  }

  const grafanaUrl = `${GRAFANA_BASE}/d/${DASHBOARD_UID}/yhealth-speaker?var-device_id=${selected.mac.replace(/:/g, '').toLowerCase()}&from=now-15m&to=now`

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon"><AudioLines size={22} /></div>
          <div>
            <b>YHEALTH</b>
            <small>FLEET CONTROL</small>
          </div>
        </div>

        <div className="workspace-tag">WORKSPACE</div>

        <button
          className={`side-link ${currentView === 'fleet' ? 'active' : ''}`}
          onClick={() => setCurrentView('fleet')}
        >
          <LayoutDashboard size={16} /> Speaker Fleet
          <span className="side-number">{String(speakers.length).padStart(2, '0')}</span>
        </button>

        <button
          className={`side-link ${currentView === 'patients' ? 'active' : ''}`}
          onClick={() => setCurrentView('patients')}
        >
          <Users size={16} /> Patient Assignments
          <span className="side-number" style={{ background: 'var(--mint-soft)', color: 'var(--mint)' }}>
            {patients.length}
          </span>
        </button>

        <a className="side-link" href={grafanaUrl} target="_blank" rel="noreferrer">
          <Activity size={16} /> Grafana Telemetry <ExternalLink size={12} style={{ marginLeft: 'auto' }} />
        </a>

        <button className="side-link" onClick={() => setWifiModalOpen(true)}>
          <Usb size={16} /> USB Wi-Fi Provision
        </button>

        <div className="sidebar-spacer" />

        <div className="security-card">
          <ShieldCheck size={18} />
          <div>
            <b>Hardware Connected</b>
            <p>Dr. Samarth Gupta (Endocrinologist) ↔ ESP32-S3 Audio Board</p>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <main className="main">
        {/* Topbar */}
        <header className="topbar">
          <div>
            <span className="crumb">Operations</span>
            <span className="slash">/</span>
            <b>{currentView === 'fleet' ? 'Speaker Fleet Console' : 'Patient-to-Speaker Assignment Hub'}</b>
          </div>

          <div className="top-actions">
            <span className="live-pill">
              <i /> LIVE HARDWARE SYNC
            </span>
            <span className="updated">Refreshed {lastRefresh.toLocaleTimeString()}</span>
            <button className="square-btn" title="Refresh Live Data" onClick={fetchLivePatients}>
              <RefreshCw size={15} />
            </button>
          </div>
        </header>

        {statusMessage && (
          <div style={{ background: 'var(--green-soft)', border: '1px solid var(--green)', color: 'var(--green)', padding: '10px 16px', borderRadius: 8, marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <CheckCircle2 size={16} />
            <strong>{statusMessage}</strong>
          </div>
        )}

        {/* VIEW 1: FLEET OVERVIEW */}
        {currentView === 'fleet' && (
          <div>
            {/* Hero Banner */}
            <section className="hero">
              <div>
                <div className="eyebrow"><span /> REAL-TIME SMART ASSISTANT FLEET</div>
                <h1>YHealth Speaker <span>Fleet</span></h1>
                <p>Physical ESP32-S3 smart speakers paired with Dr. Samarth Gupta for hands-free voice AI, USB provisioning, and live EHR chart access.</p>
              </div>

              <div className="hero-actions">
                <button className="outline-btn" onClick={() => setCurrentView('patients')}>
                  <Users size={14} /> View Patient Panel
                </button>
                <button className="outline-btn" onClick={() => setWifiModalOpen(true)}>
                  <Cable size={14} /> Update Wi-Fi via USB
                </button>
                <button className="primary-btn" onClick={() => setAddModalOpen(true)}>
                  <PlusCircle size={14} /> Add Speaker
                </button>
              </div>
            </section>

            {/* Fleet Metrics Strip */}
            <div className="metrics">
              <div className="metric">
                <div className="metric-icon"><AudioLines size={18} /></div>
                <div className="metric-text">
                  <span>Total Fleet Units</span>
                  <strong>{speakers.length}</strong>
                  <small>Registered Speakers</small>
                </div>
              </div>

              <div className="metric">
                <div className="metric-icon good"><Wifi size={18} /></div>
                <div className="metric-text">
                  <span>Online & Streaming</span>
                  <strong>{onlineCount}</strong>
                  <small>Active Consultation</small>
                </div>
              </div>

              <div className="metric">
                <div className="metric-icon"><Stethoscope size={18} /></div>
                <div className="metric-text">
                  <span>Assigned Physician</span>
                  <strong style={{ fontSize: 16 }}>{INITIAL_ACTIVE_SPEAKER.owner}</strong>
                  <small className="mono">Endocrinologist ({INITIAL_ACTIVE_SPEAKER.doctor_id.substring(0, 10)}...)</small>
                </div>
              </div>

              <div className="metric">
                <div className="metric-icon violet"><Users size={18} /></div>
                <div className="metric-text">
                  <span>Live Patient Roster</span>
                  <strong>{patients.length}</strong>
                  <small>Fetched from Hospital API</small>
                </div>
              </div>
            </div>

            {/* Section Heading & Device Cards */}
            <div className="section-heading">
              <div>
                <h2>Configured Speakers <span>{filteredSpeakers.length}</span></h2>
                <p>Click any speaker to inspect its Wi-Fi parameters, live patient database, or Grafana logs.</p>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 7, padding: '0 8px' }}>
                  <Search size={14} style={{ color: 'var(--dim)' }} />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search MAC, ID, room..."
                    style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 11, height: 32, outline: 'none' }}
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  style={{ background: 'var(--input)', border: '1px solid var(--line)', color: 'var(--text)', borderRadius: 7, padding: '0 8px', height: 32, fontSize: 11 }}
                >
                  <option value="all">All Statuses</option>
                  <option value="online">Online Only</option>
                  <option value="offline">Offline Only</option>
                </select>
              </div>
            </div>

            {/* Device Cards Grid */}
            <div className="device-grid">
              {filteredSpeakers.map(s => {
                const isSelected = selected.id === s.id
                const isOnline = s.status === 'online'
                return (
                  <div
                    key={s.id}
                    className={`device-card ${isSelected ? 'chosen' : ''}`}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <div className="dc-head">
                      <div className="speaker-glyph"><AudioLines size={18} /></div>
                      <div>
                        <div className="badge online" style={isOnline ? {} : { background: 'var(--panel2)', color: 'var(--muted)' }}>
                          <i style={isOnline ? {} : { animation: 'none' }} />
                          {isOnline ? 'Online & Active' : 'Standby'}
                        </div>
                      </div>
                      {s.id !== INITIAL_ACTIVE_SPEAKER.id && (
                        <button
                          title="Remove speaker"
                          onClick={e => handleRemoveSpeaker(s.id, e)}
                          style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--dim)' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    <div className="device-name">{s.id}</div>
                    <div className="device-mac">MAC: {s.mac}</div>

                    <div className="owner-line">
                      <span>{s.type}</span>
                      <strong>{s.owner}</strong>
                    </div>

                    <div className="dc-foot">
                      <div>
                        <small>LOCATION</small>
                        <b>{s.site}</b>
                      </div>
                      <div>
                        <small>WI-FI SSID</small>
                        <b className="mono">{s.wifi_ssid}</b>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Lower Split: Selected Hardware Inspector & Tabs (Patients / Logs) */}
            <div className="lower-grid">
              {/* Left Column: Speaker Hardware Details & Telemetry */}
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h2><Cpu size={16} /> {selected.id} Hardware Profile</h2>
                    <p>{selected.site} • {selected.department}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${selected.status}`}>
                      <i /> {selected.status === 'online' ? 'Connected' : 'Offline'}
                    </span>
                    <button
                      className="outline-btn"
                      style={{ padding: '4px 8px', fontSize: 10 }}
                      onClick={() => {
                        setWifiForm(prev => ({ ...prev, ssid: selected.wifi_ssid }))
                        setWifiModalOpen(true)
                      }}
                    >
                      <Usb size={12} /> Reconfigure Wi-Fi
                    </button>
                  </div>
                </div>

                <div className="selected-meta">
                  <div>
                    <small>PHYSICAL MAC ADDRESS</small>
                    <b className="mono" style={{ color: 'var(--mint)' }}>{selected.mac}</b>
                  </div>
                  <div>
                    <small>ASSIGNED PHYSICIAN</small>
                    <b>{selected.owner}</b>
                  </div>
                  <div>
                    <small>CURRENT WI-FI SSID</small>
                    <b className="mono" style={{ color: 'var(--green)' }}>{selected.wifi_ssid}</b>
                  </div>
                  <div>
                    <small>DOCTOR BACKEND ID</small>
                    <b className="mono" style={{ fontSize: 10 }}>{selected.doctor_id}</b>
                  </div>
                  <div>
                    <small>AUDIO CODEC STACK</small>
                    <b>{selected.audio_stream}</b>
                  </div>
                  <div>
                    <small>AI VOICE MODEL</small>
                    <b>{selected.gemini_mode}</b>
                  </div>
                  <div>
                    <small>FIRMWARE SPEC</small>
                    <b className="mono">{selected.firmware}</b>
                  </div>
                  <div>
                    <small>LAST HEARTBEAT</small>
                    <b>{formatRelativeTime(selected.seen)}</b>
                  </div>
                </div>

                <a className="grafana-link" href={grafanaUrl} target="_blank" rel="noreferrer">
                  <span>Open live Grafana dashboard (UID: {DASHBOARD_UID})</span>
                  <ExternalLink size={14} />
                </a>
              </section>

              {/* Right Column: Tabbed View (Live Patients Roster vs Event Stream) */}
              <section className="panel">
                <div className="tab-bar">
                  <button
                    className={`tab-btn ${activeTab === 'patients' ? 'active' : ''}`}
                    onClick={() => setActiveTab('patients')}
                  >
                    <Users size={14} /> Live Patients for Dr. Samarth Gupta ({patients.length})
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'notes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('notes')}
                  >
                    <FileText size={14} /> Dictated Notes & Orders ({clinicalNotes.length})
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
                    onClick={() => setActiveTab('logs')}
                  >
                    <Activity size={14} /> Hardware Logs ({INITIAL_LOGS.length})
                  </button>
                </div>

                {/* TAB 1: Real Patients Roster */}
                {activeTab === 'patients' && (
                  <div>
                    <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        Direct query from API: <code>http://200.97.162.162:8000/agent/patients/{INITIAL_ACTIVE_SPEAKER.doctor_id}</code>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 6, padding: '0 8px' }}>
                        <Search size={13} style={{ color: 'var(--dim)' }} />
                        <input
                          value={patientFilter}
                          onChange={e => setPatientFilter(e.target.value)}
                          placeholder="Search patient..."
                          style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 10, height: 28, outline: 'none' }}
                        />
                      </div>
                    </div>

                    <div className="data-table-wrap">
                      {loadingPatients ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                          Loading real patient records from hospital EHR...
                        </div>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Patient Name</th>
                              <th>Assigned Speaker</th>
                              <th>Registered Mobile</th>
                              <th>EHR Identifier</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPatients.map(p => {
                              const assignedSpkId = patientSpeakerAssignments[p.id]
                              const assignedSpk = speakers.find(s => s.id === assignedSpkId)
                              return (
                                <tr key={p.id}>
                                  <td style={{ fontWeight: 700 }}>{p.name}</td>
                                  <td>
                                    {assignedSpk ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px', borderRadius: 4, background: 'var(--mint-soft)', color: 'var(--mint)', fontWeight: 600, fontSize: 10 }}>
                                        <AudioLines size={12} /> {assignedSpk.id}
                                      </span>
                                    ) : (
                                      <span style={{ color: 'var(--dim)', fontSize: 10 }}>Not Assigned</span>
                                    )}
                                  </td>
                                  <td className="mono" style={{ color: 'var(--muted)' }}>{p.mobile}</td>
                                  <td className="mono" style={{ color: 'var(--mint)', fontSize: 10 }}>{p.id}</td>
                                  <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <button
                                      className="outline-btn"
                                      style={{ padding: '3px 8px', fontSize: 10 }}
                                      onClick={() => {
                                        setSelectedPatientForAssign(p)
                                        setAssignModalOpen(true)
                                      }}
                                    >
                                      Assign Speaker
                                    </button>
                                    <button
                                      className="outline-btn"
                                      style={{ padding: '3px 8px', fontSize: 10, borderColor: 'var(--mint-line)', color: 'var(--mint)' }}
                                      onClick={() => {
                                        setSelectedPatientForNote(p)
                                        setNotesModalOpen(true)
                                      }}
                                    >
                                      <FileText size={10} /> Add Note
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                            {filteredPatients.length === 0 && (
                              <tr>
                                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--dim)' }}>
                                  No patients match the filter.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 2: Dictated Clinical Notes Feed */}
                {activeTab === 'notes' && (
                  <div>
                    <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', background: 'rgba(101, 224, 194, 0.03)' }}>
                      <div style={{ fontSize: 11, color: 'var(--mint)' }}>
                        <Sparkles size={12} style={{ display: 'inline', marginRight: 4 }} />
                        Real-time voice dictations captured by ESP32 Smart Speaker during rounds
                      </div>
                      <button
                        className="primary-btn"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={() => {
                          setSelectedPatientForNote(patients[0] || { name: 'Priya Sharma' })
                          setNotesModalOpen(true)
                        }}
                      >
                        <PlusCircle size={12} /> Write Manual Note
                      </button>
                    </div>

                    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 440, overflowY: 'auto' }}>
                      {clinicalNotes.map(n => (
                        <div key={n.id} style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 700, color: 'var(--mint)', fontSize: 13 }}>{n.patient_name}</span>
                              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--input)', border: '1px solid var(--line)', color: 'var(--text)' }}>
                                {n.category}
                              </span>
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--dim)' }}>{n.timestamp}</span>
                          </div>
                          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>
                            "{n.note}"
                          </p>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--muted)', paddingTop: 4, borderTop: '1px solid var(--line)' }}>
                            <span>Author: <strong style={{ color: 'var(--text)' }}>{n.author}</strong></span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <AudioLines size={10} style={{ color: 'var(--mint)' }} /> {n.source}
                            </span>
                          </div>
                        </div>
                      ))}
                      {clinicalNotes.length === 0 && (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>
                          No clinical dictations recorded yet. Speak into the speaker: "Note for Priya: Advised fasting glucose retest."
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 3: Hardware Logs */}
                {activeTab === 'logs' && (
                  <div className="event-list">
                    {INITIAL_LOGS.map(log => (
                      <div key={log.id} className="event-row">
                        <span className="event-time">{new Date(log.ts).toLocaleTimeString([], { hour12: false })}</span>
                        <span className={`level ${log.level.toLowerCase()}`}>{log.level}</span>
                        <div className="event-copy">
                          <b>{log.message}</b>
                          <small>Source: {log.source} • Device: {log.device}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* VIEW 2: CUSTOMIZED PATIENT & SPEAKER ASSIGNMENT PANEL */}
        {currentView === 'patients' && (
          <div>
            <section className="hero">
              <div>
                <div className="eyebrow"><span /> PATIENT-TO-SPEAKER ALLOCATION HUB</div>
                <h1>Patient Care <span>Console</span></h1>
                <p>Customize and manage which smart speaker is assigned to each patient room, bed, or consultation desk.</p>
              </div>

              <div className="hero-actions">
                <button className="outline-btn" onClick={() => setCurrentView('fleet')}>
                  <LayoutDashboard size={14} /> Back to Fleet View
                </button>
                <button className="primary-btn" onClick={fetchLivePatients}>
                  <RefreshCw size={14} /> Refresh Roster
                </button>
              </div>
            </section>

            {/* Quick Summary Cards */}
            <div className="metrics">
              <div className="metric">
                <div className="metric-icon"><Users size={18} /></div>
                <div className="metric-text">
                  <span>Total Patients in Roster</span>
                  <strong>{patients.length}</strong>
                  <small>Dr. Samarth Gupta Roster</small>
                </div>
              </div>

              <div className="metric">
                <div className="metric-icon good"><AudioLines size={18} /></div>
                <div className="metric-text">
                  <span>Patients with Speaker</span>
                  <strong>{Object.keys(patientSpeakerAssignments).length}</strong>
                  <small>Active Room Speaker Pairings</small>
                </div>
              </div>

              <div className="metric">
                <div className="metric-icon"><Bed size={18} /></div>
                <div className="metric-text">
                  <span>Unassigned Patients</span>
                  <strong>{Math.max(0, patients.length - Object.keys(patientSpeakerAssignments).length)}</strong>
                  <small>Awaiting Speaker Pairing</small>
                </div>
              </div>

              <div className="metric">
                <div className="metric-icon violet"><Wifi size={18} /></div>
                <div className="metric-text">
                  <span>Active Hardware Speaker</span>
                  <strong style={{ fontSize: 15 }}>{INITIAL_ACTIVE_SPEAKER.id}</strong>
                  <small className="mono">MAC: {INITIAL_ACTIVE_SPEAKER.mac}</small>
                </div>
              </div>
            </div>

            {/* Patients Custom Table Section */}
            <div className="panel" style={{ marginTop: 20 }}>
              <div className="panel-head">
                <div>
                  <h2><Users size={16} /> Patient-to-Speaker Assignment Directory</h2>
                  <p>Allocate smart speakers to patients so the voice assistant immediately pulls the right medical history upon interaction.</p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 6, padding: '0 8px' }}>
                    <Search size={13} style={{ color: 'var(--dim)' }} />
                    <input
                      value={patientFilter}
                      onChange={e => setPatientFilter(e.target.value)}
                      placeholder="Search patient, phone, room..."
                      style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 11, height: 32, outline: 'none' }}
                    />
                  </div>
                </div>
              </div>

              <div className="data-table-wrap" style={{ maxHeight: 600 }}>
                {loadingPatients ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                    Loading patient data from hospital API...
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Patient Name</th>
                        <th>Care Location / Bed</th>
                        <th>Assigned Speaker</th>
                        <th>Speaker Status</th>
                        <th>Phone Number</th>
                        <th>EHR Mongo ID</th>
                        <th style={{ textAlign: 'right' }}>Manage Pairing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPatients.map(p => {
                        const assignedSpkId = patientSpeakerAssignments[p.id]
                        const assignedSpk = speakers.find(s => s.id === assignedSpkId)
                        return (
                          <tr key={p.id}>
                            <td style={{ fontWeight: 700, fontSize: 12 }}>{p.name}</td>
                            <td style={{ color: 'var(--text)' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <Bed size={13} style={{ color: 'var(--dim)' }} /> {p.room}
                              </span>
                            </td>
                            <td>
                              {assignedSpk ? (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 5, background: 'var(--mint-soft)', border: '1px solid var(--mint-line)', color: 'var(--mint)' }}>
                                  <AudioLines size={13} />
                                  <strong>{assignedSpk.id}</strong>
                                </div>
                              ) : (
                                <span style={{ color: 'var(--dim)', fontSize: 11 }}>No speaker paired</span>
                              )}
                            </td>
                            <td>
                              {assignedSpk ? (
                                <span className={`badge ${assignedSpk.status}`} style={{ fontSize: 9, padding: '2px 6px' }}>
                                  <i /> {assignedSpk.status === 'online' ? 'Online' : 'Standby'}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--dim)' }}>—</span>
                              )}
                            </td>
                            <td className="mono" style={{ color: 'var(--muted)' }}>{p.mobile}</td>
                            <td className="mono" style={{ color: 'var(--dim)', fontSize: 10 }}>{p.id}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                className="outline-btn"
                                style={{ padding: '4px 10px', fontSize: 10 }}
                                onClick={() => {
                                  setSelectedPatientForAssign(p)
                                  setAssignModalOpen(true)
                                }}
                              >
                                <ArrowRightLeft size={11} /> Change Speaker
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                      {filteredPatients.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ padding: 30, textAlign: 'center', color: 'var(--dim)' }}>
                            No patients found matching your search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal 1: Assign Speaker to Patient */}
        {assignModalOpen && selectedPatientForAssign && (
          <div className="modal-overlay" onClick={() => setAssignModalOpen(false)}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="dialog-head">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ArrowRightLeft size={18} style={{ color: 'var(--mint)' }} /> Assign Speaker to Patient
                  </h3>
                  <p>Select which physical smart speaker is stationed with <strong>{selectedPatientForAssign.name}</strong>.</p>
                </div>
                <button className="square-btn" onClick={() => setAssignModalOpen(false)}>✕</button>
              </div>

              <div className="dialog-body">
                <div style={{ padding: 12, background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 11 }}>
                  <div><strong>Patient:</strong> {selectedPatientForAssign.name}</div>
                  <div style={{ marginTop: 4 }}><strong>Location:</strong> {selectedPatientForAssign.room}</div>
                  <div style={{ marginTop: 4 }}><strong>EHR ID:</strong> <code className="mono">{selectedPatientForAssign.id}</code></div>
                </div>

                <div className="form-field">
                  <label>Choose Speaker from Fleet</label>
                  <select
                    className="text-input"
                    defaultValue={patientSpeakerAssignments[selectedPatientForAssign.id] || 'none'}
                    onChange={e => handleAssignSpeakerToPatient(e.target.value)}
                  >
                    <option value="none">-- Unassign (No Speaker) --</option>
                    {speakers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.id} (MAC: {s.mac}) — {s.status === 'online' ? 'Online' : 'Standby'}
                      </option>
                    ))}
                  </select>
                </div>

                <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  Assigning a speaker links this patient's EHR records to voice commands spoken directly into that specific hardware device.
                </p>
              </div>

              <div className="dialog-foot">
                <button type="button" className="outline-btn" onClick={() => setAssignModalOpen(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal 1.5: Add Clinical Note / Dictation Writeback */}
        {notesModalOpen && selectedPatientForNote && (
          <div className="modal-overlay" onClick={() => setNotesModalOpen(false)}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="dialog-head">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={18} style={{ color: 'var(--mint)' }} /> Clinical Note & Order Writeback
                  </h3>
                  <p>Record medical observation or orders for <strong>{selectedPatientForNote.name}</strong>.</p>
                </div>
                <button className="square-btn" onClick={() => setNotesModalOpen(false)}>✕</button>
              </div>

              <form onSubmit={async (e) => {
                e.preventDefault()
                if (!newNoteInput.trim()) return
                const newRecord = {
                  id: `cn-${Date.now().toString().slice(-4)}`,
                  patient_name: selectedPatientForNote.name,
                  note: newNoteInput.trim(),
                  author: 'Dr. Samarth Gupta',
                  category: newNoteCategory,
                  timestamp: 'Just now',
                  source: 'Doctor Dashboard'
                }
                setClinicalNotes(prev => [newRecord, ...prev])

                // Also persist to backend relay API
                try {
                  await fetch('http://localhost:8008/api/clinical-notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      patient_name: selectedPatientForNote.name,
                      note_content: newNoteInput.trim(),
                      category: newNoteCategory,
                      author: 'Dr. Samarth Gupta'
                    })
                  })
                } catch {}

                setNewNoteInput('')
                setNotesModalOpen(false)
                setStatusMessage(`Saved clinical note for ${selectedPatientForNote.name}`)
                setTimeout(() => setStatusMessage(''), 4000)
              }}>
                <div className="dialog-body">
                  <div className="form-field">
                    <label>Patient</label>
                    <div style={{ padding: '8px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 7, fontSize: 12, fontWeight: 700, color: 'var(--mint)' }}>
                      {selectedPatientForNote.name} {selectedPatientForNote.room ? `(${selectedPatientForNote.room})` : ''}
                    </div>
                  </div>

                  <div className="form-field">
                    <label>Note Category</label>
                    <select
                      className="text-input"
                      value={newNoteCategory}
                      onChange={e => setNewNoteCategory(e.target.value)}
                    >
                      <option value="Consultation Note">Consultation Observation</option>
                      <option value="Prescription & Medication">Prescription & Medication Change</option>
                      <option value="Lab & Diagnostic Order">Lab & Diagnostic Order</option>
                      <option value="Diet & Lifestyle">Diet & Lifestyle Recommendation</option>
                      <option value="Follow-up Plan">Follow-up Plan</option>
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Clinical Note / Dictated Observation</label>
                    <textarea
                      className="text-input"
                      rows={4}
                      value={newNoteInput}
                      onChange={e => setNewNoteInput(e.target.value)}
                      placeholder="e.g. Advised fasting plasma glucose retest. Increased Metformin to 1000mg twice daily."
                      required
                      style={{ resize: 'vertical', minHeight: 90 }}
                    />
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface-2)', padding: 10, borderRadius: 6, border: '1px solid var(--line)' }}>
                    💡 <strong>Voice Tip:</strong> You can also dictate hands-free via the smart speaker anytime during rounds by saying: <em>"Note for {selectedPatientForNote.name.split(' ')[0]}: [your clinical instruction]"</em>.
                  </div>
                </div>

                <div className="dialog-foot">
                  <button type="button" className="outline-btn" onClick={() => setNotesModalOpen(false)}>Cancel</button>
                  <button type="submit" className="primary-btn">
                    <Check size={14} /> Save Note to Record
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal 2: Update Wi-Fi via USB (Web Serial) */}
        {wifiModalOpen && (
          <div className="modal-overlay" onClick={() => setWifiModalOpen(false)}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="dialog-head">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Usb size={18} style={{ color: 'var(--mint)' }} /> Flash Wi-Fi Credentials via USB
                  </h3>
                  <p>Connect your ESP32-S3 speaker via USB-C. Enter the new network details to flash directly into NVS storage.</p>
                </div>
                <button className="square-btn" onClick={() => setWifiModalOpen(false)}>✕</button>
              </div>

              <form onSubmit={handleFlashWifiOverUsb}>
                <div className="dialog-body">
                  <div className="form-field">
                    <label>Target Speaker</label>
                    <div style={{ padding: '8px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: 7, fontSize: 11 }}>
                      <strong>{selected.id}</strong> (MAC: <code className="mono">{selected.mac}</code>)
                    </div>
                  </div>

                  <div className="form-field">
                    <label>New Wi-Fi SSID (Network Name)</label>
                    <input
                      className="text-input"
                      value={wifiForm.ssid}
                      onChange={e => setWifiForm({ ...wifiForm, ssid: e.target.value })}
                      placeholder="e.g. Hospital-Staff-WiFi"
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label>Wi-Fi Password / Passphrase</label>
                    <input
                      className="text-input"
                      type="password"
                      value={wifiForm.password}
                      onChange={e => setWifiForm({ ...wifiForm, password: e.target.value })}
                      placeholder="Enter Wi-Fi password (leave blank if open)"
                    />
                  </div>

                  <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--mint)', fontWeight: 700, marginBottom: 4 }}>
                      <Cable size={14} /> How it works:
                    </div>
                    When you click <strong>Flash Wi-Fi over USB</strong>, your browser will prompt you to pick the ESP32 USB Serial port (COM port). The new credentials are sent at 115200 baud, saved permanently to NVS flash, and the speaker auto-reboots to connect!
                  </div>
                </div>

                <div className="dialog-foot">
                  <button type="button" className="outline-btn" onClick={() => setWifiModalOpen(false)}>Cancel</button>
                  <button type="submit" className="primary-btn" disabled={wifiForm.isFlashing}>
                    {wifiForm.isFlashing ? 'Flashing...' : 'Flash Wi-Fi over USB'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal 3: Add New Speaker */}
        {addModalOpen && (
          <div className="modal-overlay" onClick={() => setAddModalOpen(false)}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="dialog-head">
                <div>
                  <h3>Add / Register Healthcare Speaker</h3>
                  <p>Register a newly purchased Waveshare ESP32-S3 speaker into your hospital fleet.</p>
                </div>
                <button className="square-btn" onClick={() => setAddModalOpen(false)}>✕</button>
              </div>

              <form onSubmit={handleAddSpeakerSubmit}>
                <div className="dialog-body">
                  <div className="form-field">
                    <label>Speaker ID</label>
                    <input
                      className="text-input mono"
                      value={newSpeakerForm.id}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, id: e.target.value })}
                      placeholder="e.g. SPK-002"
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label>Hardware MAC Address</label>
                    <input
                      className="text-input mono"
                      value={newSpeakerForm.mac}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, mac: e.target.value })}
                      placeholder="e.g. B1:E4:59:A2:10:02"
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label>Assigned Physician Name</label>
                    <input
                      className="text-input"
                      value={newSpeakerForm.owner}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, owner: e.target.value })}
                      placeholder="e.g. Dr. Priya Desai"
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="form-field">
                      <label>Target Wi-Fi SSID</label>
                      <input
                        className="text-input mono"
                        value={newSpeakerForm.wifi_ssid}
                        onChange={e => setNewSpeakerForm({ ...newSpeakerForm, wifi_ssid: e.target.value })}
                        placeholder="TFTus-WiFi"
                      />
                    </div>
                    <div className="form-field">
                      <label>Location / Room</label>
                      <input
                        className="text-input"
                        value={newSpeakerForm.site}
                        onChange={e => setNewSpeakerForm({ ...newSpeakerForm, site: e.target.value })}
                        placeholder="e.g. Room 14"
                      />
                    </div>
                  </div>
                </div>

                <div className="dialog-foot">
                  <button type="button" className="outline-btn" onClick={() => setAddModalOpen(false)}>Cancel</button>
                  <button type="submit" className="primary-btn">Register Speaker</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
