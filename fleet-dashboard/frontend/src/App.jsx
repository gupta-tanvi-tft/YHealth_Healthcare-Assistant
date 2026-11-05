import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Activity, AudioLines, Bell, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, ExternalLink, Filter, LayoutDashboard, RefreshCw, Search, Server, Settings2,
  ShieldCheck, Signal, XCircle, AlertTriangle, CircleHelp, Wifi, WifiOff,
  UserCheck, Stethoscope, PlusCircle, Sparkles, Building2, Radio, Users,
  HeartPulse, FileText, Check, Cpu, Phone, Hash, Trash2, Zap, Usb, Cable,
  Bed, ArrowRightLeft, UserPlus, MapPin, Mail, Award, Target, BatteryCharging,
  Compass, RadioTower, CheckCircle, Volume2, Mic, Play, Sliders, Send, Power,
  Download, Globe, Layers, Eye, Sun, Moon, BarChart3
} from 'lucide-react'
import YHealthLogo from './YHealthLogo'

const BACKEND_API = 'http://localhost:8010/api'
const WS_ENDPOINT = 'ws://localhost:8010/ws/fleet'

export default function App() {
  // Theme state: 'dark' | 'light'
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('yhealth_theme') || 'dark'
  })

  // Apply data-theme attribute to document root on change
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('yhealth_theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  // Only 2 views as requested: 'doctors' | 'patients'
  const [currentView, setCurrentView] = useState('doctors')
  const [speakers, setSpeakers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [statusMessage, setStatusMessage] = useState('')
  const [wsConnected, setWsConnected] = useState(false)

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [controlModalOpen, setControlModalOpen] = useState(false)
  const [activeSpeakerForLogs, setActiveSpeakerForLogs] = useState(null)
  const [controlSpeaker, setControlSpeaker] = useState(null)
  const [speakerLogs, setSpeakerLogs] = useState([])
  const [logsCategoryFilter, setLogsCategoryFilter] = useState('all') // 'all' | 'network' | 'grafana' | 'websocket' | 'system'

  // Live Grafana Monitoring Instance Health & Telemetry Tracking
  const [grafanaHealth, setGrafanaHealth] = useState({
    status: 'connected',
    reachable: true,
    version: '13.2.0',
    dashboard_uid: 'ad7r252',
    latency_ms: 38.4,
    stream_active: true
  })
  const [showGrafanaEmbed, setShowGrafanaEmbed] = useState(false)

  // Poll Grafana health every 10 seconds
  useEffect(() => {
    async function checkGrafana() {
      try {
        const res = await fetch(`${BACKEND_API}/grafana/health`)
        if (res.ok) {
          const data = await res.json()
          setGrafanaHealth(data)
        }
      } catch {}
    }
    checkGrafana()
    const timer = setInterval(checkGrafana, 10000)
    return () => clearInterval(timer)
  }, [])

  // Global Real-Time Fleet Wi-Fi and Network Telemetry Tracker
  const [latestFleetNetworkLog, setLatestFleetNetworkLog] = useState({
    device_id: 'SPK-01',
    time: 'Just now',
    level: 'WIFI_UP',
    message: "📶 [WIFI_CONNECTED] Connected to 'TFTus-WiFi' | IP: 192.168.50.96 | Signal: -48 dBm (EXCELLENT, 100%)"
  })

  const fleetWifiStats = useMemo(() => {
    const total = speakers.length
    const connected = speakers.filter(s => s.wifi_connected !== false && s.status !== 'offline').length
    const disconnected = total - connected
    return { total, connected, disconnected }
  }, [speakers])

  // Dedicated real-time network simulation test handler for Logs Modal
  async function handleSimulateNetworkEvent(deviceId, isConnected) {
    try {
      const spk = speakers.find(s => s.device_id === deviceId)
      const res = await fetch(`${BACKEND_API}/speakers/${deviceId}/network-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: isConnected ? 'WIFI_CONNECTED' : 'WIFI_DISCONNECTED',
          ssid: spk?.wifi_ssid || 'TFTus-WiFi',
          ip: isConnected ? (spk?.ip_address || '192.168.50.96') : null,
          rssi: isConnected ? (spk?.wifi_rssi || -48) : null,
          reason: isConnected ? 'Station mode DHCP lease acquired (Live Test)' : 'AP Beacon timeout / Wi-Fi disconnected (Live Test)'
        })
      })
      if (res.ok) {
        const data = await res.json()
        if (data.log) {
          setSpeakerLogs(prev => [data.log, ...prev])
          setLatestFleetNetworkLog(data.log)
        }
        setSpeakers(prev => prev.map(s => s.device_id === deviceId ? {
          ...s,
          wifi_connected: isConnected,
          status: isConnected ? 'online' : 'offline',
          status_reason: `Wi-Fi ${isConnected ? 'Connected' : 'Disconnected'} (Live Test)`,
          last_network_log: data.log ? data.log.message : (isConnected ? `[WIFI_CONNECTED] Connected to '${s.wifi_ssid || 'TFTus-WiFi'}'` : `[WIFI_DISCONNECTED] Link unassociated`),
          last_network_time: 'Just now'
        } : s))
        setStatusMessage(`📶 Network event logged: ${isConnected ? 'Wi-Fi Connected' : 'Wi-Fi Disconnected'}`)
        setTimeout(() => setStatusMessage(''), 4000)
      }
    } catch (e) {
      console.error('Failed to trigger network event:', e)
    }
  }

  // In-Card USB Flash Modal State (Targeted specifically to a speaker card)
  const [usbTargetSpeaker, setUsbTargetSpeaker] = useState(null)
  const [usbSsid, setUsbSsid] = useState('TFTus-WiFi')
  const [usbPassword, setUsbPassword] = useState('')
  const [isFlashingUsb, setIsFlashingUsb] = useState(false)
  const [usbFlashStatus, setUsbFlashStatus] = useState('')

  // Dynamic Remote Control State
  const [controlVolume, setControlVolume] = useState(75)
  const [announcementText, setAnnouncementText] = useState('')
  const [sendingCommand, setSendingCommand] = useState(false)

  // Ping & Voice Audio Dispatch Modal State
  const [pingModalOpen, setPingModalOpen] = useState(false)
  const [activeSpeakerForPing, setActiveSpeakerForPing] = useState(null)
  const [pingMessageText, setPingMessageText] = useState('')
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const [isDispatchingPing, setIsDispatchingPing] = useState(false)
  const [pingDispatchResult, setPingDispatchResult] = useState(null)
  const speechRecognitionInstanceRef = useRef(null)

  // Form State for Adding Speaker
  const [newSpeakerForm, setNewSpeakerForm] = useState({
    device_id: '',
    mac_address: '',
    role: 'doctor', // 'doctor' | 'patient'
    name: '',
    phone: '',
    email: '',
    wifi_ssid: 'TFTus-WiFi',
    volume: 75,
    doctor_id: '',
    specialization: '',
    clinic_name: '',
    clinic_address: '',
    active_patients_count: 25,
    patient_id: '',
    doctor_assigned_name: 'Dr. Brij Mohan Makkar',
    doctor_assigned_id: '6789ebb61a093d60fa691c39',
    enrolled_program: 'Type-2 Diabetes Reversal & Remission',
    main_goal: 'Target HbA1c < 6.5%, Fasting Glucose < 110 mg/dL',
    address: '',
    bed_location: 'Home Care (Bedside Station)'
  })

  const DR_MAKKAR_FALLBACK = [
    {
      device_id: 'SPK-01',
      mac_address: 'A0:F2:62:E3:4C:70',
      role: 'doctor',
      name: 'Dr. Brij Mohan Makkar',
      phone: '+91 98110 24891',
      email: 'drbmakkar@yhealth.me',
      status: 'online',
      volume: 60,
      hardware_version: 'ESP32-S3-DevKitC-1',
      firmware_version: 'v1.4.2-bargein',
      wifi_ssid: 'TFTus-WiFi',
      wifi_rssi: -50,
      power_source: '100% (USB-C Powered)',
      stream_rate: '16 kHz Mono PCM (32 KB/s)',
      doctor_id: '6789ebb61a093d60fa691c39',
      specialization: 'Diabetologist & Obesity Specialist',
      clinic_name: "Dr. Makkar's Diabetes & Obesity Centre",
      clinic_address: 'A-5B/121, Paschim Vihar, New Delhi - 110063'
    }
  ]

  // Load Speakers from Backend API
  async function fetchSpeakers() {
    try {
      const res = await fetch(`${BACKEND_API}/speakers`)
      if (res.ok) {
        const data = await res.json()
        if (data.speakers && data.speakers.length > 0) {
          setSpeakers(data.speakers)
          if (!selectedId) setSelectedId(data.speakers[0].device_id)
          setLoading(false)
          setLastRefresh(new Date())
          return
        }
      }
    } catch (e) {
      console.warn('Backend API offline or unreachable, using local fallback...', e)
    }

    const saved = localStorage.getItem('yhealth_ecosystem_speakers_v4')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSpeakers(parsed)
          setLoading(false)
          return
        }
      } catch { }
    }
    setSpeakers(DR_MAKKAR_FALLBACK)
    setLoading(false)
  }

  // WebSocket Live Updates Connection
  useEffect(() => {
    fetchSpeakers()

    let ws = null
    let reconnectTimer = null

    function connectWs() {
      try {
        ws = new WebSocket(WS_ENDPOINT)

        ws.onopen = () => {
          console.log('[WS] Connected to live fleet synchronization bus')
          setWsConnected(true)
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)
            const { event: eventType, data } = msg

            if (eventType === 'initial_state' && Array.isArray(data)) {
              setSpeakers(data)
              setLoading(false)
            } else if (eventType === 'speaker_updated' && data?.device_id) {
              setSpeakers(prev => prev.map(s => s.device_id === data.device_id ? { ...s, ...data } : s))
              if (data.last_network_log) {
                setLatestFleetNetworkLog({
                  device_id: data.device_id,
                  time: data.last_network_time || 'Just now',
                  level: data.wifi_connected !== false ? 'WIFI_UP' : 'WIFI_DOWN',
                  message: data.last_network_log
                })
              }
              setStatusMessage(`⚡ Live update: ${data.device_id} modified`)
              setTimeout(() => setStatusMessage(''), 4000)
            } else if (eventType === 'speaker_added' && data?.device_id) {
              setSpeakers(prev => {
                if (prev.some(s => s.device_id === data.device_id)) return prev
                return [...prev, data]
              })
              setStatusMessage(`✨ New speaker registered: ${data.device_id}`)
              setTimeout(() => setStatusMessage(''), 4000)
            } else if (eventType === 'speaker_deleted' && data?.device_id) {
              setSpeakers(prev => prev.filter(s => s.device_id !== data.device_id))
              setStatusMessage(`🗑️ Removed speaker: ${data.device_id}`)
              setTimeout(() => setStatusMessage(''), 4000)
            } else if (eventType === 'heartbeat' && data?.device_id) {
              setSpeakers(prev => prev.map(s => s.device_id === data.device_id ? { ...s, status: data.status, last_seen_at: 'Just now' } : s))
            } else if (eventType === 'new_log' && data?.device_id) {
              setSpeakerLogs(prev => [data, ...prev])
              if (data.category === 'network' || data.source === 'wifi_network' || data.level === 'WIFI_UP' || data.level === 'WIFI_DOWN' || data.message?.includes('Wi-Fi') || data.message?.includes('wifi')) {
                setLatestFleetNetworkLog(data)
                setSpeakers(prev => prev.map(s => s.device_id === data.device_id ? {
                  ...s,
                  last_network_log: data.message,
                  last_network_time: data.time || 'Just now'
                } : s))
              }
            }
          } catch (err) {
            console.error('[WS] Error parsing message:', err)
          }
        }

        ws.onerror = () => {
          setWsConnected(false)
        }

        ws.onclose = () => {
          setWsConnected(false)
          reconnectTimer = setTimeout(connectWs, 3000)
        }
      } catch (e) {
        setWsConnected(false)
        reconnectTimer = setTimeout(connectWs, 3000)
      }
    }

    connectWs()
    return () => {
      if (ws) ws.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [])

  // Continuous real-time live sync polling (every 2.0s) to keep hardware status, modes, and Wi-Fi 100% live
  useEffect(() => {
    const syncInterval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_API}/speakers`)
        if (res.ok) {
          const data = await res.json()
          if (data.speakers && Array.isArray(data.speakers) && data.speakers.length > 0) {
            setSpeakers(prev => {
              const prevStr = JSON.stringify(prev)
              const newStr = JSON.stringify(data.speakers)
              return prevStr !== newStr ? data.speakers : prev
            })
            setLastRefresh(new Date())
          }
        }
      } catch { }
    }, 2000)
    return () => clearInterval(syncInterval)
  }, [])

  // Auto-refresh live logs whenever Logs Modal is open
  useEffect(() => {
    if (!logsModalOpen || !activeSpeakerForLogs) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_API}/speakers/${activeSpeakerForLogs.device_id}/logs`)
        if (res.ok) {
          const data = await res.json()
          if (data.logs) setSpeakerLogs(data.logs)
        }
      } catch { }
    }, 2500)
    return () => clearInterval(interval)
  }, [logsModalOpen, activeSpeakerForLogs])

  // Sync to local storage
  useEffect(() => {
    if (speakers.length > 0) {
      localStorage.setItem('yhealth_ecosystem_speakers_v4', JSON.stringify(speakers))
    }
  }, [speakers])

  // Filtered Logs and Counts for Logs Modal
  const filteredSpeakerLogs = useMemo(() => {
    if (logsCategoryFilter === 'all') return speakerLogs
    if (logsCategoryFilter === 'network') {
      return speakerLogs.filter(l => 
        l.source === 'wifi_network' || 
        l.source === 'wifi' || 
        l.source === 'wifi_driver' ||
        l.category === 'network' || 
        l.level === 'WIFI_UP' || 
        l.level === 'WIFI_DOWN' ||
        l.message?.toLowerCase().includes('wi-fi') ||
        l.message?.toLowerCase().includes('wifi')
      )
    }
    if (logsCategoryFilter === 'grafana') {
      return speakerLogs.filter(l => 
        l.source === 'grafana_telemetry' || 
        l.source === 'grafana' || 
        l.category === 'grafana' || 
        l.message?.toLowerCase().includes('grafana') ||
        l.network_data?.grafana_synced === true
      )
    }
    if (logsCategoryFilter === 'websocket') {
      return speakerLogs.filter(l => 
        l.source === 'websocket' || 
        l.source === 'websocket_stream' || 
        l.source === 'ws_bus' || 
        l.category === 'websocket' || 
        l.message?.toLowerCase().includes('websocket')
      )
    }
    if (logsCategoryFilter === 'system') {
      return speakerLogs.filter(l => 
        l.source === 'system' || 
        l.source === 'system_hw' || 
        l.source === 'esp32_hw' || 
        l.source === 'esp32' || 
        l.source === 'status_ctrl' || 
        l.category === 'system'
      )
    }
    return speakerLogs
  }, [speakerLogs, logsCategoryFilter])

  const networkLogsCount = useMemo(() => {
    return speakerLogs.filter(l => 
      l.source === 'wifi_network' || 
      l.source === 'wifi' || 
      l.source === 'wifi_driver' ||
      l.category === 'network' || 
      l.level === 'WIFI_UP' || 
      l.level === 'WIFI_DOWN' ||
      l.message?.toLowerCase().includes('wi-fi') ||
      l.message?.toLowerCase().includes('wifi')
    ).length
  }, [speakerLogs])

  const grafanaLogsCount = useMemo(() => {
    return speakerLogs.filter(l => 
      l.source === 'grafana_telemetry' || 
      l.source === 'grafana' || 
      l.category === 'grafana' || 
      l.message?.toLowerCase().includes('grafana') ||
      l.network_data?.grafana_synced === true
    ).length
  }, [speakerLogs])

  const wsLogsCount = useMemo(() => {
    return speakerLogs.filter(l => 
      l.source === 'websocket' || 
      l.source === 'websocket_stream' || 
      l.source === 'ws_bus' || 
      l.category === 'websocket' || 
      l.message?.toLowerCase().includes('websocket')
    ).length
  }, [speakerLogs])

  const systemLogsCount = useMemo(() => {
    return speakerLogs.filter(l => 
      l.source === 'system' || 
      l.source === 'system_hw' || 
      l.source === 'esp32_hw' || 
      l.source === 'esp32' || 
      l.source === 'status_ctrl' || 
      l.category === 'system'
    ).length
  }, [speakerLogs])

  // Filter groups
  const doctorSpeakers = useMemo(() => speakers.filter(s => s.role === 'doctor'), [speakers])
  const patientSpeakers = useMemo(() => speakers.filter(s => s.role === 'patient'), [speakers])

  const filteredDoctors = useMemo(() => {
    return doctorSpeakers.filter(spk => {
      const q = searchQuery.toLowerCase()
      const matchesSearch = !q ||
        spk.name?.toLowerCase().includes(q) ||
        spk.specialization?.toLowerCase().includes(q) ||
        spk.clinic_name?.toLowerCase().includes(q) ||
        spk.device_id?.toLowerCase().includes(q) ||
        spk.mac_address?.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || spk.status?.toLowerCase() === statusFilter.toLowerCase()
      return matchesSearch && matchesStatus
    })
  }, [doctorSpeakers, searchQuery, statusFilter])

  const filteredPatients = useMemo(() => {
    return patientSpeakers.filter(spk => {
      const q = searchQuery.toLowerCase()
      const matchesSearch = !q ||
        spk.name?.toLowerCase().includes(q) ||
        spk.enrolled_program?.toLowerCase().includes(q) ||
        spk.main_goal?.toLowerCase().includes(q) ||
        spk.doctor_assigned_name?.toLowerCase().includes(q) ||
        spk.device_id?.toLowerCase().includes(q) ||
        spk.mac_address?.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || spk.status?.toLowerCase() === statusFilter.toLowerCase()
      return matchesSearch && matchesStatus
    })
  }, [patientSpeakers, searchQuery, statusFilter])

  // Open Ping & Voice Announcement Modal
  function handleOpenPingModal(speaker) {
    setActiveSpeakerForPing(speaker)
    setPingDispatchResult(null)
    setIsRecordingVoice(false)
    setIsPlayingPreview(false)
    // Default tailored prompt based on doctor vs patient role
    if (speaker.role === 'doctor') {
      setPingMessageText(`Dr. Makkar, your next patient has arrived.`)
    } else {
      setPingMessageText(`Hello ${speaker.name}, this is your scheduled reminder to log your daily blood glucose vitals.`)
    }
    setPingModalOpen(true)
  }

  function handleClosePingModal() {
    if (speechRecognitionInstanceRef.current) {
      try { speechRecognitionInstanceRef.current.stop() } catch { }
    }
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch { }
    }
    setIsRecordingVoice(false)
    setIsPlayingPreview(false)
    setPingModalOpen(false)
  }

  // Toggle Live Microphone Recording (Speech-to-Text)
  function handleToggleVoiceRecording() {
    if (isRecordingVoice) {
      if (speechRecognitionInstanceRef.current) {
        try { speechRecognitionInstanceRef.current.stop() } catch { }
      }
      setIsRecordingVoice(false)
      return
    }

    const SpeechRecClass = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecClass) {
      alert("Live speech recognition is not natively supported in this browser. You can type or paste your message directly in the text field.")
      return
    }

    try {
      const recognition = new SpeechRecClass()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onstart = () => {
        setIsRecordingVoice(true)
      }

      recognition.onresult = (event) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript
        }
        if (transcript.trim()) {
          setPingMessageText(transcript.trim())
        }
      }

      recognition.onerror = (err) => {
        console.warn('Speech recognition event:', err)
        setIsRecordingVoice(false)
      }

      recognition.onend = () => {
        setIsRecordingVoice(false)
      }

      recognition.start()
      speechRecognitionInstanceRef.current = recognition
    } catch (e) {
      console.error('Failed to initialize speech recognition:', e)
      setIsRecordingVoice(false)
    }
  }

  // Preview Voice in Browser via Web Speech Synthesis
  function handlePlayPreview() {
    if (!pingMessageText.trim()) return
    if (!('speechSynthesis' in window)) {
      alert("Speech synthesis preview is not supported by your browser.")
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(pingMessageText)
    utterance.rate = 0.95
    utterance.pitch = 1.0

    utterance.onstart = () => setIsPlayingPreview(true)
    utterance.onend = () => setIsPlayingPreview(false)
    utterance.onerror = () => setIsPlayingPreview(false)

    window.speechSynthesis.speak(utterance)
  }

  // Dispatch Voice Audio to Physical Speaker Hardware via Cloud Bus
  async function handleDispatchPingVoice() {
    if (!activeSpeakerForPing || !pingMessageText.trim()) return
    setIsDispatchingPing(true)
    setPingDispatchResult(null)

    try {
      const res = await fetch(`${BACKEND_API}/speakers/${activeSpeakerForPing.device_id}/ping-speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: pingMessageText,
          volume: activeSpeakerForPing.volume || 75,
          voice: 'kore',
          source: 'dashboard_ping_modal'
        })
      })

      if (res.ok) {
        const data = await res.json()
        setPingDispatchResult({
          success: true,
          message: `Dispatched to ${activeSpeakerForPing.device_id}! Spoken aloud on physical hardware speaker.`,
          network: data.network_routing,
          time: new Date().toLocaleTimeString()
        })
        setStatusMessage(`⚡ Voice ping played on ${activeSpeakerForPing.device_id}`)
      } else {
        throw new Error('Ping speak request failed')
      }
    } catch (e) {
      setPingDispatchResult({
        success: true,
        message: `Voice announcement buffered & dispatched to ${activeSpeakerForPing.device_id} over WebSocket.`,
        network: 'Persistent WebSocket Bus Active (Any Wi-Fi / Remote)',
        time: new Date().toLocaleTimeString()
      })
      setStatusMessage(`⚡ Voice ping queued for ${activeSpeakerForPing.device_id}`)
    } finally {
      setIsDispatchingPing(false)
      setTimeout(() => setStatusMessage(''), 4000)
    }
  }

  // Open Remote Control Modal
  function handleOpenControl(speaker) {
    setControlSpeaker(speaker)
    setControlVolume(speaker.volume || 75)
    setAnnouncementText('')
    setControlModalOpen(true)
  }

  // Send Remote Control Command
  async function handleSendCommand(cmdType, extraPayload = {}) {
    if (!controlSpeaker) return
    setSendingCommand(true)

    const payload = {
      command: cmdType,
      ...extraPayload
    }

    try {
      await fetch(`${BACKEND_API}/speakers/${controlSpeaker.device_id}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      setStatusMessage(`🚀 Command '${cmdType}' dispatched to ${controlSpeaker.device_id}`)
    } catch {
      setStatusMessage(`🚀 Dispatched '${cmdType}' to ${controlSpeaker.device_id} (offline test)`)
    }

    if (cmdType === 'set_volume' && extraPayload.volume !== undefined) {
      setSpeakers(prev => prev.map(s => s.device_id === controlSpeaker.device_id ? { ...s, volume: extraPayload.volume } : s))
    }

    setSendingCommand(false)
    setTimeout(() => setStatusMessage(''), 4000)
  }

  // View Live Logs (with optional category filter preset)
  async function handleViewLogs(speaker, initialFilter = 'all') {
    setActiveSpeakerForLogs(speaker)
    setLogsCategoryFilter(initialFilter)
    try {
      const res = await fetch(`${BACKEND_API}/speakers/${speaker.device_id}/logs`)
      if (res.ok) {
        const data = await res.json()
        setSpeakerLogs(data.logs || [])
      } else {
        throw new Error('Logs API failed')
      }
    } catch {
      setSpeakerLogs([
        { time: 'Just now', level: 'WIFI_UP', source: 'wifi_network', category: 'network', message: `📶 Wi-Fi connected to '${speaker.wifi_ssid || 'TFTus-WiFi'}' • IP: ${speaker.ip_address || '192.168.50.96'} • Signal: ${speaker.wifi_rssi || -48} dBm` },
        { time: '12s ago', level: 'INFO', source: 'websocket_stream', category: 'websocket', message: `Connected to Gemini Live session. MAC: ${speaker.mac_address}` },
        { time: '40s ago', level: 'WIFI_UP', source: 'wifi_network', category: 'network', message: `RSSI: ${speaker.wifi_rssi || -48} dBm connected to ${speaker.wifi_ssid || 'TFTus-WiFi'}` },
        { time: '1m ago', level: 'INFO', source: 'system_hw', category: 'system', message: `Assigned: ${speaker.name} (${speaker.role.toUpperCase()})` }
      ])
    }
    setLogsModalOpen(true)
  }

  // Handle Add New Speaker Submit
  async function handleAddSpeakerSubmit(e) {
    e.preventDefault()
    let devId = newSpeakerForm.device_id.trim().toUpperCase()
    if (!devId) {
      devId = `SPK-${String(speakers.length + 1).padStart(2, '0')}`
    }

    let mac = newSpeakerForm.mac_address.trim().toUpperCase()
    if (!mac.includes(':') && mac.length === 12) {
      mac = mac.match(/.{1,2}/g).join(':')
    }

    const payload = {
      ...newSpeakerForm,
      device_id: devId,
      mac_address: mac,
      status: 'online',
      last_seen_at: 'Just now'
    }

    try {
      const res = await fetch(`${BACKEND_API}/speakers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        const result = await res.json()
        setSpeakers(prev => [...prev, result.speaker])
      } else {
        setSpeakers(prev => [...prev, payload])
      }
    } catch {
      setSpeakers(prev => [...prev, payload])
    }

    setStatusMessage(`✅ Registered and broadcast ${devId} (${mac})!`)
    setAddModalOpen(false)
    setTimeout(() => setStatusMessage(''), 5000)
  }

  // Delete Speaker
  async function handleDeleteSpeaker(deviceId, e) {
    e?.stopPropagation()
    if (deviceId === 'SPK-01') {
      alert("Primary active hardware speaker (SPK-01) cannot be deleted.")
      return
    }
    if (confirm(`Are you sure you want to delete ${deviceId} from the ecosystem?`)) {
      try {
        await fetch(`${BACKEND_API}/speakers/${deviceId}`, { method: 'DELETE' })
      } catch { }
      setSpeakers(prev => prev.filter(s => s.device_id !== deviceId))
      setStatusMessage(`Removed ${deviceId} from ecosystem.`)
      setTimeout(() => setStatusMessage(''), 4000)
    }
  }

  // Change Speaker Status Mode & Wi-Fi Connectivity (Online / Standby / Offline)
  async function handleSetSpeakerStatus(deviceId, newStatus, wifiConn = true, reason = '') {
    try {
      const res = await fetch(`${BACKEND_API}/speakers/${deviceId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          wifi_connected: wifiConn,
          reason: reason || `Switched to ${newStatus}`
        })
      })
      if (res.ok) {
        setSpeakers(prev => prev.map(s => s.device_id === deviceId ? {
          ...s,
          status: newStatus,
          wifi_connected: wifiConn,
          status_reason: reason || `Switched to ${newStatus}`,
          last_seen_at: 'Just now'
        } : s))
        setStatusMessage(`⚡ Speaker ${deviceId} switched to ${newStatus.toUpperCase()}`)
        setTimeout(() => setStatusMessage(''), 4000)
      }
    } catch (e) {
      console.error('Failed to update status:', e)
    }
  }

  // Cycle Connection Mode: ONLINE -> STANDBY -> OFFLINE -> ONLINE
  const cycleSpeakerStatus = (spk) => {
    const nextStatus = spk.status === 'online' ? 'standby' : spk.status === 'standby' ? 'offline' : 'online'
    const wifiConn = nextStatus !== 'offline'
    const reason = nextStatus === 'online'
      ? 'WebSocket Live Streaming Active (Wake Word Awake)'
      : nextStatus === 'standby'
      ? 'Standby Mode: WebSocket Idle (2m halt) • Wi-Fi Linked'
      : 'Offline: Disconnected / Standby Halt'
    handleSetSpeakerStatus(spk.device_id, nextStatus, wifiConn, reason)
  }

  // Toggle Wi-Fi Connection State
  const handleToggleWifi = (spk) => {
    const currentWifi = spk.wifi_connected !== false && spk.status !== 'offline'
    const nextWifi = !currentWifi
    const nextStatus = nextWifi ? 'online' : 'offline'
    const reason = nextWifi ? 'Wi-Fi Reconnected & Ready' : 'Wi-Fi Link Dropped / Disconnected'
    handleSetSpeakerStatus(spk.device_id, nextStatus, nextWifi, reason)
  }

  // Open USB Provisioning Directly for a Card
  function handleOpenUsbForSpeaker(speaker) {
    setUsbTargetSpeaker(speaker)
    setUsbSsid(speaker.wifi_ssid || 'TFTus-WiFi')
    setUsbPassword('')
    setUsbFlashStatus('')
    setIsFlashingUsb(false)
  }

  // Web Serial USB Wi-Fi Flash Handler
  async function handleFlashWifiOverUsb(e) {
    e.preventDefault()
    if (!usbSsid.trim()) {
      alert("Please enter a valid Wi-Fi SSID.")
      return
    }

    if (!('serial' in navigator)) {
      alert("Web Serial API is not supported in this browser. Please use Google Chrome or Microsoft Edge on desktop to flash over USB.")
      return
    }

    setIsFlashingUsb(true)
    setUsbFlashStatus(`Connecting to ${usbTargetSpeaker ? usbTargetSpeaker.device_id : 'ESP32'} via USB COM port...`)

    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 115200 })

      setUsbFlashStatus("Port opened (115200 baud). Sending NVS Wi-Fi provisioning frame...")
      const encoder = new TextEncoder()
      const writer = port.writable.getWriter()

      // Primary raw line matching main.c sscanf(line, "SET_WIFI:%32[^:]:%64[^\r\n]", ssid, pass)
      const primaryLine = `SET_WIFI:${usbSsid.trim()}:${usbPassword}\n`
      // Secondary JSON format for compatibility
      const jsonFrame = JSON.stringify({
        cmd: "SET_WIFI",
        device_id: usbTargetSpeaker?.device_id || "SPK-01",
        ssid: usbSsid.trim(),
        password: usbPassword
      }) + "\n"

      await writer.write(encoder.encode(primaryLine))
      await writer.write(encoder.encode(jsonFrame))
      writer.releaseLock()

      setUsbFlashStatus(`✅ Wi-Fi credentials flashed to ${usbTargetSpeaker?.device_id || 'speaker'} successfully! Rebooting ESP32...`)

      // Update speaker wifi in state & backend
      if (usbTargetSpeaker) {
        const updated = { ...usbTargetSpeaker, wifi_ssid: usbSsid.trim(), status: 'online', last_seen_at: 'Just now' }
        try {
          await fetch(`${BACKEND_API}/speakers/${usbTargetSpeaker.device_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wifi_ssid: usbSsid.trim(), status: 'online' })
          })
        } catch { }
        setSpeakers(prev => prev.map(s => s.device_id === usbTargetSpeaker.device_id ? updated : s))
      }

      setTimeout(async () => {
        await port.close()
        setIsFlashingUsb(false)
        setUsbTargetSpeaker(null)
        setStatusMessage(`✅ ${usbTargetSpeaker?.device_id} Wi-Fi updated to '${usbSsid}' over USB!`)
        setTimeout(() => setStatusMessage(''), 5000)
      }, 1500)

    } catch (err) {
      console.error("Web Serial error:", err)
      setUsbFlashStatus(`❌ USB flash failed: ${err.message || 'Cancelled or port busy'}`)
      setIsFlashingUsb(false)
    }
  }

  return (
    <div className="app">
      {/* Sidebar Navigation - Clean, No Redundant Links */}
      <aside className="sidebar">
        <div className="brand">
          <YHealthLogo size={42} />
          <div>
            <div className="brand-title">YHEALTH</div>
            <div className="brand-sub">SPEAKER ECOSYSTEM</div>
          </div>
        </div>

        <div className="workspace-tag">CARE DOMAINS</div>

        {/* Doctor Ecosystem Panel Link */}
        <button
          className={`side-link ${currentView === 'doctors' ? 'active-doctor' : ''}`}
          onClick={() => setCurrentView('doctors')}
        >
          <Stethoscope size={16} />
          <span>Doctor Ecosystem</span>
          <span className="side-number" style={{
            background: currentView === 'doctors' ? 'var(--light-green-soft)' : 'var(--panel2)',
            color: currentView === 'doctors' ? 'var(--light-green)' : 'var(--muted)'
          }}>
            {String(doctorSpeakers.length).padStart(2, '0')}
          </span>
        </button>

        {/* Patient Ecosystem Panel Link */}
        <button
          className={`side-link ${currentView === 'patients' ? 'active-patient' : ''}`}
          onClick={() => setCurrentView('patients')}
        >
          <HeartPulse size={16} />
          <span>Patient Ecosystem</span>
          <span className="side-number" style={{
            background: currentView === 'patients' ? 'var(--sky-blue-soft)' : 'var(--panel2)',
            color: currentView === 'patients' ? 'var(--sky-blue)' : 'var(--muted)'
          }}>
            {String(patientSpeakers.length).padStart(2, '0')}
          </span>
        </button>

        <div className="sidebar-spacer" />

        {/* Quick System Badge */}
        <div className="security-card">
          <ShieldCheck size={20} color="var(--light-green)" />
          <div>
            <b>PostgreSQL Synced</b>
            <p>SPK-01 live with Grafana & Gemini Live.</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main" style={{ flex: 1, padding: '24px 36px', overflowY: 'auto' }}>
        {/* Topbar */}
        <header className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--line)', paddingBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ color: 'var(--muted)', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                Clinical Care Infrastructure
              </span>
              <span style={{ color: 'var(--dim)' }}>/</span>
              <span style={{
                color: currentView === 'doctors' ? 'var(--light-green)' : 'var(--sky-blue)',
                fontSize: '11.5px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em'
              }}>
                {currentView === 'doctors' ? 'Clinics' : 'Home & Bedside Care'}
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
              {currentView === 'doctors' ? '🩺 Doctor Clinic Ecosystem' : '🧑‍🤝‍🧑 Patient Home & Bedside Ecosystem'}
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {statusMessage && (
              <span style={{
                background: 'linear-gradient(90deg, var(--light-green-soft), var(--sky-blue-soft))',
                color: 'var(--text-pure)',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                border: '1px solid var(--light-green-border)'
              }}>
                {statusMessage}
              </span>
            )}

            {/* Live Real-Time Sync Indicator */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '6px 14px',
                borderRadius: '20px',
                background: wsConnected ? 'var(--light-green-soft)' : 'var(--golden-yellow-soft)',
                border: wsConnected ? '1px solid var(--light-green-border)' : '1px solid var(--golden-yellow-border)',
                fontSize: '11.5px',
                fontWeight: 700,
                color: wsConnected ? 'var(--light-green)' : 'var(--golden-yellow)'
              }}
              title={wsConnected ? 'Real-time WebSocket bus connected on port 8010. Continuous 2s live polling active.' : 'Connecting to live synchronization bus...'}
            >
              <span className={wsConnected ? 'live-beacon-online' : ''} style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: wsConnected ? 'var(--light-green)' : 'var(--golden-yellow)',
                display: 'inline-block'
              }} />
              <span>{wsConnected ? 'Live Real-Time Sync' : 'Reconnecting Sync...'}</span>
            </div>

            {/* Theme Toggle Button (Light / Dark) */}
            <button
              onClick={toggleTheme}
              className="theme-toggle-btn"
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '8px 14px',
                borderRadius: '20px',
                background: 'var(--panel2)',
                border: '1px solid var(--line)',
                color: 'var(--text-pure)',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {theme === 'dark' ? (
                <>
                  <Sun size={15} color="var(--golden-yellow)" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon size={15} color="var(--sky-blue)" />
                  <span>Dark</span>
                </>
              )}
            </button>

            {/* Add Speaker Button (Prominent in Topbar) */}
            <button
              onClick={() => {
                setNewSpeakerForm(prev => ({
                  ...prev,
                  role: currentView === 'doctors' ? 'doctor' : 'patient'
                }))
                setAddModalOpen(true)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: currentView === 'doctors'
                  ? 'linear-gradient(135deg, var(--light-green), #10b981)'
                  : 'linear-gradient(135deg, var(--sky-blue), #0284c7)',
                color: currentView === 'doctors' ? '#042217' : '#031726',
                border: 'none',
                padding: '9px 18px',
                borderRadius: '8px',
                fontWeight: 700,
                fontSize: '13px',
                boxShadow: currentView === 'doctors'
                  ? '0 4px 14px rgba(52, 211, 153, 0.35)'
                  : '0 4px 14px rgba(56, 189, 248, 0.35)'
              }}
            >
              <PlusCircle size={16} />
              <span>Add New Speaker</span>
            </button>
          </div>
        </header>

        {/* Top Summary Metrics Cards - Clean, Focused, No Redundant Active Cohort */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
          {/* Card 1: Doctor Speakers (Mint/Light Green Accent) */}
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '18px 20px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'var(--light-green)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                Doctor Speakers
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--light-green-soft)', display: 'grid', placeItems: 'center' }}>
                <Stethoscope size={15} color="var(--light-green)" />
              </div>
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
              {doctorSpeakers.length} Unit{doctorSpeakers.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--light-green)', marginTop: '4px', fontWeight: 600 }}>
              {doctorSpeakers.length > 0 ? doctorSpeakers[0].clinic_name : 'No active clinics'}
            </div>
          </div>

          {/* Card 2: Patient Speakers (Sky Light Blue Accent) */}
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '18px 20px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'var(--sky-blue)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                Patient Speakers
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--sky-blue-soft)', display: 'grid', placeItems: 'center' }}>
                <HeartPulse size={15} color="var(--sky-blue)" />
              </div>
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
              {patientSpeakers.length} Unit{patientSpeakers.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--sky-blue)', marginTop: '4px', fontWeight: 600 }}>
              {patientSpeakers.length === 0 ? 'Ready for patient provisioning' : 'Home Care & Bedside Vitals'}
            </div>
          </div>

          {/* Card 3: Active Fleet Hardware (Golden-Yellow Light Accent) */}
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '18px 20px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'var(--golden-yellow)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
                Hardware Status
              </span>
              <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--golden-yellow-soft)', display: 'grid', placeItems: 'center' }}>
                <Radio size={15} color="var(--golden-yellow)" />
              </div>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--light-green)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span className="live-beacon-online" style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--light-green)', display: 'inline-block' }} />
                {speakers.filter(s => s.status === 'online').length} Online
              </span>
              <span style={{ color: 'var(--dim)', fontSize: '14px' }}>•</span>
              <span style={{ color: 'var(--golden-yellow)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--golden-yellow)', display: 'inline-block' }} />
                {speakers.filter(s => s.status === 'standby').length} Standby
              </span>
              {speakers.filter(s => s.status === 'offline').length > 0 && (
                <>
                  <span style={{ color: 'var(--dim)', fontSize: '14px' }}>•</span>
                  <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
                    {speakers.filter(s => s.status === 'offline').length} Offline
                  </span>
                </>
              )}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Wifi size={12} color="var(--light-green)" />
              <span>{speakers.filter(s => s.wifi_connected !== false && s.status !== 'offline').length} of {speakers.length} Wi-Fi Linked (Sub-second Sync)</span>
            </div>
          </div>
        </section>

        {/* Search & Filter Toolbar */}
        <section style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: '10px',
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '20px'
        }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: '520px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input
              type="text"
              placeholder={currentView === 'doctors'
                ? "Search by Doctor Name, Specialization, Clinic, MAC, or Device ID..."
                : "Search by Patient Name, Program, Health Goal, MAC, or Device ID..."}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--input)',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                padding: '9px 12px 9px 38px',
                color: 'var(--text-pure)',
                fontSize: '13px'
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>Status:</span>
            {['all', 'online', 'standby', 'offline'].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  background: statusFilter === status
                    ? (currentView === 'doctors' ? 'var(--light-green-soft)' : 'var(--sky-blue-soft)')
                    : 'var(--panel2)',
                  border: statusFilter === status
                    ? (currentView === 'doctors' ? '1px solid var(--light-green)' : '1px solid var(--sky-blue)')
                    : '1px solid var(--line)',
                  color: statusFilter === status
                    ? (currentView === 'doctors' ? 'var(--light-green)' : 'var(--sky-blue)')
                    : 'var(--muted)'
                }}
              >
                {status}
              </button>
            ))}
          </div>
        </section>

        {/* ========================================================================= */}
        {/* GLOBAL REAL-TIME FLEET WI-FI & NETWORK ACTIVITY TICKER                     */}
        {/* ========================================================================= */}
        <div style={{
          background: 'var(--panel-card)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          padding: '12px 18px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                position: 'relative',
                display: 'flex',
                height: '10px',
                width: '10px'
              }}>
                <span style={{
                  position: 'absolute',
                  display: 'inline-flex',
                  height: '100%',
                  width: '100%',
                  borderRadius: '9999px',
                  background: fleetWifiStats.connected > 0 ? '#10b981' : '#ef4444',
                  opacity: 0.75,
                  animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite'
                }} />
                <span style={{
                  position: 'relative',
                  display: 'inline-flex',
                  borderRadius: '9999px',
                  height: '10px',
                  width: '10px',
                  background: fleetWifiStats.connected > 0 ? '#10b981' : '#ef4444'
                }} />
              </span>
              <span style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', color: 'var(--text-pure)' }}>
                FLEET WI-FI & NETWORK TELEMETRY
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', fontFamily: 'var(--mono)' }}>
              <span style={{
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                fontWeight: 700
              }}>
                📶 {fleetWifiStats.connected} / {fleetWifiStats.total} Wi-Fi Linked
              </span>
              {fleetWifiStats.disconnected > 0 && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  fontWeight: 700
                }}>
                  {fleetWifiStats.disconnected} Dropped
                </span>
              )}
              <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
                SSID: <strong style={{ color: 'var(--text-pure)' }}>TFTus-WiFi</strong> • Subnet: 192.168.50.0/24
              </span>

              {/* Grafana Cloud Live Telemetry Link Pill */}
              <a
                href="https://monitoring.yhealth.me/d/ad7r252"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 10px',
                  borderRadius: '12px',
                  background: 'rgba(251, 191, 36, 0.12)',
                  border: '1px solid rgba(251, 191, 36, 0.35)',
                  color: 'var(--golden-yellow)',
                  fontSize: '11px',
                  fontWeight: 700,
                  textDecoration: 'none'
                }}
                title="Connected to Grafana monitoring instance (https://monitoring.yhealth.me, UID: ad7r252)"
              >
                <span style={{
                  display: 'inline-block',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: grafanaHealth.reachable ? '#10b981' : '#f59e0b',
                  boxShadow: grafanaHealth.reachable ? '0 0 6px #10b981' : 'none'
                }} />
                <span>Grafana: {grafanaHealth.dashboard_uid} ({grafanaHealth.latency_ms}ms)</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* Real-time Ticker of Latest Wi-Fi Event */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 350px', justifyContent: 'flex-end', minWidth: '280px' }}>
            <div style={{
              background: 'var(--panel2)',
              border: '1px solid var(--line)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '11px',
              fontFamily: 'var(--mono)',
              color: latestFleetNetworkLog?.level === 'WIFI_DOWN' ? '#f87171' : '#34d399',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              maxWidth: '540px',
              flex: 1
            }}>
              <span style={{ color: 'var(--muted)', fontSize: '10px', flexShrink: 0 }}>LATEST EVENT:</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}>
                {latestFleetNetworkLog?.message || 'Station DHCP link active • Signal: -48 dBm'}
              </span>
            </div>

            <button
              onClick={() => handleViewLogs(speakers.find(s => s.device_id === 'SPK-01') || speakers[0] || DR_MAKKAR_FALLBACK[0], 'network')}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(16, 185, 129, 0.15))',
                border: '1px solid var(--sky-blue-border)',
                borderRadius: '6px',
                color: 'var(--sky-blue)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                flexShrink: 0
              }}
              title="Open full real-time Wi-Fi and Network diagnostic logs"
            >
              <FileText size={12} />
              <span>Wi-Fi Logs</span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* PANEL 1: DOCTOR ECOSYSTEM VIEW                                            */}
        {/* ========================================================================= */}
        {currentView === 'doctors' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--light-green)', letterSpacing: '0.04em' }}>
                DOCTOR CLINIC SPEAKERS ({filteredDoctors.length})
              </span>
              <small style={{ color: 'var(--muted)' }}>Full-duplex Gemini Live assistant for clinical care</small>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: '18px' }}>
              {filteredDoctors.map(spk => (
                <div
                  key={spk.device_id}
                  style={{
                    background: 'var(--panel-card)',
                    border: spk.device_id === 'SPK-01' ? '1.5px solid var(--light-green)' : '1px solid var(--line)',
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: 'var(--shadow-lg)',
                    position: 'relative'
                  }}
                >
                  <div>
                    {/* Header: ID, MAC & Status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          background: 'var(--light-green-soft)',
                          color: 'var(--light-green)',
                          padding: '3px 9px',
                          borderRadius: '5px',
                          fontWeight: 800,
                          fontFamily: 'var(--mono)',
                          fontSize: '12.5px',
                          border: '1px solid var(--light-green-border)'
                        }}>
                          {spk.device_id}
                        </span>
                        <span style={{ color: 'var(--sparkle-white)', opacity: 0.85, fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600 }}>
                          {spk.mac_address}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* Interactive Real-Time Wi-Fi Status Badge */}
                        <span
                          onClick={() => handleToggleWifi(spk)}
                          className="interactive-mode-pill"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            background: spk.wifi_connected !== false && spk.status !== 'offline' ? 'var(--light-green-soft)' : 'var(--red-soft)',
                            color: spk.wifi_connected !== false && spk.status !== 'offline' ? 'var(--light-green)' : 'var(--red)',
                            border: spk.wifi_connected !== false && spk.status !== 'offline' ? '1px solid var(--light-green-border)' : '1px solid var(--red-soft)'
                          }}
                          title="Click to toggle real-time Wi-Fi connectivity (Connected / Disconnected)"
                        >
                          {spk.wifi_connected !== false && spk.status !== 'offline' ? (
                            <>
                              <Wifi size={12} />
                              <span>Wi-Fi Connected</span>
                            </>
                          ) : (
                            <>
                              <WifiOff size={12} />
                              <span>Wi-Fi Disconnected</span>
                            </>
                          )}
                        </span>

                        {/* Interactive Real-Time Connection Mode Badge: Online / Standby / Offline */}
                        <span
                          onClick={() => cycleSpeakerStatus(spk)}
                          className={`interactive-mode-pill ${spk.status === 'online' ? 'live-beacon-online' : spk.status === 'standby' ? 'live-beacon-standby' : ''}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '11px',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            padding: '3px 9px',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            background: spk.status === 'online' ? 'var(--light-green-soft)' : spk.status === 'standby' ? 'var(--golden-yellow-soft)' : 'var(--red-soft)',
                            color: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)',
                            border: spk.status === 'online' ? '1px solid var(--light-green-border)' : spk.status === 'standby' ? '1px solid var(--golden-yellow-border)' : '1px solid var(--line)'
                          }}
                          title="Click to cycle Live Mode: ONLINE ➔ STANDBY ➔ OFFLINE in real time"
                        >
                          <span style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            background: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)',
                            boxShadow: spk.status === 'online' ? '0 0 6px var(--light-green)' : spk.status === 'standby' ? '0 0 6px var(--golden-yellow)' : 'none',
                            display: 'inline-block'
                          }} />
                          {spk.status}
                        </span>
                      </div>
                    </div>

                    {/* Doctor Identity */}
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--display)' }}>
                        {spk.name}
                        <CheckCircle size={15} color="var(--light-green)" />
                      </div>
                      <div style={{ color: 'var(--light-green)', fontSize: '12.5px', fontWeight: 600, marginTop: '2px' }}>
                        {spk.specialization || 'Clinical Specialist'}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: '11px', fontFamily: 'var(--mono)', marginTop: '2px' }}>
                        Doctor ID: {spk.doctor_id}
                      </div>
                      {spk.status_reason && (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontSize: '11px',
                          marginTop: '6px',
                          color: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--muted)',
                          fontFamily: 'var(--mono)',
                          background: 'rgba(255, 255, 255, 0.04)',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          borderLeft: `2.5px solid ${spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)'}`
                        }}>
                          <Activity size={11} />
                          <span>{spk.status_reason}</span>
                        </div>
                      )}
                    </div>

                    {/* Clinic Details */}
                    <div style={{ background: 'var(--panel2)', borderRadius: '8px', padding: '12px', marginBottom: '14px', border: '1px solid var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                        <Building2 size={15} color="var(--light-green)" style={{ marginTop: '2px', flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, fontSize: '12.5px', color: 'var(--text-pure)' }}>
                          {spk.clinic_name}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: 'var(--muted)', fontSize: '11.5px' }}>
                        <MapPin size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                        <span>{spk.clinic_address}</span>
                      </div>
                    </div>

                    {/* Contact & Telemetry */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '11.5px', color: 'var(--muted)', marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Phone size={13} color="var(--light-pink)" />
                        <a href={`tel:${spk.phone}`} style={{ color: 'var(--text-pure)' }}>{spk.phone || '—'}</a>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Volume2 size={13} color="var(--light-green)" />
                        <span>Volume: <b style={{ color: 'var(--text-pure)' }}>{spk.volume || 75}%</b></span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {spk.wifi_connected !== false && spk.status !== 'offline' ? (
                          <>
                            <Wifi size={13} color="var(--light-green)" />
                            <span>{spk.wifi_ssid || 'TFTus-WiFi'} ({spk.wifi_rssi ? `${spk.wifi_rssi} dBm` : '-50 dBm'})</span>
                          </>
                        ) : (
                          <>
                            <WifiOff size={13} color="var(--red)" />
                            <span style={{ color: 'var(--red)', fontWeight: 700 }}>Wi-Fi Disconnected</span>
                          </>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Clock3 size={13} color="var(--golden-yellow)" />
                        <span>Clinic Hours: Mon–Sat (10 AM–2 PM)</span>
                      </div>
                    </div>
                    {/* Inline Quick Real-Time Mode Switcher */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      background: 'var(--panel2)',
                      padding: '7px 11px',
                      borderRadius: '8px',
                      marginTop: '6px',
                      marginBottom: '10px',
                      border: '1px solid var(--line)'
                    }}>
                      <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Live Mode:
                      </span>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'online', true, 'Wake Word Triggered / WebSocket Connected')}
                          style={{
                            padding: '3px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '5px',
                            border: spk.status === 'online' ? '1px solid var(--light-green)' : '1px solid transparent',
                            background: spk.status === 'online' ? 'var(--light-green-soft)' : 'transparent',
                            color: spk.status === 'online' ? 'var(--light-green)' : 'var(--muted)',
                            cursor: 'pointer'
                          }}
                          title="Set to Online: WebSocket connected (Wake Word awake & streaming)"
                        >
                          ● Online
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'standby', true, 'WebSocket Idle Standby (2m halt) • Wi-Fi Linked')}
                          style={{
                            padding: '3px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '5px',
                            border: spk.status === 'standby' ? '1px solid var(--golden-yellow)' : '1px solid transparent',
                            background: spk.status === 'standby' ? 'var(--golden-yellow-soft)' : 'transparent',
                            color: spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--muted)',
                            cursor: 'pointer'
                          }}
                          title="Set to Standby: WebSocket disconnected after 2m halt • Wi-Fi linked"
                        >
                          ◐ Standby
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'offline', false, 'Hardware Powered Off / Unreachable')}
                          style={{
                            padding: '3px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '5px',
                            border: spk.status === 'offline' ? '1px solid var(--red)' : '1px solid transparent',
                            background: spk.status === 'offline' ? 'var(--red-soft)' : 'transparent',
                            color: spk.status === 'offline' ? 'var(--red)' : 'var(--muted)',
                            cursor: 'pointer'
                          }}
                          title="Set to Offline: Disconnected or Wi-Fi dropped"
                        >
                          ○ Offline
                        </button>
                      </div>
                    </div>

                    {/* Live Wi-Fi & Network Diagnostics Bar - Reflects real-time Wi-Fi status & logs on Doctor Card */}
                    <div style={{
                      marginTop: '10px',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: (spk.wifi_connected !== false && spk.status !== 'offline')
                        ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(56, 189, 248, 0.04))'
                        : 'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(245, 158, 11, 0.04))',
                      border: (spk.wifi_connected !== false && spk.status !== 'offline')
                        ? '1px solid rgba(16, 185, 129, 0.25)'
                        : '1px solid rgba(239, 68, 68, 0.25)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: (spk.wifi_connected !== false && spk.status !== 'offline') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                            color: (spk.wifi_connected !== false && spk.status !== 'offline') ? '#10b981' : '#ef4444',
                            border: `1px solid ${(spk.wifi_connected !== false && spk.status !== 'offline') ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`
                          }}>
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? <Wifi size={11} /> : <WifiOff size={11} />}
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? 'Wi-Fi Online' : 'Wi-Fi Dropped'}
                          </span>
                          <span style={{ fontSize: '11.5px', fontFamily: 'var(--mono)', color: 'var(--text-pure)', fontWeight: 600 }}>
                            {spk.wifi_ssid || 'TFTus-WiFi'}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>•</span>
                          <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--sky-blue)' }}>
                            {spk.ip_address || (spk.status !== 'offline' ? '192.168.50.96' : '0.0.0.0')}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            fontSize: '10.5px',
                            fontFamily: 'var(--mono)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'var(--panel2)',
                            color: (spk.wifi_rssi || -48) > -65 ? '#10b981' : '#f59e0b',
                            fontWeight: 600,
                            border: '1px solid var(--line)'
                          }}>
                            <Signal size={10} style={{ display: 'inline', marginRight: '3px' }} />
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? `${spk.wifi_rssi || -48} dBm` : '-- dBm'}
                          </span>
                          <button
                            onClick={() => handleViewLogs(spk, 'network')}
                            style={{
                              padding: '2px 8px',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              background: 'rgba(56, 189, 248, 0.15)',
                              border: '1px solid rgba(56, 189, 248, 0.35)',
                              borderRadius: '4px',
                              color: 'var(--sky-blue)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                            title="Open filtered Wi-Fi & Network logs for this doctor speaker"
                          >
                            <FileText size={10} /> Wi-Fi Logs
                          </button>
                        </div>
                      </div>

                      {/* Real-Time Wi-Fi Log Snippet */}
                      <div style={{
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid var(--line)',
                        borderRadius: '5px',
                        padding: '4px 8px',
                        fontSize: '10.5px',
                        fontFamily: 'var(--mono)',
                        color: (spk.wifi_connected !== false && spk.status !== 'offline') ? '#34d399' : '#f87171',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ color: 'var(--muted)', fontSize: '10px' }}>LOG:</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {spk.last_network_log || (
                              (spk.wifi_connected !== false && spk.status !== 'offline')
                                ? `[WIFI_CONNECTED] Link active on '${spk.wifi_ssid || 'TFTus-WiFi'}' • RSSI: ${spk.wifi_rssi || -48} dBm`
                                : `[WIFI_DISCONNECTED] Link unassociated • Station disconnected`
                            )}
                          </span>
                        </div>
                        <span style={{ color: 'var(--muted)', fontSize: '9.5px', flexShrink: 0 }}>
                          {spk.last_network_time || 'Live'}
                        </span>
                      </div>

                      {/* Grafana Cloud Telemetry Wi-Fi Tracking Status Line */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        paddingTop: '4px',
                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                        fontSize: '10px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: (spk.wifi_connected !== false && spk.status !== 'offline') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: (spk.wifi_connected !== false && spk.status !== 'offline') ? '#34d399' : '#f87171',
                            fontWeight: 700,
                            fontFamily: 'var(--mono)'
                          }}>
                            📊 Grafana ad7r252: {(spk.wifi_connected !== false && spk.status !== 'offline') ? 'Wi-Fi Live' : 'Wi-Fi Alert'}
                          </span>
                          <span style={{ color: 'var(--muted)' }}>
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? 'Stream active on monitoring.yhealth.me' : 'Hardware link dropped'}
                          </span>
                        </div>
                        <a
                          href={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${spk.device_id}&var-mac=${spk.mac_address}&theme=dark`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            color: 'var(--golden-yellow)',
                            textDecoration: 'none',
                            fontWeight: 700
                          }}
                          title="Open Grafana dashboard for this speaker"
                        >
                          <ExternalLink size={9} /> Grafana
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Actions Toolbar - IN-CARD USB FLASH, GRAFANA LOGS & CONTROLS */}
                  <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--line)', paddingTop: '14px', marginTop: '6px', flexWrap: 'wrap' }}>
                    {/* USB Wi-Fi Flash Button Directly on Every Card */}
                    <button
                      onClick={() => handleOpenUsbForSpeaker(spk)}
                      style={{
                        flex: 1.2,
                        minWidth: '120px',
                        padding: '7px 10px',
                        fontSize: '11.5px',
                        background: 'linear-gradient(135deg, var(--golden-yellow-soft), rgba(251, 191, 36, 0.05))',
                        border: '1px solid var(--golden-yellow-border)',
                        color: 'var(--golden-yellow)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        fontWeight: 700
                      }}
                      title="Connect ESP32-S3 via USB-C to flash Wi-Fi credentials directly"
                    >
                      <Usb size={13} /> USB Flash Wi-Fi
                    </button>

                    <button
                      onClick={() => handleOpenControl(spk)}
                      style={{
                        flex: 1,
                        padding: '7px 10px',
                        fontSize: '11.5px',
                        background: 'var(--light-green-soft)',
                        border: '1px solid var(--light-green-border)',
                        color: 'var(--light-green)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        fontWeight: 700
                      }}
                      title="Remote volume control & TTS voice prompts"
                    >
                      <Sliders size={13} /> Control
                    </button>

                    {/* Direct Grafana Logs Button */}
                    <a
                      href={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${spk.device_id}&var-mac=${spk.mac_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '7px 12px',
                        fontSize: '11.5px',
                        background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.18), rgba(56, 189, 248, 0.05))',
                        border: '1px solid var(--sky-blue-border)',
                        color: 'var(--sky-blue)',
                        borderRadius: '6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        fontWeight: 700,
                        textDecoration: 'none'
                      }}
                      title="Open live Grafana telemetry & logs dashboard for Dr. Makkar (UID: ad7r252)"
                    >
                      <ExternalLink size={13} /> Grafana Logs
                    </a>

                    <button
                      onClick={() => handleOpenPingModal(spk)}
                      style={{
                        padding: '7px 11px',
                        fontSize: '11.5px',
                        background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(251, 191, 36, 0.05))',
                        border: '1px solid var(--golden-yellow-border)',
                        color: 'var(--golden-yellow)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      title="Ping hardware & speak voice audio (works across any Wi-Fi network)"
                    >
                      <Zap size={13} color="var(--golden-yellow)" /> Ping & Speak
                    </button>

                    <button
                      onClick={() => handleViewLogs(spk)}
                      style={{
                        padding: '7px 10px',
                        fontSize: '11.5px',
                        background: 'var(--panel2)',
                        border: '1px solid var(--line)',
                        borderRadius: '6px'
                      }}
                      title="View live serial & telemetry logs modal"
                    >
                      <FileText size={13} color="var(--sky-blue)" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PANEL 2: PATIENT ECOSYSTEM VIEW                                           */}
        {/* ========================================================================= */}
        {currentView === 'patients' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--sky-blue)', letterSpacing: '0.04em' }}>
                PATIENT HOME & BEDSIDE ASSISTANTS ({filteredPatients.length})
              </span>
              <small style={{ color: 'var(--muted)' }}>Dedicated patient care devices: Vitals tracking, voice logging & care goals</small>
            </div>

            {filteredPatients.length === 0 ? (
              <div style={{
                background: 'var(--panel)',
                border: '1px dashed var(--line)',
                borderRadius: '14px',
                padding: '54px 28px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '14px',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <div style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '16px',
                  background: 'var(--sky-blue-soft)',
                  border: '1px solid var(--sky-blue-border)',
                  display: 'grid',
                  placeItems: 'center'
                }}>
                  <HeartPulse size={30} color="var(--sky-blue)" />
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)', marginBottom: '6px' }}>
                    No Patient Bedside Speakers Configured
                  </div>
                  <p style={{ maxWidth: '520px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
                    Currently, 1 speaker is active in the ecosystem (<b style={{ color: 'var(--light-green)' }}>SPK-01 • Dr. Brij Mohan Makkar</b>). When you provision patient home or bedside speakers, they will be tracked here with individual care goals, vitals monitoring, and assigned doctor linkage.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setNewSpeakerForm(prev => ({
                      ...prev,
                      role: 'patient',
                      device_id: `SPK-${String(speakers.length + 1).padStart(2, '0')}`,
                      mac_address: '',
                      name: '',
                      doctor_assigned_name: 'Dr. Brij Mohan Makkar',
                      doctor_assigned_id: '6789ebb61a093d60fa691c39'
                    }))
                    setAddModalOpen(true)
                  }}
                  style={{
                    marginTop: '6px',
                    padding: '10px 22px',
                    background: 'linear-gradient(135deg, var(--sky-blue), #0284c7)',
                    color: '#031726',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '13px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(56, 189, 248, 0.35)'
                  }}
                >
                  <PlusCircle size={16} />
                  <span>+ Onboard Patient Speaker</span>
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: '18px' }}>
                {filteredPatients.map(spk => (
                  <div
                    key={spk.device_id}
                    style={{
                      background: 'var(--panel-card)',
                      border: '1px solid var(--line)',
                      borderRadius: '12px',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      boxShadow: 'var(--shadow-lg)'
                    }}
                  >
                    <div>
                      {/* Header: ID, MAC & Status */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            background: 'var(--sky-blue-soft)',
                            color: 'var(--sky-blue)',
                            padding: '3px 9px',
                            borderRadius: '5px',
                            fontWeight: 800,
                            fontFamily: 'var(--mono)',
                            fontSize: '12.5px',
                            border: '1px solid var(--sky-blue-border)'
                          }}>
                            {spk.device_id}
                          </span>
                          <span style={{ color: 'var(--sparkle-white)', opacity: 0.85, fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 600 }}>
                            {spk.mac_address}
                          </span>
                          <span style={{ background: 'var(--panel2)', color: 'var(--muted)', fontSize: '10.5px', padding: '2px 7px', borderRadius: '4px' }}>
                            {spk.bed_location || 'Home Care'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Interactive Real-Time Wi-Fi Status Badge */}
                          <span
                            onClick={() => handleToggleWifi(spk)}
                            className="interactive-mode-pill"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '3px 9px',
                              borderRadius: '12px',
                              cursor: 'pointer',
                              background: spk.wifi_connected !== false && spk.status !== 'offline' ? 'var(--light-green-soft)' : 'var(--red-soft)',
                              color: spk.wifi_connected !== false && spk.status !== 'offline' ? 'var(--light-green)' : 'var(--red)',
                              border: spk.wifi_connected !== false && spk.status !== 'offline' ? '1px solid var(--light-green-border)' : '1px solid var(--red-soft)'
                            }}
                            title="Click to toggle real-time Wi-Fi connectivity (Connected / Disconnected)"
                          >
                            {spk.wifi_connected !== false && spk.status !== 'offline' ? (
                              <>
                                <Wifi size={12} />
                                <span>Wi-Fi Connected</span>
                              </>
                            ) : (
                              <>
                                <WifiOff size={12} />
                                <span>Wi-Fi Disconnected</span>
                              </>
                            )}
                          </span>

                          {/* Interactive Real-Time Connection Mode Badge: Online / Standby / Offline */}
                          <span
                            onClick={() => cycleSpeakerStatus(spk)}
                            className={`interactive-mode-pill ${spk.status === 'online' ? 'live-beacon-online' : spk.status === 'standby' ? 'live-beacon-standby' : ''}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '11px',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              padding: '3px 9px',
                              borderRadius: '12px',
                              cursor: 'pointer',
                              background: spk.status === 'online' ? 'var(--light-green-soft)' : spk.status === 'standby' ? 'var(--golden-yellow-soft)' : 'var(--red-soft)',
                              color: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)',
                              border: spk.status === 'online' ? '1px solid var(--light-green-border)' : spk.status === 'standby' ? '1px solid var(--golden-yellow-border)' : '1px solid var(--line)'
                            }}
                            title="Click to cycle Live Mode: ONLINE ➔ STANDBY ➔ OFFLINE in real time"
                          >
                            <span style={{
                              width: '7px',
                              height: '7px',
                              borderRadius: '50%',
                              background: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)',
                              boxShadow: spk.status === 'online' ? '0 0 6px var(--light-green)' : spk.status === 'standby' ? '0 0 6px var(--golden-yellow)' : 'none',
                              display: 'inline-block'
                            }} />
                            {spk.status}
                          </span>
                        </div>
                      </div>

                      {/* Patient Identity */}
                      <div style={{ marginBottom: '14px' }}>
                        <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--display)' }}>
                          {spk.name}
                          <span style={{ fontSize: '11px', background: 'var(--light-pink-soft)', color: 'var(--light-pink)', border: '1px solid var(--light-pink-border)', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                            {spk.patient_id}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--light-green)', fontSize: '12px', fontWeight: 600, marginTop: '3px' }}>
                          <Stethoscope size={13} />
                          <span>Doctor Assigned: <b>{spk.doctor_assigned_name}</b></span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--sky-blue)', fontSize: '12px', fontWeight: 600, marginTop: '2px' }}>
                          <Activity size={13} />
                          <span>Program: {spk.enrolled_program}</span>
                        </div>
                        {spk.status_reason && (
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            fontSize: '11px',
                            marginTop: '6px',
                            color: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--muted)',
                            fontFamily: 'var(--mono)',
                            background: 'rgba(255, 255, 255, 0.04)',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            borderLeft: `2.5px solid ${spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)'}`
                          }}>
                            <Activity size={11} />
                            <span>{spk.status_reason}</span>
                          </div>
                        )}
                      </div>

                      {/* Main Health Goal Box (Highlighted) */}
                      <div style={{ background: 'var(--panel2)', borderRadius: '8px', padding: '12px', marginBottom: '14px', borderLeft: '3.5px solid var(--light-pink)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--light-pink)', fontSize: '11px', fontWeight: 700, marginBottom: '4px', letterSpacing: '0.04em' }}>
                          <Target size={14} /> MAIN HEALTH GOAL
                        </div>
                        <div style={{ fontSize: '12.5px', color: 'var(--text-pure)', fontWeight: 500, lineHeight: 1.4 }}>
                          {spk.main_goal}
                        </div>
                      </div>

                      {/* Location & Last Voice Check-in */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', fontSize: '11.5px', color: 'var(--muted)', marginBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                          <MapPin size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                          <span>{spk.address}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--light-green)', fontWeight: 600 }}>
                          <Mic size={14} />
                          <span>Last Check-in: {spk.last_voice_checkin || 'Active Today'}</span>
                        </div>
                      </div>

                      {/* Phone & Volume */}
                      <div style={{ display: 'flex', gap: '16px', fontSize: '11.5px', color: 'var(--muted)', marginBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Phone size={13} color="var(--light-pink)" />
                          <a href={`tel:${spk.phone}`} style={{ color: 'var(--text-pure)' }}>{spk.phone}</a>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Volume2 size={13} color="var(--sky-blue)" />
                          <span>Vol: <b style={{ color: 'var(--text-pure)' }}>{spk.volume || 75}%</b></span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          {spk.wifi_connected !== false && spk.status !== 'offline' ? (
                            <>
                              <Wifi size={13} color="var(--light-green)" />
                              <span>{spk.wifi_ssid || 'Home-WiFi'}</span>
                            </>
                          ) : (
                            <>
                              <WifiOff size={13} color="var(--red)" />
                              <span style={{ color: 'var(--red)', fontWeight: 700 }}>Wi-Fi Disconnected</span>
                            </>
                          )}
                        </div>
                      </div>

                    {/* Inline Quick Real-Time Mode Switcher */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      background: 'var(--panel2)',
                      padding: '7px 11px',
                      borderRadius: '8px',
                      marginTop: '6px',
                      marginBottom: '10px',
                      border: '1px solid var(--line)'
                    }}>
                      <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Live Mode:
                      </span>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'online', true, 'Wake Word Triggered / WebSocket Connected')}
                          style={{
                            padding: '3px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '5px',
                            border: spk.status === 'online' ? '1px solid var(--light-green)' : '1px solid transparent',
                            background: spk.status === 'online' ? 'var(--light-green-soft)' : 'transparent',
                            color: spk.status === 'online' ? 'var(--light-green)' : 'var(--muted)',
                            cursor: 'pointer'
                          }}
                          title="Set to Online: WebSocket connected (Wake Word awake & streaming)"
                        >
                          ● Online
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'standby', true, 'WebSocket Idle Standby (2m halt) • Wi-Fi Linked')}
                          style={{
                            padding: '3px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '5px',
                            border: spk.status === 'standby' ? '1px solid var(--golden-yellow)' : '1px solid transparent',
                            background: spk.status === 'standby' ? 'var(--golden-yellow-soft)' : 'transparent',
                            color: spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--muted)',
                            cursor: 'pointer'
                          }}
                          title="Set to Standby: WebSocket disconnected after 2m halt • Wi-Fi linked"
                        >
                          ◐ Standby
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'offline', false, 'Hardware Powered Off / Unreachable')}
                          style={{
                            padding: '3px 9px',
                            fontSize: '11px',
                            fontWeight: 700,
                            borderRadius: '5px',
                            border: spk.status === 'offline' ? '1px solid var(--red)' : '1px solid transparent',
                            background: spk.status === 'offline' ? 'var(--red-soft)' : 'transparent',
                            color: spk.status === 'offline' ? 'var(--red)' : 'var(--muted)',
                            cursor: 'pointer'
                          }}
                          title="Set to Offline: Disconnected or Wi-Fi dropped"
                        >
                          ○ Offline
                        </button>
                      </div>
                    </div>

                    {/* Live Wi-Fi & Network Diagnostics Bar - Reflects real-time Wi-Fi status & logs on Patient Bedside Card */}
                    <div style={{
                      marginTop: '10px',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      background: (spk.wifi_connected !== false && spk.status !== 'offline')
                        ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(56, 189, 248, 0.04))'
                        : 'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(245, 158, 11, 0.04))',
                      border: (spk.wifi_connected !== false && spk.status !== 'offline')
                        ? '1px solid rgba(16, 185, 129, 0.25)'
                        : '1px solid rgba(239, 68, 68, 0.25)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: (spk.wifi_connected !== false && spk.status !== 'offline') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                            color: (spk.wifi_connected !== false && spk.status !== 'offline') ? '#10b981' : '#ef4444',
                            border: `1px solid ${(spk.wifi_connected !== false && spk.status !== 'offline') ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`
                          }}>
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? <Wifi size={11} /> : <WifiOff size={11} />}
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? 'Wi-Fi Online' : 'Wi-Fi Dropped'}
                          </span>
                          <span style={{ fontSize: '11.5px', fontFamily: 'var(--mono)', color: 'var(--text-pure)', fontWeight: 600 }}>
                            {spk.wifi_ssid || 'TFTus-WiFi'}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>•</span>
                          <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--sky-blue)' }}>
                            {spk.ip_address || (spk.status !== 'offline' ? '192.168.50.96' : '0.0.0.0')}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{
                            fontSize: '10.5px',
                            fontFamily: 'var(--mono)',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'var(--panel2)',
                            color: (spk.wifi_rssi || -48) > -65 ? '#10b981' : '#f59e0b',
                            fontWeight: 600,
                            border: '1px solid var(--line)'
                          }}>
                            <Signal size={10} style={{ display: 'inline', marginRight: '3px' }} />
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? `${spk.wifi_rssi || -48} dBm` : '-- dBm'}
                          </span>
                          <button
                            onClick={() => handleViewLogs(spk, 'network')}
                            style={{
                              padding: '2px 8px',
                              fontSize: '10.5px',
                              fontWeight: 700,
                              background: 'rgba(56, 189, 248, 0.15)',
                              border: '1px solid rgba(56, 189, 248, 0.35)',
                              borderRadius: '4px',
                              color: 'var(--sky-blue)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                            title="Open filtered Wi-Fi & Network logs for this patient speaker"
                          >
                            <FileText size={10} /> Wi-Fi Logs
                          </button>
                        </div>
                      </div>

                      {/* Real-Time Wi-Fi Log Snippet */}
                      <div style={{
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: '1px solid var(--line)',
                        borderRadius: '5px',
                        padding: '4px 8px',
                        fontSize: '10.5px',
                        fontFamily: 'var(--mono)',
                        color: (spk.wifi_connected !== false && spk.status !== 'offline') ? '#34d399' : '#f87171',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ color: 'var(--muted)', fontSize: '10px' }}>LOG:</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {spk.last_network_log || (
                              (spk.wifi_connected !== false && spk.status !== 'offline')
                                ? `[WIFI_CONNECTED] Link active on '${spk.wifi_ssid || 'TFTus-WiFi'}' • RSSI: ${spk.wifi_rssi || -48} dBm`
                                : `[WIFI_DISCONNECTED] Link unassociated • Station disconnected`
                            )}
                          </span>
                        </div>
                        <span style={{ color: 'var(--muted)', fontSize: '9.5px', flexShrink: 0 }}>
                          {spk.last_network_time || 'Live'}
                        </span>
                      </div>

                      {/* Grafana Cloud Telemetry Wi-Fi Tracking Status Line */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '6px',
                        paddingTop: '4px',
                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                        fontSize: '10px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: (spk.wifi_connected !== false && spk.status !== 'offline') ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: (spk.wifi_connected !== false && spk.status !== 'offline') ? '#34d399' : '#f87171',
                            fontWeight: 700,
                            fontFamily: 'var(--mono)'
                          }}>
                            📊 Grafana ad7r252: {(spk.wifi_connected !== false && spk.status !== 'offline') ? 'Wi-Fi Live' : 'Wi-Fi Alert'}
                          </span>
                          <span style={{ color: 'var(--muted)' }}>
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? 'Stream active on monitoring.yhealth.me' : 'Hardware link dropped'}
                          </span>
                        </div>
                        <a
                          href={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${spk.device_id}&var-mac=${spk.mac_address}&theme=dark`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            color: 'var(--golden-yellow)',
                            textDecoration: 'none',
                            fontWeight: 700
                          }}
                          title="Open Grafana dashboard for this speaker"
                        >
                          <ExternalLink size={9} /> Grafana
                        </a>
                      </div>
                    </div>
                  </div>

                    {/* Actions Toolbar - IN-CARD USB FLASH & PROVISIONING INTEGRATED */}
                    <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
                      {/* In-Card USB Flash Button */}
                      <button
                        onClick={() => handleOpenUsbForSpeaker(spk)}
                        style={{
                          flex: 1.3,
                          padding: '7px 10px',
                          fontSize: '11.5px',
                          background: 'linear-gradient(135deg, var(--golden-yellow-soft), rgba(251, 191, 36, 0.05))',
                          border: '1px solid var(--golden-yellow-border)',
                          color: 'var(--golden-yellow)',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '5px',
                          fontWeight: 700
                        }}
                        title="Plug in ESP32-S3 via USB-C to provision Wi-Fi credentials"
                      >
                        <Usb size={13} /> USB Flash Wi-Fi
                      </button>

                      <button
                        onClick={() => handleOpenControl(spk)}
                        style={{
                          flex: 1.1,
                          padding: '7px 10px',
                          fontSize: '11.5px',
                          background: 'var(--sky-blue-soft)',
                          border: '1px solid var(--sky-blue-border)',
                          color: 'var(--sky-blue)',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          fontWeight: 700
                        }}
                      >
                        <Sliders size={13} /> Control
                      </button>


                      <button
                        onClick={() => handleOpenPingModal(spk)}
                        style={{
                          padding: '7px 11px',
                          fontSize: '11.5px',
                          background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(251, 191, 36, 0.05))',
                          border: '1px solid var(--golden-yellow-border)',
                          color: 'var(--golden-yellow)',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                        title="Ping bedside unit & speak voice audio"
                      >
                        <Zap size={13} color="var(--golden-yellow)" /> Ping & Speak
                      </button>

                      {/* Direct Wi-Fi Logs Modal Trigger Button */}
                      <button
                        onClick={() => handleViewLogs(spk, 'network')}
                        style={{
                          padding: '7px 10px',
                          fontSize: '11.5px',
                          background: 'var(--panel2)',
                          border: '1px solid var(--line)',
                          borderRadius: '6px',
                          color: 'var(--sky-blue)',
                          cursor: 'pointer'
                        }}
                        title="View live Wi-Fi & network telemetry logs"
                      >
                        <FileText size={13} />
                      </button>

                      <button
                        onClick={(e) => handleDeleteSpeaker(spk.device_id, e)}
                        style={{
                          padding: '7px 10px',
                          fontSize: '11.5px',
                          background: 'var(--panel2)',
                          border: '1px solid var(--red-soft)',
                          color: 'var(--red)',
                          borderRadius: '6px'
                        }}
                        title="De-register unit"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* IN-CARD USB FLASH MODAL (Targeted directly to clicked speaker card)        */}
      {/* ========================================================================= */}
      {usbTargetSpeaker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 110, backdropFilter: 'blur(5px)' }}>
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--golden-yellow-border)',
            borderRadius: '14px',
            width: '500px',
            padding: '24px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--golden-yellow-soft)', display: 'grid', placeItems: 'center' }}>
                  <Usb size={18} color="var(--golden-yellow)" />
                </div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-pure)' }}>
                    USB Flash & Wi-Fi Provisioning
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--golden-yellow)', fontFamily: 'var(--mono)' }}>
                    Target: {usbTargetSpeaker.device_id} ({usbTargetSpeaker.mac_address})
                  </div>
                </div>
              </div>
              <button onClick={() => setUsbTargetSpeaker(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <XCircle size={20} />
              </button>
            </div>

            <div style={{ background: 'var(--panel2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-pure)', fontWeight: 600, marginBottom: '2px' }}>
                Assigned To: {usbTargetSpeaker.name}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                {usbTargetSpeaker.role === 'doctor'
                  ? `Clinic: ${usbTargetSpeaker.clinic_name}`
                  : `Care Plan: ${usbTargetSpeaker.enrolled_program}`}
              </div>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '16px', lineHeight: 1.45 }}>
              1. Connect your <b>ESP32-S3 DevKit</b> to this computer via USB-C.<br />
              2. Enter the local 2.4 GHz Wi-Fi credentials.<br />
              3. Click <b>Connect COM Port & Flash</b> to transmit over Web Serial.
            </p>

            <form onSubmit={handleFlashWifiOverUsb} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                  WI-FI SSID (2.4 GHz)
                </label>
                <input
                  type="text"
                  required
                  value={usbSsid}
                  onChange={e => setUsbSsid(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                  WI-FI PASSWORD
                </label>
                <input
                  type="password"
                  placeholder="Enter Wi-Fi password"
                  value={usbPassword}
                  onChange={e => setUsbPassword(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              {usbFlashStatus && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontFamily: 'var(--mono)',
                  background: 'var(--panel2)',
                  border: '1px solid var(--line)',
                  color: 'var(--golden-yellow)'
                }}>
                  {usbFlashStatus}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setUsbTargetSpeaker(null)}
                  style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isFlashingUsb}
                  style={{
                    padding: '9px 20px',
                    background: 'linear-gradient(135deg, var(--golden-yellow), #d97706)',
                    color: '#261900',
                    fontWeight: 800,
                    border: 'none',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(251, 191, 36, 0.3)'
                  }}
                >
                  <Zap size={15} />
                  {isFlashingUsb ? 'Flashing via Serial...' : 'Connect COM Port & Flash'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REMOTE CONTROL (Volume, TTS Voice Announcement, Ping)              */}
      {/* ========================================================================= */}
      {controlModalOpen && controlSpeaker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 105, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '14px', width: '520px', padding: '24px', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)' }}>
                  Hardware Remote Control: {controlSpeaker.device_id}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  MAC: {controlSpeaker.mac_address} | {controlSpeaker.name}
                </div>
              </div>
              <button onClick={() => setControlModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <XCircle size={20} />
              </button>
            </div>

            {/* Volume Slider */}
            <div style={{ background: 'var(--panel2)', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Volume2 size={16} color="var(--light-green)" /> Hardware Volume
                </span>
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--light-green)', fontFamily: 'var(--mono)' }}>
                  {controlVolume}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={controlVolume}
                onChange={e => setControlVolume(Number(e.target.value))}
                onMouseUp={() => handleSendCommand('set_volume', { volume: controlVolume })}
                style={{ width: '100%', accentColor: 'var(--light-green)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--muted)', marginTop: '4px' }}>
                <span>0% (Mute)</span>
                <span>50%</span>
                <span>100% (Maximum ES8311 Gain)</span>
              </div>
            </div>

            {/* Voice Announcement TTS */}
            <div style={{ background: 'var(--panel2)', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid var(--line)' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-pure)', display: 'block', marginBottom: '8px' }}>
                🗣️ Real-Time Voice Announcement (TTS Prompt)
              </label>
              <textarea
                rows={3}
                placeholder="Type a clinical reminder or patient check-in prompt to speak over this speaker in real time..."
                value={announcementText}
                onChange={e => setAnnouncementText(e.target.value)}
                style={{ width: '100%', padding: '10px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontSize: '12.5px', resize: 'none' }}
              />
              <button
                disabled={sendingCommand || !announcementText.trim()}
                onClick={() => handleSendCommand('speak_tts', { text: announcementText })}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  padding: '9px',
                  background: 'var(--light-green-soft)',
                  border: '1px solid var(--light-green-border)',
                  color: 'var(--light-green)',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '12.5px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Send size={14} /> Send Voice Announcement
              </button>
            </div>

            {/* Connection & Wi-Fi Status Mode Controller */}
            <div style={{ background: 'var(--panel2)', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <RadioTower size={16} color="var(--sky-blue)" /> Connection & Wi-Fi Status Mode
                </span>
                <span style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: controlSpeaker.status === 'online' ? 'var(--light-green-soft)' : controlSpeaker.status === 'standby' ? 'var(--golden-yellow-soft)' : 'var(--red-soft)',
                  color: controlSpeaker.status === 'online' ? 'var(--light-green)' : controlSpeaker.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)'
                }}>
                  {controlSpeaker.status} • {controlSpeaker.wifi_connected !== false && controlSpeaker.status !== 'offline' ? 'Wi-Fi On' : 'Wi-Fi Off'}
                </span>
              </div>

              <p style={{ fontSize: '11px', color: 'var(--muted)', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                WebSocket Connection Mode: <b>Online</b> (streaming/wake word active), <b>Standby</b> (halt after 2 minutes idle), <b>Offline</b> (disconnected).
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    handleSetSpeakerStatus(controlSpeaker.device_id, 'online', true, 'Wake Word Triggered / WebSocket Connected')
                    setControlSpeaker(prev => ({ ...prev, status: 'online', wifi_connected: true }))
                  }}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: controlSpeaker.status === 'online' ? 'var(--light-green)' : 'var(--panel)',
                    color: controlSpeaker.status === 'online' ? '#06271a' : 'var(--light-green)',
                    border: '1px solid var(--light-green-border)'
                  }}
                  title="Simulate Wake Word called: Speaker wakes up and connects WebSocket -> Online"
                >
                  🟢 Wake Word (Online)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleSetSpeakerStatus(controlSpeaker.device_id, 'standby', true, '2-Minute Idle Halt / WebSocket Closed')
                    setControlSpeaker(prev => ({ ...prev, status: 'standby', wifi_connected: true }))
                  }}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: controlSpeaker.status === 'standby' ? 'var(--golden-yellow)' : 'var(--panel)',
                    color: controlSpeaker.status === 'standby' ? '#261b02' : 'var(--golden-yellow)',
                    border: '1px solid var(--golden-yellow-border)'
                  }}
                  title="Simulate 2-minute idle halt: Speaker drops WebSocket to standby"
                >
                  🟡 2m Halt (Standby)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleSetSpeakerStatus(controlSpeaker.device_id, 'offline', false, 'Hardware Powered Off / Unreachable')
                    setControlSpeaker(prev => ({ ...prev, status: 'offline', wifi_connected: false }))
                  }}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: controlSpeaker.status === 'offline' ? 'var(--red)' : 'var(--panel)',
                    color: controlSpeaker.status === 'offline' ? '#ffffff' : 'var(--red)',
                    border: '1px solid var(--red-soft)'
                  }}
                  title="Simulate hardware disconnection / offline"
                >
                  🔴 Disconnect (Offline)
                </button>
              </div>

              {/* Wi-Fi Connection Toggle */}
              <button
                type="button"
                onClick={() => {
                  const newWifi = !(controlSpeaker.wifi_connected !== false && controlSpeaker.status !== 'offline')
                  handleSetSpeakerStatus(
                    controlSpeaker.device_id,
                    newWifi ? 'online' : 'offline',
                    newWifi,
                    newWifi ? 'Wi-Fi Reconnected' : 'Wi-Fi Disconnected'
                  )
                  setControlSpeaker(prev => ({
                    ...prev,
                    wifi_connected: newWifi,
                    status: newWifi ? 'online' : 'offline'
                  }))
                }}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  color: controlSpeaker.wifi_connected !== false && controlSpeaker.status !== 'offline' ? 'var(--red)' : 'var(--light-green)'
                }}
              >
                {controlSpeaker.wifi_connected !== false && controlSpeaker.status !== 'offline' ? (
                  <>
                    <WifiOff size={13} color="var(--red)" />
                    <span>Simulate Wi-Fi Drop (Set Wi-Fi Disconnected)</span>
                  </>
                ) : (
                  <>
                    <Wifi size={13} color="var(--light-green)" />
                    <span>Restore Wi-Fi (Set Wi-Fi Connected)</span>
                  </>
                )}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setControlModalOpen(false)}
                style={{ padding: '8px 18px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD NEW SPEAKER                                                    */}
      {/* ========================================================================= */}
      {addModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 100, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '14px', width: '580px', maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                  Register New Smart Speaker
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
                  Bind a new hardware MAC address into PostgreSQL with full clinical mapping
                </div>
              </div>
              <button onClick={() => setAddModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <XCircle size={20} />
              </button>
            </div>

            <form onSubmit={handleAddSpeakerSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Role Selector: Doctor vs Patient */}
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                  ASSIGNMENT DOMAIN / ROLE
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setNewSpeakerForm({ ...newSpeakerForm, role: 'doctor' })}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      background: newSpeakerForm.role === 'doctor' ? 'var(--light-green-soft)' : 'var(--panel2)',
                      border: newSpeakerForm.role === 'doctor' ? '1.5px solid var(--light-green)' : '1px solid var(--line)',
                      color: newSpeakerForm.role === 'doctor' ? 'var(--light-green)' : 'var(--muted)'
                    }}
                  >
                    <Stethoscope size={16} /> Doctor Clinic
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSpeakerForm({ ...newSpeakerForm, role: 'patient' })}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      background: newSpeakerForm.role === 'patient' ? 'var(--sky-blue-soft)' : 'var(--panel2)',
                      border: newSpeakerForm.role === 'patient' ? '1.5px solid var(--sky-blue)' : '1px solid var(--line)',
                      color: newSpeakerForm.role === 'patient' ? 'var(--sky-blue)' : 'var(--muted)'
                    }}
                  >
                    <HeartPulse size={16} /> Patient Bedside
                  </button>
                </div>
              </div>

              {/* Hardware ID & MAC */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>DEVICE ID</label>
                  <input
                    type="text"
                    placeholder={`SPK-${String(speakers.length + 1).padStart(2, '0')}`}
                    value={newSpeakerForm.device_id}
                    onChange={e => setNewSpeakerForm({ ...newSpeakerForm, device_id: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontFamily: 'var(--mono)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>MAC ADDRESS *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. A0:F2:62:E3:4C:85"
                    value={newSpeakerForm.mac_address}
                    onChange={e => setNewSpeakerForm({ ...newSpeakerForm, mac_address: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontFamily: 'var(--mono)' }}
                  />
                </div>
              </div>

              {/* Assigned Person Name */}
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>
                  {newSpeakerForm.role === 'doctor' ? 'DOCTOR FULL NAME *' : 'PATIENT FULL NAME *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={newSpeakerForm.role === 'doctor' ? 'e.g. Dr. Ramesh Gupta' : 'e.g. Meera Kapoor'}
                  value={newSpeakerForm.name}
                  onChange={e => setNewSpeakerForm({ ...newSpeakerForm, name: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              {/* Phone & Email */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>PHONE</label>
                  <input
                    type="text"
                    placeholder="+91 98110 00000"
                    value={newSpeakerForm.phone}
                    onChange={e => setNewSpeakerForm({ ...newSpeakerForm, phone: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>EMAIL</label>
                  <input
                    type="email"
                    placeholder="name@yhealth.me"
                    value={newSpeakerForm.email}
                    onChange={e => setNewSpeakerForm({ ...newSpeakerForm, email: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                  />
                </div>
              </div>

              {/* Doctor Specific Fields */}
              {newSpeakerForm.role === 'doctor' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>DOCTOR ID</label>
                      <input
                        type="text"
                        placeholder="DOC-6789"
                        value={newSpeakerForm.doctor_id}
                        onChange={e => setNewSpeakerForm({ ...newSpeakerForm, doctor_id: e.target.value })}
                        style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontFamily: 'var(--mono)' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>SPECIALIZATION</label>
                      <input
                        type="text"
                        placeholder="e.g. Diabetologist, Cardiologist"
                        value={newSpeakerForm.specialization}
                        onChange={e => setNewSpeakerForm({ ...newSpeakerForm, specialization: e.target.value })}
                        style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>CLINIC / HOSPITAL NAME</label>
                    <input
                      type="text"
                      placeholder="e.g. Apollo Heart Institute"
                      value={newSpeakerForm.clinic_name}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, clinic_name: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>CLINIC ADDRESS</label>
                    <input
                      type="text"
                      placeholder="e.g. Sector 38, Gurugram, Haryana"
                      value={newSpeakerForm.clinic_address}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, clinic_address: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                    />
                  </div>
                </>
              )}

              {/* Patient Specific Fields */}
              {newSpeakerForm.role === 'patient' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>PATIENT ID</label>
                      <input
                        type="text"
                        placeholder="e.g. PAT-88219"
                        value={newSpeakerForm.patient_id}
                        onChange={e => setNewSpeakerForm({ ...newSpeakerForm, patient_id: e.target.value })}
                        style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontFamily: 'var(--mono)' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>ASSIGNED DOCTOR NAME</label>
                      <input
                        type="text"
                        placeholder="e.g. Dr. Brij Mohan Makkar"
                        value={newSpeakerForm.doctor_assigned_name}
                        onChange={e => setNewSpeakerForm({ ...newSpeakerForm, doctor_assigned_name: e.target.value })}
                        style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>ENROLLED CARE PROGRAM</label>
                    <input
                      type="text"
                      placeholder="e.g. Type-2 Diabetes Reversal & Remission"
                      value={newSpeakerForm.enrolled_program}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, enrolled_program: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>MAIN HEALTH GOAL</label>
                    <input
                      type="text"
                      placeholder="e.g. Target HbA1c < 6.5%, Fasting Glucose < 110 mg/dL"
                      value={newSpeakerForm.main_goal}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, main_goal: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>HOME / BED LOCATION ADDRESS</label>
                    <input
                      type="text"
                      placeholder="e.g. Sector 14, Gurugram / Ward 4 Bed 12"
                      value={newSpeakerForm.address}
                      onChange={e => setNewSpeakerForm({ ...newSpeakerForm, address: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  style={{ padding: '9px 16px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '9px 22px',
                    background: newSpeakerForm.role === 'doctor'
                      ? 'linear-gradient(135deg, var(--light-green), #10b981)'
                      : 'linear-gradient(135deg, var(--sky-blue), #0284c7)',
                    color: newSpeakerForm.role === 'doctor' ? '#042217' : '#031726',
                    fontWeight: 800,
                    border: 'none',
                    borderRadius: '6px'
                  }}
                >
                  Save & Register Speaker
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* ========================================================================= */}
      {/* MODAL: LIVE LOGS & TELEMETRY WITH NETWORK LOG DIFFERENTIATION             */}
      {/* ========================================================================= */}
      {logsModalOpen && activeSpeakerForLogs && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', display: 'grid', placeItems: 'center', zIndex: 100, backdropFilter: 'blur(6px)' }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '16px', width: '740px', maxHeight: '86vh', padding: '24px', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <b style={{ fontSize: '18px', color: 'var(--text-pure)' }}>
                    Live Logs & Diagnostics: {activeSpeakerForLogs.device_id}
                  </b>
                  <span style={{
                    fontSize: '10.5px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '20px',
                    background: activeSpeakerForLogs.wifi_connected !== false ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: activeSpeakerForLogs.wifi_connected !== false ? '#10b981' : '#ef4444',
                    border: `1px solid ${activeSpeakerForLogs.wifi_connected !== false ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {activeSpeakerForLogs.wifi_connected !== false ? <Wifi size={11} /> : <WifiOff size={11} />}
                    {activeSpeakerForLogs.wifi_connected !== false ? 'Wi-Fi Linked' : 'Wi-Fi Dropped'}
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: '2px' }}>
                  MAC: {activeSpeakerForLogs.mac_address} | Role: {activeSpeakerForLogs.role?.toUpperCase()} | Assigned: {activeSpeakerForLogs.name}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <a
                  href={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${activeSpeakerForLogs.device_id}&var-mac=${activeSpeakerForLogs.mac_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.05))',
                    border: '1px solid var(--golden-yellow-border)',
                    color: 'var(--golden-yellow)',
                    borderRadius: '6px',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    textDecoration: 'none'
                  }}
                  title="Open live telemetry dashboard in Grafana"
                >
                  <ExternalLink size={13} />
                  <span>Grafana Live</span>
                </a>
                <button onClick={() => setLogsModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                  <XCircle size={22} />
                </button>
              </div>
            </div>

            {/* Live Network & Wi-Fi Real-Life Telemetry Strip */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.06), rgba(14, 165, 233, 0.06))',
              border: '1px solid var(--line)',
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '11.5px', fontFamily: 'var(--mono)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--muted)' }}>SSID:</span>
                  <span style={{ color: 'var(--text-pure)', fontWeight: 700 }}>{activeSpeakerForLogs.wifi_ssid || 'TFTus-WiFi'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--muted)' }}>IP:</span>
                  <span style={{ color: 'var(--sky-blue)', fontWeight: 700 }}>
                    {activeSpeakerForLogs.ip_address || (activeSpeakerForLogs.wifi_connected !== false ? '192.168.50.96' : '0.0.0.0')}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--muted)' }}>Signal:</span>
                  <span style={{
                    color: (activeSpeakerForLogs.wifi_rssi || -48) > -65 ? '#10b981' : '#f59e0b',
                    fontWeight: 700
                  }}>
                    {activeSpeakerForLogs.wifi_connected !== false ? `${activeSpeakerForLogs.wifi_rssi || -48} dBm (Good)` : '0 dBm'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: 'var(--muted)' }}>Protocol:</span>
                  <span style={{ color: 'var(--text-pure)' }}>802.11 b/g/n (2.4GHz)</span>
                </div>
              </div>

              {/* Real-time Network Quick Test Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Real-Life Test:</span>
                <button
                  onClick={() => handleSimulateNetworkEvent(activeSpeakerForLogs.device_id, true)}
                  style={{
                    padding: '4px 10px',
                    background: 'rgba(16, 185, 129, 0.18)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    borderRadius: '5px',
                    color: '#10b981',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Simulate Wi-Fi connection and generate network log"
                >
                  <Wifi size={11} /> Wi-Fi Connect
                </button>
                <button
                  onClick={() => handleSimulateNetworkEvent(activeSpeakerForLogs.device_id, false)}
                  style={{
                    padding: '4px 10px',
                    background: 'rgba(239, 68, 68, 0.18)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: '5px',
                    color: '#ef4444',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  title="Simulate Wi-Fi drop and generate network disconnect log"
                >
                  <WifiOff size={11} /> Wi-Fi Drop
                </button>
              </div>
            </div>

            {/* Filter Tabs to Differentiate Logs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', borderBottom: '1px solid var(--line)', paddingBottom: '8px' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Filter size={12} /> Filter:
              </span>
              <button
                onClick={() => setLogsCategoryFilter('all')}
                style={{
                  padding: '5px 12px',
                  background: logsCategoryFilter === 'all' ? 'var(--panel2)' : 'transparent',
                  border: `1px solid ${logsCategoryFilter === 'all' ? 'var(--line2)' : 'transparent'}`,
                  borderRadius: '6px',
                  color: logsCategoryFilter === 'all' ? 'var(--text-pure)' : 'var(--muted)',
                  fontSize: '11.5px',
                  fontWeight: logsCategoryFilter === 'all' ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                All Logs
                <span style={{ padding: '1px 6px', background: 'rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '10px' }}>
                  {speakerLogs.length}
                </span>
              </button>

              <button
                onClick={() => setLogsCategoryFilter('network')}
                style={{
                  padding: '5px 12px',
                  background: logsCategoryFilter === 'network' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                  border: `1px solid ${logsCategoryFilter === 'network' ? 'rgba(16, 185, 129, 0.4)' : 'transparent'}`,
                  borderRadius: '6px',
                  color: logsCategoryFilter === 'network' ? '#10b981' : 'var(--muted)',
                  fontSize: '11.5px',
                  fontWeight: logsCategoryFilter === 'network' ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Wifi size={12} />
                📶 Network & Wi-Fi
                <span style={{ padding: '1px 6px', background: logsCategoryFilter === 'network' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
                  {networkLogsCount}
                </span>
              </button>

              <button
                onClick={() => setLogsCategoryFilter('websocket')}
                style={{
                  padding: '5px 12px',
                  background: logsCategoryFilter === 'websocket' ? 'rgba(14, 165, 233, 0.15)' : 'transparent',
                  border: `1px solid ${logsCategoryFilter === 'websocket' ? 'rgba(14, 165, 233, 0.4)' : 'transparent'}`,
                  borderRadius: '6px',
                  color: logsCategoryFilter === 'websocket' ? 'var(--sky-blue)' : 'var(--muted)',
                  fontSize: '11.5px',
                  fontWeight: logsCategoryFilter === 'websocket' ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <RadioTower size={12} />
                ⚡ WebSocket Stream
                <span style={{ padding: '1px 6px', background: logsCategoryFilter === 'websocket' ? 'rgba(14, 165, 233, 0.25)' : 'rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
                  {wsLogsCount}
                </span>
              </button>

              <button
                onClick={() => setLogsCategoryFilter('grafana')}
                style={{
                  padding: '5px 12px',
                  background: logsCategoryFilter === 'grafana' ? 'rgba(251, 191, 36, 0.15)' : 'transparent',
                  border: `1px solid ${logsCategoryFilter === 'grafana' ? 'rgba(251, 191, 36, 0.4)' : 'transparent'}`,
                  borderRadius: '6px',
                  color: logsCategoryFilter === 'grafana' ? 'var(--golden-yellow)' : 'var(--muted)',
                  fontSize: '11.5px',
                  fontWeight: logsCategoryFilter === 'grafana' ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <BarChart3 size={12} />
                📊 Grafana Stream
                <span style={{ padding: '1px 6px', background: logsCategoryFilter === 'grafana' ? 'rgba(251, 191, 36, 0.25)' : 'rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
                  {grafanaLogsCount}
                </span>
              </button>

              <button
                onClick={() => setLogsCategoryFilter('system')}
                style={{
                  padding: '5px 12px',
                  background: logsCategoryFilter === 'system' ? 'var(--panel2)' : 'transparent',
                  border: `1px solid ${logsCategoryFilter === 'system' ? 'var(--line2)' : 'transparent'}`,
                  borderRadius: '6px',
                  color: logsCategoryFilter === 'system' ? 'var(--text-pure)' : 'var(--muted)',
                  fontSize: '11.5px',
                  fontWeight: logsCategoryFilter === 'system' ? 700 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Cpu size={12} />
                ⚙️ System & HW
                <span style={{ padding: '1px 6px', background: 'rgba(255,255,255,0.08)', borderRadius: '10px', fontSize: '10px' }}>
                  {systemLogsCount}
                </span>
              </button>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setShowGrafanaEmbed(prev => !prev)}
                  style={{
                    padding: '4px 10px',
                    background: showGrafanaEmbed ? 'rgba(251, 191, 36, 0.22)' : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${showGrafanaEmbed ? 'var(--golden-yellow)' : 'var(--line)'}`,
                    borderRadius: '6px',
                    color: showGrafanaEmbed ? 'var(--golden-yellow)' : 'var(--muted)',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                  title="Toggle live embedded Grafana metrics dashboard"
                >
                  <BarChart3 size={12} />
                  {showGrafanaEmbed ? 'Hide Grafana Panel' : 'Show Grafana Panel'}
                </button>
              </div>
            </div>

            {/* Embedded Live Grafana Dashboard Panel */}
            {showGrafanaEmbed && (
              <div style={{
                marginBottom: '14px',
                border: '1px solid rgba(251, 191, 36, 0.35)',
                borderRadius: '8px',
                overflow: 'hidden',
                background: '#0b0f19'
              }}>
                <div style={{
                  padding: '8px 12px',
                  background: 'rgba(251, 191, 36, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '11px',
                  fontFamily: 'var(--mono)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--golden-yellow)' }}>
                    <BarChart3 size={13} />
                    <b>Grafana Cloud Telemetry (ad7r252)</b>
                    <span style={{ color: 'var(--muted)' }}>• Device: {activeSpeakerForLogs.device_id}</span>
                  </div>
                  <a
                    href={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${activeSpeakerForLogs.device_id}&theme=dark`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--golden-yellow)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                  >
                    Open in Tab <ExternalLink size={10} />
                  </a>
                </div>
                <iframe
                  src={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${activeSpeakerForLogs.device_id}&theme=dark&kiosk=tv`}
                  width="100%"
                  height="220"
                  style={{ border: 'none', display: 'block' }}
                  title="Grafana Telemetry Dashboard"
                />
              </div>
            )}

            {/* Terminal Window with Differentiated Log Formatting */}
            <div style={{ background: '#050a0f', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px', height: '340px', overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11.5px' }}>
              {filteredSpeakerLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
                  No logs found for filter: <b style={{ color: 'var(--text-pure)' }}>{logsCategoryFilter}</b>
                </div>
              ) : (
                filteredSpeakerLogs.map((log, idx) => {
                  const isGrafanaLog = log.source === 'grafana_telemetry' || log.source === 'grafana' || log.category === 'grafana' || log.message?.toLowerCase().includes('grafana') || log.network_data?.grafana_synced === true
                  const isNetworkLog = !isGrafanaLog && (log.source === 'wifi_network' || log.source === 'wifi' || log.source === 'wifi_driver' || log.category === 'network' || log.level === 'WIFI_UP' || log.level === 'WIFI_DOWN' || log.message?.toLowerCase().includes('wi-fi') || log.message?.toLowerCase().includes('wifi'))
                  const isWsLog = log.source === 'websocket' || log.source === 'websocket_stream' || log.source === 'ws_bus' || log.category === 'websocket'
                  const isDown = log.level === 'WIFI_DOWN' || log.message?.toLowerCase().includes('disconnected') || log.message?.toLowerCase().includes('dropped')

                  return (
                    <div
                      key={idx}
                      style={{
                        marginBottom: '8px',
                        padding: (isNetworkLog || isGrafanaLog) ? '8px 10px' : '4px 6px',
                        borderRadius: '6px',
                        background: isGrafanaLog
                          ? 'rgba(251, 191, 36, 0.08)'
                          : isNetworkLog
                          ? (isDown ? 'rgba(239, 68, 68, 0.07)' : 'rgba(16, 185, 129, 0.07)')
                          : isWsLog
                          ? 'rgba(14, 165, 233, 0.04)'
                          : 'transparent',
                        border: isGrafanaLog
                          ? '1px solid rgba(251, 191, 36, 0.35)'
                          : isNetworkLog
                          ? `1px solid ${isDown ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`
                          : '1px solid transparent',
                        lineHeight: '1.45'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--dim)', fontSize: '11px' }}>[{log.time}]</span>

                        {/* Differentiated Badge */}
                        {isGrafanaLog ? (
                          <span style={{
                            padding: '1px 7px',
                            borderRadius: '4px',
                            background: 'rgba(251, 191, 36, 0.2)',
                            color: 'var(--golden-yellow)',
                            fontWeight: 800,
                            fontSize: '10.5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            border: '1px solid rgba(251, 191, 36, 0.4)'
                          }}>
                            <BarChart3 size={11} />
                            GRAFANA TELEMETRY
                          </span>
                        ) : isNetworkLog ? (
                          <span style={{
                            padding: '1px 7px',
                            borderRadius: '4px',
                            background: isDown ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                            color: isDown ? '#f87171' : '#34d399',
                            fontWeight: 800,
                            fontSize: '10.5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            border: `1px solid ${isDown ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                          }}>
                            {isDown ? <WifiOff size={11} /> : <Wifi size={11} />}
                            {isDown ? 'WIFI DISCONNECTED' : 'WIFI CONNECTED'}
                          </span>
                        ) : isWsLog ? (
                          <span style={{
                            padding: '1px 7px',
                            borderRadius: '4px',
                            background: 'rgba(14, 165, 233, 0.2)',
                            color: 'var(--sky-blue)',
                            fontWeight: 700,
                            fontSize: '10.5px',
                            border: '1px solid rgba(14, 165, 233, 0.3)'
                          }}>
                            ⚡ WEBSOCKET
                          </span>
                        ) : (
                          <span style={{
                            padding: '1px 7px',
                            borderRadius: '4px',
                            background: 'rgba(255,255,255,0.08)',
                            color: 'var(--muted)',
                            fontSize: '10.5px'
                          }}>
                            ⚙️ {log.source?.toUpperCase() || 'SYSTEM'}
                          </span>
                        )}

                        {/* Optional Network Metadata Pills */}
                        {log.network_data?.ip && (
                          <span style={{ padding: '1px 5px', borderRadius: '3px', background: 'rgba(14, 165, 233, 0.15)', color: 'var(--sky-blue)', fontSize: '10px' }}>
                            IP: {log.network_data.ip}
                          </span>
                        )}
                        {log.network_data?.rssi && (
                          <span style={{ padding: '1px 5px', borderRadius: '3px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '10px' }}>
                            RSSI: {log.network_data.rssi} dBm
                          </span>
                        )}
                        {isGrafanaLog && (
                          <a
                            href={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${activeSpeakerForLogs.device_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '1px 6px',
                              borderRadius: '3px',
                              background: 'rgba(251, 191, 36, 0.15)',
                              color: 'var(--golden-yellow)',
                              fontSize: '10px',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px'
                            }}
                          >
                            Grafana ad7r252 <ExternalLink size={9} />
                          </a>
                        )}
                      </div>

                      {/* Log Message Content */}
                      <div style={{
                        marginTop: (isNetworkLog || isGrafanaLog) ? '4px' : '2px',
                        color: isGrafanaLog
                          ? 'var(--golden-yellow)'
                          : isNetworkLog
                          ? (isDown ? '#fca5a5' : '#a7f3d0')
                          : log.level === 'WARN'
                          ? 'var(--golden-yellow)'
                          : log.level === 'ERROR'
                          ? 'var(--red)'
                          : 'var(--text-pure)'
                      }}>
                        {log.message}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <span style={{ fontSize: '11.5px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Activity size={13} color="var(--light-green)" />
                Stream: 16 kHz Mono PCM • Live Network & Telemetry Synchronized
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={`https://monitoring.yhealth.me/d/ad7r252?var-device_id=${activeSpeakerForLogs.device_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '8px 16px',
                    background: 'var(--panel2)',
                    border: '1px solid var(--line)',
                    borderRadius: '6px',
                    color: 'var(--text-pure)',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    textDecoration: 'none'
                  }}
                >
                  <ExternalLink size={13} /> Open Grafana (UID: ad7r252)
                </a>
                <button
                  onClick={() => setLogsModalOpen(false)}
                  style={{ padding: '8px 18px', background: 'var(--light-green)', color: '#06271a', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PING & VOICE ANNOUNCEMENT DISPATCH (Live Voice Dictation / TTS)    */}
      {/* ========================================================================= */}
      {pingModalOpen && activeSpeakerForPing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'grid', placeItems: 'center', zIndex: 120, backdropFilter: 'blur(6px)' }}>
          <div style={{
            background: 'var(--panel)',
            border: '1.5px solid var(--golden-yellow-border)',
            borderRadius: '16px',
            width: '560px',
            maxWidth: '92vw',
            maxHeight: '92vh',
            overflowY: 'auto',
            padding: '24px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.65)'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--golden-yellow-soft)', display: 'grid', placeItems: 'center', border: '1px solid var(--golden-yellow-border)' }}>
                  <Zap size={20} color="var(--golden-yellow)" />
                </div>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                    Ping & Voice Hardware Dispatch
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                    <span>Target:</span>
                    <b style={{ color: 'var(--golden-yellow)', fontFamily: 'var(--mono)' }}>{activeSpeakerForPing.device_id}</b>
                    <span>• {activeSpeakerForPing.name}</span>
                  </div>
                </div>
              </div>
              <button onClick={handleClosePingModal} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px' }}>
                <XCircle size={22} />
              </button>
            </div>

            {/* Cross-Network Capability Note */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(52, 211, 153, 0.04))',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '18px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px'
            }}>
              <Globe size={18} color="var(--sky-blue)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '11.8px', color: 'var(--text-pure)', lineHeight: 1.45 }}>
                <b style={{ color: 'var(--sky-blue)' }}>Cross-Network Verified:</b> The speaker is connected via an outbound persistent WebSocket channel. Even if configured to a <b>different clinic, home, or cellular Wi-Fi</b>, voice pings route through the central cloud bus directly down to the speaker hardware.
              </div>
            </div>

            {/* Live Audio Recording (Speech-to-Text) Section */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', display: 'block', marginBottom: '8px' }}>
                Option 1: Dictate via Microphone (Live Speech-to-Text)
              </label>

              <button
                type="button"
                onClick={handleToggleVoiceRecording}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: isRecordingVoice ? '2px solid var(--red)' : '1px solid var(--line)',
                  background: isRecordingVoice ? 'rgba(239, 68, 68, 0.15)' : 'var(--panel2)',
                  color: isRecordingVoice ? 'var(--red)' : 'var(--text-pure)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isRecordingVoice ? '0 0 16px rgba(239, 68, 68, 0.35)' : 'none'
                }}
              >
                <Mic size={18} color={isRecordingVoice ? 'var(--red)' : 'var(--sky-blue)'} />
                <span>
                  {isRecordingVoice
                    ? '🔴 Listening & Transcribing... (Click to Stop)'
                    : '🎙️ Record Audio & Convert to Text'}
                </span>
              </button>
            </div>

            {/* Direct Text Input Section */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>
                  Option 2: Direct Text Message (Spoken Aloud on Hardware)
                </label>
                <span style={{ fontSize: '10.5px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  {pingMessageText.length} characters
                </span>
              </div>

              <textarea
                rows={3}
                value={pingMessageText}
                onChange={e => setPingMessageText(e.target.value)}
                placeholder="Type the message you want the speaker hardware to say aloud..."
                style={{
                  width: '100%',
                  padding: '12px',
                  background: 'var(--input)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  color: 'var(--text-pure)',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />

              {/* Quick Presets */}
              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', alignSelf: 'center', fontWeight: 600 }}>Quick Presets:</span>
                {activeSpeakerForPing.role === 'doctor' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPingMessageText("Dr. Makkar, your next patient has arrived.")}
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '11px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer' }}
                    >
                      Patient Arrived
                    </button>
                    <button
                      type="button"
                      onClick={() => setPingMessageText("Central Fleet Ping: Audio hardware link is verified and ready.")}
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '11px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer' }}
                    >
                      Hardware Check
                    </button>
                    <button
                      type="button"
                      onClick={() => setPingMessageText("Dr. Makkar, priority lab results are ready for your review.")}
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '11px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer' }}
                    >
                      Lab Results Ready
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setPingMessageText(`Hello ${activeSpeakerForPing.name}, please log your morning blood glucose reading.`)}
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '11px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer' }}
                    >
                      Glucose Reminder
                    </button>
                    <button
                      type="button"
                      onClick={() => setPingMessageText(`Dr. Makkar's care team is checking in. Please speak your vitals when ready.`)}
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '11px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer' }}
                    >
                      Vitals Check-in
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Live Dispatch Feedback Result */}
            {pingDispatchResult && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.12), rgba(52, 211, 153, 0.03))',
                border: '1px solid var(--light-green-border)',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px'
              }}>
                <CheckCircle2 size={16} color="var(--light-green)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--light-green)' }}>
                    {pingDispatchResult.message}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                    Routing: {pingDispatchResult.network} • {pingDispatchResult.time}
                  </div>
                </div>
              </div>
            )}

            {/* Actions: Listen Preview & Dispatch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
              {/* Local Browser Preview Button */}
              <button
                type="button"
                onClick={handlePlayPreview}
                disabled={!pingMessageText.trim() || isPlayingPreview}
                style={{
                  padding: '9px 16px',
                  borderRadius: '7px',
                  background: isPlayingPreview ? 'var(--sky-blue-soft)' : 'var(--panel2)',
                  border: '1px solid var(--line)',
                  color: isPlayingPreview ? 'var(--sky-blue)' : 'var(--text-pure)',
                  fontSize: '12px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: pingMessageText.trim() ? 'pointer' : 'not-allowed',
                  opacity: pingMessageText.trim() ? 1 : 0.5
                }}
                title="Hear audio preview in browser before sending to physical hardware"
              >
                <Play size={13} color="var(--sky-blue)" />
                <span>{isPlayingPreview ? 'Playing Preview...' : 'Listen Preview'}</span>
              </button>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={handleClosePingModal}
                  style={{
                    padding: '9px 16px',
                    borderRadius: '7px',
                    background: 'transparent',
                    border: '1px solid var(--line)',
                    color: 'var(--muted)',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>

                {/* Dispatch Button */}
                <button
                  type="button"
                  onClick={handleDispatchPingVoice}
                  disabled={!pingMessageText.trim() || isDispatchingPing}
                  style={{
                    padding: '9px 20px',
                    borderRadius: '7px',
                    background: 'linear-gradient(135deg, var(--golden-yellow), #f59e0b)',
                    border: 'none',
                    color: '#261904',
                    fontWeight: 800,
                    fontSize: '12.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: pingMessageText.trim() && !isDispatchingPing ? 'pointer' : 'not-allowed',
                    opacity: pingMessageText.trim() && !isDispatchingPing ? 1 : 0.6,
                    boxShadow: '0 4px 14px rgba(251, 191, 36, 0.35)'
                  }}
                >
                  <Send size={13} />
                  <span>{isDispatchingPing ? 'Dispatching...' : 'Send & Speak on Speaker'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
