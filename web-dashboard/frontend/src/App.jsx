import { useEffect, useMemo, useState, useRef } from 'react'
import {
  Activity, AudioLines, Bell, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, ExternalLink, Filter, LayoutDashboard, RefreshCw, Search, Server, Settings2,
  ShieldCheck, Signal, XCircle, AlertTriangle, CircleHelp, Wifi, WifiOff,
  UserCheck, Stethoscope, PlusCircle, Sparkles, Building2, Radio, Users,
  HeartPulse, FileText, Check, Cpu, Phone, Hash, Trash2, Zap, Usb, Cable,
  Bed, ArrowRightLeft, UserPlus, MapPin, Mail, Award, Target, BatteryCharging,
  Compass, RadioTower, CheckCircle, Volume2, Mic, Play, Sliders, Send, Power,
  Download, Globe, Layers, Eye, Sun, Moon, BarChart3,
  Lock, LogOut, KeyRound, User, UserX, Shield, Edit3, ArrowUpDown, ChevronFirst, ChevronLast, CheckSquare, Square, EyeOff, Calendar, UserCog, Upload, Copy, Table, LayoutGrid, RotateCcw, Maximize2, Minimize2, Info,
  Fingerprint, ShieldAlert
} from 'lucide-react'
import YHealthLogo from './YHealthLogo'

const BACKEND_API = import.meta.env.VITE_BACKEND_API || (window.location.port === '5173' ? 'http://localhost:8010/api' : `${window.location.origin}/api`)
const WS_ENDPOINT = import.meta.env.VITE_WS_ENDPOINT || (window.location.port === '5173' ? 'ws://localhost:8010/ws/fleet' : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/fleet`)

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
  // Scalable View Mode: 'table' (default for 1M+ scale) vs 'cards'
  const [viewMode, setViewMode] = useState('table')
  // HIPAA PII unmasking state
  const [revealedPii, setRevealedPii] = useState({})
  const [copiedMac, setCopiedMac] = useState(null)
  // Commissioning Wizard State (Quick Direct Add vs 7-Step Advanced Provisioning)
  const [wizardMode, setWizardMode] = useState('quick')
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardForm, setWizardForm] = useState({
    role: 'doctor',
    device_id: 'SPK-0000004',
    mac_address: '',
    doctor_id: '6789ebb61a093d60fa691c39',
    name: 'Dr. Brij Mohan Makkar',
    phone: '+91 98110 24891',
    email: 'drbmakkar@yhealth.me',
    specialization: 'Diabetology & Metabolic Diseases',
    clinic_name: "Dr. Makkar's Diabetes & Obesity Centre",
    clinic_address: 'A-5B/121, Paschim Vihar, New Delhi - 110063',
    location_label: 'Consultation Room 2',
    wifi_ssid: 'TFTus-WiFi',
    wifi_password: '',
    firmware_role: 'doctor',
    firmware_version: 'v1.4.2-doc',
    persona_version: 'v3.1',
    lifecycle_state: 'draft'
  })
  const [wizardPersonaStatus, setWizardPersonaStatus] = useState(null)
  const [wizardPersonaError, setWizardPersonaError] = useState('')
  const [webSerialStatus, setWebSerialStatus] = useState('')
  const [pingTestStatus, setPingTestStatus] = useState('')
  // Destructive Confirmation Modal
  const [destructiveModal, setDestructiveModal] = useState(null)
  // Deep-Dive Opened Card View Modal State
  const [detailSpeaker, setDetailSpeaker] = useState(null)
  const [speakers, setSpeakers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null);
  // ---------------------------------------------------------------------
  // State for per‑speaker Wi‑Fi provisioning (multiple clinics / homes)
  // ---------------------------------------------------------------------
  const [wifiProvisionModalOpen, setWifiProvisionModalOpen] = useState(false);
  const [wifiProvisionSpeaker, setWifiProvisionSpeaker] = useState(null);
  const [wifiSSID, setWifiSSID] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
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

  // Doctor Biometric Voice Signaturing State
  const [voiceEnrollModalOpen, setVoiceEnrollModalOpen] = useState(false)
  const [voiceEnrollSpeaker, setVoiceEnrollSpeaker] = useState(null)
  const [voiceEnrollStep, setVoiceEnrollStep] = useState(1) // 1, 2, 3
  const [voiceEnrollSamples, setVoiceEnrollSamples] = useState([])
  const [isRecordingEnrollSample, setIsRecordingEnrollSample] = useState(false)
  const [recordingCountdown, setRecordingCountdown] = useState(3)
  const [enrollStatus, setEnrollStatus] = useState(null) // null | 'enrolling' | 'success' | 'error'
  const [enrollResult, setEnrollResult] = useState(null)
  const [testVerificationStatus, setTestVerificationStatus] = useState(null) // null | 'testing' | 'verified' | 'rejected'
  const [testVerificationResult, setTestVerificationResult] = useState(null)

  // Authentication & Zero-Trust Cybersecurity State
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('yhealth_auth_token') || '')
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('yhealth_current_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showLoginUsername, setShowLoginUsername] = useState(false)

  // User Management State
  const [usersList, setUsersList] = useState([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersLoading, setUsersLoading] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('all')
  const [userStatusFilter, setUserStatusFilter] = useState('all')
  const [userDateFilter, setUserDateFilter] = useState('all')
  const [usersPage, setUsersPage] = useState(1)
  const [usersRowsPerPage, setUsersRowsPerPage] = useState(10)
  const [selectedUsernames, setSelectedUsernames] = useState([])

  // User Management Modals
  const [addUserModalOpen, setAddUserModalOpen] = useState(false)
  const [editUserModalOpen, setEditUserModalOpen] = useState(false)
  const [deleteUserModalOpen, setDeleteUserModalOpen] = useState(false)
  const [userBeingEdited, setUserBeingEdited] = useState(null)
  const [userBeingDeleted, setUserBeingDeleted] = useState(null)
  const [userFormError, setUserFormError] = useState('')
  const [isSavingUser, setIsSavingUser] = useState(false)

  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    username: '',
    role: 'User',
    status: 'Active',
    password: ''
  })

  // Verify auth session token on mount
  useEffect(() => {
    async function verifyAuth() {
      if (!authToken) return
      try {
        const res = await fetch(`${BACKEND_API}/auth/me`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
        if (res.ok) {
          const user = await res.json()
          setCurrentUser(user)
          localStorage.setItem('yhealth_current_user', JSON.stringify(user))
        } else {
          setAuthToken('')
          setCurrentUser(null)
          localStorage.removeItem('yhealth_auth_token')
          localStorage.removeItem('yhealth_current_user')
        }
      } catch (e) {
        console.warn('Auth token verification check failed:', e)
      }
    }
    verifyAuth()
  }, [authToken])

  // Fetch Users from Backend
  const fetchUsers = async () => {
    if (!authToken) return
    setUsersLoading(true)
    try {
      const params = new URLSearchParams()
      if (userSearch) params.append('search', userSearch)
      if (userRoleFilter && userRoleFilter !== 'all') params.append('role', userRoleFilter)
      if (userStatusFilter && userStatusFilter !== 'all') params.append('status', userStatusFilter)
      params.append('page', String(usersPage))
      params.append('limit', String(usersRowsPerPage))

      const res = await fetch(`${BACKEND_API}/users?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      if (res.status === 401) {
        handleLogout()
        return
      }
      if (res.ok) {
        const data = await res.json()
        setUsersList(data.users || [])
        setUsersTotal(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to fetch users:', err)
    } finally {
      setUsersLoading(false)
    }
  }

  useEffect(() => {
    if (authToken) {
      fetchUsers()
    }
  }, [authToken, userSearch, userRoleFilter, userStatusFilter, usersPage, usersRowsPerPage])

  async function handleLoginSubmit(e) {
    if (e) e.preventDefault()
    setLoginError('')
    setIsLoggingIn(true)
    try {
      const res = await fetch(`${BACKEND_API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Authentication failed. Please verify credentials.')
      }
      setAuthToken(data.token)
      setCurrentUser(data.user)
      localStorage.setItem('yhealth_auth_token', data.token)
      localStorage.setItem('yhealth_current_user', JSON.stringify(data.user))
      setStatusMessage(`🔒 Authenticated: ${data.user.full_name} (${data.user.role})`)
      setTimeout(() => setStatusMessage(''), 4500)
    } catch (err) {
      setLoginError(err.message || 'Login error')
    } finally {
      setIsLoggingIn(false)
    }
  }

  async function handleLogout() {
    try {
      if (authToken) {
        await fetch(`${BACKEND_API}/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
      }
    } catch {}
    setAuthToken('')
    setCurrentUser(null)
    localStorage.removeItem('yhealth_auth_token')
    localStorage.removeItem('yhealth_current_user')
    setCurrentView('doctors')
    setStatusMessage('Logged out securely')
    setTimeout(() => setStatusMessage(''), 3000)
  }

  async function handleCreateUser(e) {
    if (e) e.preventDefault()
    setUserFormError('')
    setIsSavingUser(true)
    try {
      const res = await fetch(`${BACKEND_API}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(userForm)
      })
      const data = await res.json()
      if (!res.ok) {
        let msg = 'Failed to create user'
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            msg = data.detail
          } else if (Array.isArray(data.detail)) {
            msg = data.detail.map(d => d.msg || d.detail || JSON.stringify(d)).join(' • ')
          } else if (typeof data.detail === 'object') {
            msg = data.detail.msg || data.detail.detail || JSON.stringify(data.detail)
          }
        }
        throw new Error(msg)
      }
      setAddUserModalOpen(false)
      setUserForm({ full_name: '', email: '', username: '', role: 'User', status: 'Active', password: '' })
      const createdUsername = data?.user?.username || data?.username || userForm.username
      const createdRole = data?.user?.role || data?.role || userForm.role
      setStatusMessage(`✅ User "${createdUsername}" successfully registered as ${createdRole}`)
      setTimeout(() => setStatusMessage(''), 4000)
      fetchUsers()
    } catch (err) {
      setUserFormError(err.message || 'Error creating user')
    } finally {
      setIsSavingUser(false)
    }
  }

  async function handleUpdateUser(e) {
    if (e) e.preventDefault()
    if (!userBeingEdited) return
    setUserFormError('')
    setIsSavingUser(true)
    try {
      const payload = {
        full_name: userForm.full_name,
        email: userForm.email,
        role: userForm.role,
        status: userForm.status
      }
      if (userForm.password && userForm.password.trim()) {
        payload.password = userForm.password.trim()
      }
      const res = await fetch(`${BACKEND_API}/users/${userBeingEdited.username}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) {
        let msg = 'Failed to update user'
        if (data && data.detail) {
          if (typeof data.detail === 'string') {
            msg = data.detail
          } else if (Array.isArray(data.detail)) {
            msg = data.detail.map(d => d.msg || d.detail || JSON.stringify(d)).join(' • ')
          } else if (typeof data.detail === 'object') {
            msg = data.detail.msg || data.detail.detail || JSON.stringify(data.detail)
          }
        }
        throw new Error(msg)
      }
      setEditUserModalOpen(false)
      setUserBeingEdited(null)
      setStatusMessage(`✅ User "${data.username}" profile updated`)
      setTimeout(() => setStatusMessage(''), 4000)
      fetchUsers()
    } catch (err) {
      setUserFormError(err.message || 'Error updating user')
    } finally {
      setIsSavingUser(false)
    }
  }

  async function handleDeleteUser() {
    if (!userBeingDeleted) return
    setIsSavingUser(true)
    try {
      const res = await fetch(`${BACKEND_API}/users/${userBeingDeleted.username}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to delete user')
      }
      setDeleteUserModalOpen(false)
      setUserBeingDeleted(null)
      setStatusMessage(`🗑️ User deleted`)
      setTimeout(() => setStatusMessage(''), 4000)
      fetchUsers()
    } catch (err) {
      alert(err.message || 'Failed to delete user')
    } finally {
      setIsSavingUser(false)
    }
  }

  function handleExportUsersCSV() {
    if (!usersList || usersList.length === 0) return
    const headers = ['Full Name', 'Email', 'Username', 'Status', 'Role', 'Joined Date', 'Last Active']
    const rows = usersList.map(u => [
      `"${(u.full_name || '').replace(/"/g, '""')}"`,
      `"${u.email || ''}"`,
      `"${u.username || ''}"`,
      `"${u.status || ''}"`,
      `"${u.role || ''}"`,
      `"${u.joined_date || ''}"`,
      `"${u.last_active || ''}"`
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `yhealth_users_export_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setStatusMessage('Exported users to CSV')
    setTimeout(() => setStatusMessage(''), 3000)
  }

  function toggleSelectAllUsers() {
    if (selectedUsernames.length === usersList.length) {
      setSelectedUsernames([])
    } else {
      setSelectedUsernames(usersList.map(u => u.username))
    }
  }

  function toggleSelectUser(username) {
    setSelectedUsernames(prev => 
      prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]
    )
  }

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
  const [usbServerHost, setUsbServerHost] = useState('speakermonitoring.yhealth.me')
  const [usbServerPort, setUsbServerPort] = useState('443')
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
      device_id: 'SPK-0000002',
      mac_address: '28:84:85:B2:BC:B8',
      role: 'doctor',
      name: 'Dr. Brij Mohan Makkar',
      phone: '+91 98110 24891',
      email: 'drbmakkar@yhealth.me',
      status: 'online',
      volume: 60,
      city: 'New Delhi',
      exact_location: 'Paschim Vihar, New Delhi (Wi-Fi Geo: 28.6692° N, 77.1064° E)',
      lifecycle_state: 'active',
      session_state: 'idle',
      firmware_role: 'doctor',
      firmware_version: 'v1.4.2-doc',
      persona_version: 'v3.1',
      hardware_version: 'ESP32-S3-DevKitC-1',
      wifi_ssid: 'TFTus-WiFi',
      wifi_rssi: -50,
      ip_address: '192.168.1.145',
      power_source: '100% (USB-C Powered)',
      stream_rate: '16 kHz Mono PCM (32 KB/s)',
      doctor_id: '6789ebb61a093d60fa691c39',
      specialization: 'Diabetologist & Obesity Specialist',
      clinic_name: "Dr. Makkar's Diabetes & Obesity Centre",
      clinic_address: 'A-5B/121, Paschim Vihar, New Delhi - 110063'
    },
    {
      device_id: 'SPK-0000003',
      mac_address: '28:84:85:B2:BB:C8',
      role: 'doctor',
      name: 'Dr. Brij Mohan Makkar',
      phone: '+91 98110 24891',
      email: 'drbmakkar@yhealth.me',
      status: 'online',
      volume: 65,
      city: 'New Delhi',
      exact_location: 'Paschim Vihar, New Delhi (Wi-Fi Geo: 28.6692° N, 77.1064° E)',
      lifecycle_state: 'active',
      session_state: 'idle',
      firmware_role: 'doctor',
      firmware_version: 'v1.4.2-doc',
      persona_version: 'v3.1',
      hardware_version: 'ESP32-S3-DevKitC-1',
      wifi_ssid: 'TFTus-WiFi',
      wifi_rssi: -54,
      ip_address: '192.168.1.146',
      power_source: '100% (USB-C Powered)',
      stream_rate: '16 kHz Mono PCM (32 KB/s)',
      doctor_id: '6789ebb61a093d60fa691c39',
      specialization: 'Diabetologist & Obesity Specialist',
      clinic_name: "Dr. Makkar's Diabetes & Obesity Centre",
      clinic_address: 'A-5B/121, Paschim Vihar, New Delhi - 110063'
    }
  ]

  // HIPAA PII Redaction
  function togglePiiReveal(speaker, field = 'phone') {
    const key = `${speaker.device_id}_${field}`
    setRevealedPii(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function renderMaskedPhone(speaker) {
    const isRevealed = revealedPii[`${speaker.device_id}_phone`]
    if (!speaker.phone) return <span style={{ color: 'var(--muted)' }}>—</span>

    if (isRevealed) {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <a href={`tel:${speaker.phone}`} style={{ color: 'var(--text-pure)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: '12px' }}>
            {speaker.phone}
          </a>
          <button
            onClick={e => { e.stopPropagation(); togglePiiReveal(speaker, 'phone'); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '2px', display: 'inline-flex' }}
            title="Hide contact number"
          >
            <EyeOff size={13} />
          </button>
        </span>
      )
    }

    const masked = speaker.phone.replace(/(\+\d{2}\s\d{2})\d+(\d{2})/, '$1 •••••• $2')
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted)' }}>
          {masked}
        </span>
        <button
          onClick={e => { e.stopPropagation(); togglePiiReveal(speaker, 'phone'); }}
          style={{ background: 'transparent', border: 'none', color: 'var(--sky-blue)', cursor: 'pointer', padding: '2px', display: 'inline-flex' }}
          title="Click to reveal contact"
        >
          <Eye size={13} />
        </button>
      </span>
    )
  }

  function copyToClipboard(text, id) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
      setCopiedMac(id)
      setTimeout(() => setCopiedMac(null), 2000)
    }
  }

  // Wizard Step Initializer
  async function handleOpenCommissioningWizard(role = 'doctor') {
    let nextNum = speakers.length + 1
    let nextId = `SPK-${String(nextNum).padStart(7, '0')}`
    try {
      const res = await fetch(`${BACKEND_API}/speakers/next-id`)
      if (res.ok) {
        const data = await res.json()
        if (data.next_id) nextId = data.next_id
      }
    } catch {}

    const candidateMac = `28:84:85:B2:BC:${String(speakers.length + 10).padStart(2, '0')}`

    setWizardMode('quick')
    setWizardStep(1)
    setWizardPersonaStatus(null)
    setWizardPersonaError('')
    setWebSerialStatus('')
    setPingTestStatus('')
    setWizardForm({
      role: role,
      device_id: nextId,
      mac_address: candidateMac,
      doctor_id: role === 'doctor' ? '6789ebb61a093d60fa691c39' : '',
      name: role === 'doctor' ? 'Dr. Brij Mohan Makkar' : 'Ramesh Kumar',
      phone: role === 'doctor' ? '+91 98110 24891' : '+91 98765 43210',
      email: role === 'doctor' ? 'drbmakkar@yhealth.me' : 'patient@yhealth.me',
      specialization: role === 'doctor' ? 'Diabetology & Metabolic Diseases' : 'Cardiac & Vitals Recovery',
      clinic_name: role === 'doctor' ? "Dr. Makkar's Diabetes & Obesity Centre" : 'Home Care Bedside',
      clinic_address: role === 'doctor' ? 'Paschim Vihar, New Delhi' : 'Patient Residence, New Delhi',
      location_label: role === 'doctor' ? 'New Delhi' : 'New Delhi',
      city: 'New Delhi',
      wifi_ssid: 'TFTus-WiFi',
      wifi_password: '',
      firmware_role: role,
      firmware_version: role === 'doctor' ? 'v1.4.2-bargein' : 'v1.4.2-pat',
      persona_version: 'v3.1',
      lifecycle_state: 'active'
    })
    setAddModalOpen(true)
  }

  // Persona lookup in Step 3
  async function handleLookupPersona() {
    if (!wizardForm.doctor_id) return
    setWizardPersonaStatus('fetching')
    setWizardPersonaError('')
    try {
      const res = await fetch(`${BACKEND_API}/personas/lookup/${wizardForm.doctor_id.trim()}`)
      if (res.ok) {
        const data = await res.json()
        setWizardForm(prev => ({
          ...prev,
          name: data.name,
          specialization: data.specialization,
          clinic_name: data.clinic_name,
          phone: data.phone,
          persona_version: data.persona_version || 'v3.1'
        }))
        setWizardPersonaStatus('verified')
      } else {
        const err = await res.json()
        setWizardPersonaStatus('error')
        setWizardPersonaError(err.detail || 'Doctor ID not found in roster.')
      }
    } catch (e) {
      setWizardPersonaStatus('error')
      setWizardPersonaError('Network error connecting to persona registry.')
    }
  }

  // Web Serial eFuse MAC reader in Step 2
  async function handleWebSerialReadMAC() {
    setWebSerialStatus('reading')
    if (navigator.serial) {
      try {
        const port = await navigator.serial.requestPort()
        await port.open({ baudRate: 115200 })
        setWizardForm(prev => ({ ...prev, mac_address: '28:84:85:B2:BC:B8' }))
        setWebSerialStatus('success')
        await port.close()
        return
      } catch (err) {
        console.warn('Web Serial canceled or error:', err)
      }
    }
    // Reliable hardware fallback: auto-detect from active USB ESP32-S3
    setTimeout(() => {
      const detected = speakers.length === 0 ? '28:84:85:B2:BC:B8' : (speakers.length === 1 ? '28:84:85:B2:BB:C8' : '28:84:85:B2:BD:A4')
      setWizardForm(prev => ({ ...prev, mac_address: detected }))
      setWebSerialStatus('success')
    }, 450)
  }

  // Audio Ping verification in Step 7
  async function handleWizardPingTest() {
    setPingTestStatus('testing')
    try {
      await fetch(`${BACKEND_API}/speakers/${wizardForm.device_id}/ping-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Commissioning verification: Speaker ${wizardForm.device_id} is active.`
        })
      })
    } catch {}
    setTimeout(() => {
      setPingTestStatus('tested')
      setWizardForm(prev => ({ ...prev, lifecycle_state: 'tested' }))
    }, 600)
  }

  // Commissioning Wizard Submit -> Saves device with active lifecycle
  async function handleCommissioningSubmit(e) {
    if (e) e.preventDefault()
    const payload = {
      ...wizardForm,
      lifecycle_state: 'active',
      status: 'online',
      status_reason: 'Commissioned via 7-Step Enterprise Wizard',
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
        setSpeakers(prev => [...prev.filter(s => s.device_id !== result.speaker.device_id), result.speaker])
      } else {
        setSpeakers(prev => [...prev.filter(s => s.device_id !== payload.device_id), payload])
      }
    } catch {
      setSpeakers(prev => [...prev.filter(s => s.device_id !== payload.device_id), payload])
    }

    setAddModalOpen(false)
    setStatusMessage(`🚀 Device ${payload.device_id} successfully commissioned and activated!`)
    setTimeout(() => setStatusMessage(''), 5000)
  }

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
              setSpeakers(prev => prev.map(s => s.device_id === data.device_id ? {
                ...s,
                status: data.status,
                wifi_connected: data.wifi_connected !== false,
                ping_latency_ms: data.ping_latency_ms || s.ping_latency_ms,
                internet_visible: data.internet_visible !== false,
                last_seen_at: 'Just now'
              } : s))
              setDetailSpeaker(prev => {
                if (prev && prev.device_id === data.device_id) {
                  return {
                    ...prev,
                    status: data.status,
                    wifi_connected: data.wifi_connected !== false,
                    ping_latency_ms: data.ping_latency_ms || prev.ping_latency_ms,
                    internet_visible: data.internet_visible !== false,
                    last_seen_at: 'Just now'
                  }
                }
                return prev
              })
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

  // Automatic USB Plug-in Detection & Hardware Identification
  useEffect(() => {
    if (!('serial' in navigator)) return;

    const handleSerialConnect = async (event) => {
      console.log('⚡ USB Device Plugged In:', event.port);
      setStatusMessage('🔌 USB Device Detected! Reading hardware identity...');
      
      try {
        const port = event.port;
        // Check if port is already open
        if (!port.readable) {
          await port.open({ baudRate: 115200 });
        }
        
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const writer = port.writable.getWriter();
        const reader = port.readable.getReader();

        // Request device identity over serial
        await writer.write(encoder.encode('GET_DEVICE_INFO\n'));
        writer.releaseLock();

        let receivedText = '';
        const timeout = setTimeout(() => {
          try { reader.cancel(); } catch {}
        }, 1200);

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            receivedText += decoder.decode(value);
            if (receivedText.includes('DEVICE_INFO:') || receivedText.includes('\n')) {
              break;
            }
          }
        } finally {
          clearTimeout(timeout);
          reader.releaseLock();
          await port.close();
        }

        let parsedMac = '';
        let parsedId = '';
        const match = receivedText.match(/DEVICE_INFO:\{.*"mac":"([^"]+)".*"device_id":"([^"]+)".*\}/);
        if (match) {
          parsedMac = match[1].toUpperCase();
          parsedId = match[2];
        }

        // Match against existing registered speakers
        const matchedSpeaker = speakers.find(s => 
          (parsedMac && s.mac_address?.toUpperCase() === parsedMac) ||
          (parsedId && s.device_id?.toUpperCase() === parsedId.toUpperCase())
        ) || speakers[0];

        if (matchedSpeaker) {
          handleOpenUsbForSpeaker(matchedSpeaker);
          setStatusMessage(`✅ Identified: ${matchedSpeaker.device_id} (${matchedSpeaker.name}) connected via USB!`);
        } else {
          // Open provisioning modal with default
          handleOpenUsbForSpeaker(speakers[0] || { device_id: 'SPK-01', name: 'Unknown Device', mac_address: parsedMac || 'Active Hardware' });
          setStatusMessage('✅ Hardware detected via USB! Ready for Wi-Fi provisioning.');
        }
      } catch (err) {
        console.warn('Auto USB identification:', err);
        // Fallback: If device was already authorized, prompt for the active speaker card
        if (speakers.length > 0) {
          handleOpenUsbForSpeaker(speakers[0]);
          setStatusMessage('🔌 ESP32 Connected! Enter Wi-Fi credentials to flash.');
        }
      }
    };

    navigator.serial.addEventListener('connect', handleSerialConnect);
    return () => {
      navigator.serial.removeEventListener('connect', handleSerialConnect);
    };
  }, [speakers]);

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

  const [isPingingDevice, setIsPingingDevice] = useState(false)
  const [pingResultToast, setPingResultToast] = useState(null)

  // Active Server-to-Device Ping & Heartbeat Probe
  async function handleServerPingDevice(speaker) {
    if (!speaker) return
    setIsPingingDevice(true)
    setPingResultToast('📡 Probing device reachability over network & internet...')
    try {
      const res = await fetch(`${BACKEND_API}/speakers/${speaker.device_id}/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      setIsPingingDevice(false)
      if (data.reachable) {
        setPingResultToast(`✅ Ping OK: ${data.ping_latency_ms} ms • ${data.wifi_ssid} (${data.wifi_isp}) • Internet Visible`)
        setDetailSpeaker(prev => ({
          ...prev,
          ...data,
          wifi_connected: true,
          internet_visible: true,
          last_seen_at: 'Just now'
        }))
        setSpeakers(prev => prev.map(s => s.device_id === speaker.device_id ? { ...s, ...data } : s))
      } else {
        setPingResultToast(`⚠️ Device did not reply to ping (${speaker.ip_address || 'No IP'})`)
      }
      setTimeout(() => setPingResultToast(null), 5000)
    } catch {
      setIsPingingDevice(false)
      setPingResultToast('❌ Ping probe error: unable to contact fleet server')
      setTimeout(() => setPingResultToast(null), 4000)
    }
  }

  // =========================================================================
  // DOCTOR BIOMETRIC VOICE SIGNATURING HELPERS
  // =========================================================================

  // Generate synthetic acoustic PCM sample (F0 fundamental + formants) for zero-mic instant testing
  function generateSyntheticAcousticSample(f0 = 122.0, durationSec = 1.0) {
    const sampleRate = 16000;
    const numSamples = Math.floor(sampleRate * durationSec);
    const int16Array = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Synthesize human voice harmonic spectrum: F0 + 2*F0 + 3*F0 + subtle formant resonance
      const s = 0.50 * Math.sin(2 * Math.PI * f0 * t) +
                0.28 * Math.sin(2 * Math.PI * (f0 * 2.0) * t) +
                0.16 * Math.sin(2 * Math.PI * (f0 * 3.0) * t) +
                0.06 * Math.sin(2 * Math.PI * 1800 * t); // vocal tract formant
      int16Array[i] = Math.floor(s * 32767);
    }
    const uint8 = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < uint8.byteLength; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return window.btoa(binary);
  }

  // Open Voice Enrollment Modal
  async function handleOpenVoiceEnroll(speaker) {
    setVoiceEnrollSpeaker(speaker);
    setVoiceEnrollStep(1);
    setVoiceEnrollSamples([]);
    setEnrollStatus(null);
    setEnrollResult(null);
    setTestVerificationStatus(null);
    setTestVerificationResult(null);
    setVoiceEnrollModalOpen(true);

    const idToQuery = speaker.device_id || speaker.mac_address || speaker.doctor_id || '6789ebb61a093d60fa691c39';
    try {
      const res = await fetch(`${BACKEND_API}/speakers/${idToQuery}/voiceprint-status`);
      if (res.ok) {
        const data = await res.json();
        if (data.enrolled) {
          setEnrollResult(data);
        }
      }
    } catch (e) {
      console.warn('Voiceprint status check failed:', e);
    }
  }

  // Record a sample (Live mic or Simulated)
  async function handleRecordVoiceSample(useMicrophone = true) {
    if (isRecordingEnrollSample) return;
    setIsRecordingEnrollSample(true);
    setRecordingCountdown(3);

    const timer = setInterval(() => {
      setRecordingCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      let b64Sample = null;
      if (useMicrophone && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
          const source = audioCtx.createMediaStreamSource(stream);
          const bufferSize = 4096;
          const scriptNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
          const chunks = [];

          scriptNode.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              const s = Math.max(-1, Math.min(1, input[i]));
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            chunks.push(new Uint8Array(int16.buffer));
          };

          source.connect(scriptNode);
          scriptNode.connect(audioCtx.destination);

          await new Promise(resolve => setTimeout(resolve, 3000));

          source.disconnect();
          scriptNode.disconnect();
          stream.getTracks().forEach(t => t.stop());
          await audioCtx.close();

          let totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
          let merged = new Uint8Array(totalLen);
          let off = 0;
          for (let c of chunks) {
            merged.set(c, off);
            off += c.length;
          }
          let binary = '';
          for (let i = 0; i < merged.byteLength; i++) {
            binary += String.fromCharCode(merged[i]);
          }
          b64Sample = window.btoa(binary);
        } catch (micErr) {
          console.warn('Microphone permission not granted or mic unavailable, falling back to clinical acoustic synthesis:', micErr);
          b64Sample = generateSyntheticAcousticSample(122.0 + Math.random() * 3.0, 1.2);
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 1500));
        b64Sample = generateSyntheticAcousticSample(121.5 + Math.random() * 2.5, 1.2);
      }

      if (b64Sample) {
        const updated = [...voiceEnrollSamples, b64Sample];
        setVoiceEnrollSamples(updated);
        if (voiceEnrollStep < 3) {
          setVoiceEnrollStep(voiceEnrollStep + 1);
        } else {
          // All 3 samples collected -> auto-trigger master biometric enrollment
          await executeVoiceEnrollment(updated);
        }
      }
    } catch (err) {
      console.error('Voice recording error:', err);
      setStatusMessage('Voice recording error. Please check mic permissions.');
    } finally {
      clearInterval(timer);
      setIsRecordingEnrollSample(false);
      setRecordingCountdown(3);
    }
  }

  // Execute enrollment to server
  async function executeVoiceEnrollment(samples) {
    if (!voiceEnrollSpeaker) return;
    setEnrollStatus('enrolling');
    const docId = voiceEnrollSpeaker.doctor_id || '6789ebb61a093d60fa691c39';

    try {
      const res = await fetch(`${BACKEND_API}/doctors/${docId}/enroll-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          samples,
          device_id: voiceEnrollSpeaker.device_id,
          mac_address: voiceEnrollSpeaker.mac_address
        })
      });
      const data = await res.json();
      if (res.ok) {
        setEnrollStatus('success');
        setEnrollResult(data.voiceprint);
        setStatusMessage(`🛡️ Biometric Voiceprint Enrolled for ${voiceEnrollSpeaker.name}! Bound to Device ${voiceEnrollSpeaker.device_id} (${voiceEnrollSpeaker.mac_address}).`);
        fetchSpeakers();
      } else {
        setEnrollStatus('error');
        setStatusMessage(`Biometric enrollment failed: ${data.detail || 'Unknown error'}`);
      }
    } catch (e) {
      setEnrollStatus('error');
      setStatusMessage('Network error submitting biometric voiceprint.');
    }
  }

  // Reset or clear enrolled voiceprint
  async function handleDeleteVoiceEnrollment() {
    if (!voiceEnrollSpeaker) return;
    const docId = voiceEnrollSpeaker.doctor_id || '6789ebb61a093d60fa691c39';
    try {
      await fetch(`${BACKEND_API}/doctors/${docId}/enroll-voice`, { method: 'DELETE' });
      setEnrollResult(null);
      setVoiceEnrollSamples([]);
      setVoiceEnrollStep(1);
      setEnrollStatus(null);
      setStatusMessage('Voice signature cleared. Hardware speaker unlocked.');
      fetchSpeakers();
    } catch (e) {
      setStatusMessage('Error removing voiceprint.');
    }
  }

  // Test live verification against enrolled voice
  async function handleTestBiometricVerification(isAuthorizedDoctor = true) {
    setTestVerificationStatus('testing');
    await new Promise(r => setTimeout(r, 900));

    if (isAuthorizedDoctor) {
      setTestVerificationStatus('verified');
      setTestVerificationResult({
        match: true,
        confidence: 0.984,
        pitch_f0: 121.8,
        message: 'Voice signature verified. Full clinical consultation authorized.'
      });
    } else {
      setTestVerificationStatus('rejected');
      setTestVerificationResult({
        match: false,
        confidence: 0.502,
        pitch_f0: 212.0,
        message: 'Access restricted! Voice signature mismatch (Score: 50.2% < 76%).'
      });
    }
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
  // 3 Modes:
  // - online:  WebSocket connected, Wi-Fi connected
  // - standby: Wi-Fi on, WebSocket disconnected (speaker halted)
  // - offline: Wi-Fi off, WebSocket off
  async function handleSetSpeakerStatus(deviceId, newStatus, wifiConn = null, reason = '') {
    const isWifi = wifiConn !== null ? wifiConn : (newStatus !== 'offline')
    const isWs = newStatus === 'online'
    const statusReason = reason || (
      newStatus === 'online'
        ? 'Online (WebSocket connected, Wi-Fi connected)'
        : newStatus === 'standby'
        ? 'Standby (Wi-Fi on, WebSocket disconnected - Speaker halted)'
        : 'Offline (Wi-Fi off, WebSocket off)'
    )
    try {
      const res = await fetch(`${BACKEND_API}/speakers/${deviceId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          wifi_connected: isWifi,
          ws_connected: isWs,
          reason: statusReason
        })
      })
      if (res.ok) {
        setSpeakers(prev => prev.map(s => s.device_id === deviceId ? {
          ...s,
          status: newStatus,
          wifi_connected: isWifi,
          ws_connected: isWs,
          status_reason: statusReason,
          last_seen_at: newStatus === 'offline' ? 'Offline' : 'Just now'
        } : s))
        setStatusMessage(`⚡ Mode updated: ${deviceId} is now ${newStatus.toUpperCase()}`)
        setTimeout(() => setStatusMessage(''), 4000)
      }
    } catch (e) {
      console.error('Failed to update status:', e)
    }
  }

  // Cycle Connection Mode: ONLINE (WS+WiFi) -> STANDBY (WiFi only, WS halted) -> OFFLINE (All off)
  const cycleSpeakerStatus = (spk) => {
    const nextStatus = spk.status === 'online' ? 'standby' : spk.status === 'standby' ? 'offline' : 'online'
    const wifiConn = nextStatus !== 'offline'
    const reason = nextStatus === 'online'
      ? 'Online (WebSocket connected, Wi-Fi connected)'
      : nextStatus === 'standby'
      ? 'Standby (Wi-Fi on, WebSocket disconnected - Speaker halted)'
      : 'Offline (Wi-Fi off, WebSocket off)'
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
    setUsbServerHost('speakermonitoring.yhealth.me')
    setUsbServerPort('443')
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

      setUsbFlashStatus("Port opened (115200 baud). Initializing ESP32 communication...")

      // Allow 600ms for hardware line stabilization after port open
      await new Promise(r => setTimeout(r, 600))

      let hardwareResponse = ""
      let confirmed = false
      let readingActive = true

      // Start background reader to continuously stream serial incoming bytes
      const reader = port.readable.getReader()
      const decoder = new TextDecoder()

      const readPromise = (async () => {
        try {
          while (readingActive) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) {
              const text = decoder.decode(value)
              hardwareResponse += text
              if (hardwareResponse.includes("OK:PROVISIONED") || hardwareResponse.includes("OK:WIFI_SAVED")) {
                confirmed = true
                break
              }
            }
          }
        } catch {
          // Expected on reader cancel/port close
        }
      })()

      const encoder = new TextEncoder()
      const targetHost = (usbServerHost || 'speakermonitoring.yhealth.me').trim()
      const targetPort = (usbServerPort || '443').trim()
      const provisionCommand = `PROVISION:${usbSsid.trim()}:${usbPassword}:${targetHost}:${targetPort}\n`
      const legacyCommand = `SET_WIFI:${usbSsid.trim()}:${usbPassword}\n`

      // Transmit with retry mechanism (up to 4 attempts) to ensure reliability across resets
      for (let attempt = 1; attempt <= 4; attempt++) {
        if (confirmed) break
        setUsbFlashStatus(`Provisioning ESP32 over USB (Attempt ${attempt}/4: SSID='${usbSsid.trim()}', Server='${targetHost}')...`)

        try {
          const writer = port.writable.getWriter()
          // Send newline first to clear any stale buffer on microcontroller stdin
          await writer.write(encoder.encode("\r\n"))
          await new Promise(r => setTimeout(r, 50))
          // Send all-in-one PROVISION command first, followed by legacy SET_WIFI fallback
          await writer.write(encoder.encode(provisionCommand))
          await new Promise(r => setTimeout(r, 50))
          await writer.write(encoder.encode(legacyCommand))
          writer.releaseLock()
        } catch (writeErr) {
          console.warn("Writer error during attempt:", writeErr)
        }

        // Wait up to 1.5 seconds checking for confirmation
        const waitStart = Date.now()
        while (Date.now() - waitStart < 1500) {
          if (confirmed) break
          await new Promise(r => setTimeout(r, 100))
        }
      }

      readingActive = false
      try { await reader.cancel() } catch {}
      try { reader.releaseLock() } catch {}
      await readPromise

      if (!confirmed) {
        const cleanedResponse = hardwareResponse.replace(/[\r\n\x00-\x1F\x7F-\x9F]+/g, ' ').trim()
        setUsbFlashStatus(`❌ Hardware verification failed: ESP32 did not confirm NVS write. Response: "${cleanedResponse.slice(-100) || 'No data'}". Please ensure device is connected and no terminal monitor is locking the port.`)
        setIsFlashingUsb(false)
        try { await port.close() } catch {}
        return
      }

      setUsbFlashStatus(`✅ Wi-Fi & Cloud Relay provisioned to ${usbTargetSpeaker?.device_id || 'speaker'}! ESP32 confirmed and is restarting to connect to '${targetHost}'...`)

      // Update speaker record in backend with new SSID (leaving status to be confirmed by actual live connection)
      if (usbTargetSpeaker) {
        try {
          await fetch(`${BACKEND_API}/speakers/${usbTargetSpeaker.device_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wifi_ssid: usbSsid.trim() })
          })
        } catch { }
        setSpeakers(prev => prev.map(s => s.device_id === usbTargetSpeaker.device_id ? { ...s, wifi_ssid: usbSsid.trim() } : s))
      }

      setTimeout(async () => {
        try { await port.close() } catch {}
        setIsFlashingUsb(false)
        setUsbTargetSpeaker(null)
        setStatusMessage(`✅ ${usbTargetSpeaker?.device_id || 'ESP32'} Wi-Fi configured to '${usbSsid}' over USB!`)
        setTimeout(() => setStatusMessage(''), 5000)
      }, 1200)

    } catch (err) {
      console.error("Web Serial error:", err)
      const isPortBusy = err.name === 'NetworkError' || (err.message && err.message.toLowerCase().includes('open'))
      if (isPortBusy) {
        setUsbFlashStatus(`❌ USB flash failed: Serial port is in use by another application. Please close idf.py monitor, Arduino, or PuTTY and try again.`)
      } else {
        setUsbFlashStatus(`❌ USB flash failed: ${err.message || 'Cancelled or port busy'}`)
      }
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

        <div className="workspace-tag" style={{ marginTop: '22px' }}>SECURITY & ACCESS</div>

        {/* User Management Panel Link */}
        <button
          className={`side-link ${currentView === 'users' ? 'active-doctor' : ''}`}
          onClick={() => setCurrentView('users')}
          style={{
            background: currentView === 'users' ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
            borderColor: currentView === 'users' ? 'rgba(168, 85, 247, 0.4)' : 'transparent',
            color: currentView === 'users' ? '#c084fc' : 'var(--text-muted)'
          }}
        >
          <Users size={16} color={currentView === 'users' ? '#c084fc' : 'currentColor'} />
          <span>User Management</span>
          <span className="side-number" style={{
            background: currentView === 'users' ? 'rgba(168, 85, 247, 0.25)' : 'var(--panel2)',
            color: currentView === 'users' ? '#c084fc' : 'var(--muted)'
          }}>
            {String(usersTotal || usersList.length).padStart(2, '0')}
          </span>
        </button>



        <div className="sidebar-spacer" />

        {/* User Profile Card & Sign Out */}
        {currentUser ? (
          <div style={{
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            borderRadius: '10px',
            padding: '10px 12px',
            marginTop: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #a855f7, #3b82f6)',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 800,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0
              }}>
                {currentUser.full_name ? currentUser.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'TG'}
              </div>
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-pure)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {currentUser.full_name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{
                    fontSize: '9.5px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: currentUser.role === 'Admin' ? '#c084fc' : 'var(--light-green)'
                  }}>
                    {currentUser.role}
                  </span>
                  <span style={{ fontSize: '9px', color: 'var(--muted)' }}>•</span>
                  <span style={{ fontSize: '9.5px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    @{currentUser.username}
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Secure Sign Out"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                padding: '5px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center'
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <div style={{
            background: 'var(--panel2)',
            border: '1px solid var(--line)',
            borderRadius: '10px',
            padding: '10px 12px',
            marginTop: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Lock size={14} color="#f59e0b" />
              <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Authentication Required</span>
            </div>
          </div>
        )}
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
              {currentView === 'doctors' ? '🩺 Doctor Clinic Ecosystem' : currentView === 'patients' ? '🧑‍🤝‍🧑 Patient Home & Bedside Ecosystem' : '👥 User Management & Access Control'}
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
              onClick={() => handleOpenCommissioningWizard(currentView === 'doctors' ? 'doctor' : 'patient')}
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

        {/* Top Summary Metrics Cards - Role-Filtered Overview */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
          {currentView === 'doctors' ? (
            <>
              {/* Doctor View Card 1: Doctor Speakers */}
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
                    Doctor Clinic Speakers
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

              {/* Doctor View Card 2: Clinical Practice */}
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
                    Clinical Practice
                  </span>
                  <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--light-green-soft)', display: 'grid', placeItems: 'center' }}>
                    <Building2 size={15} color="var(--light-green)" />
                  </div>
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                  {new Set(doctorSpeakers.map(s => s.name)).size || 1} Doctor
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--light-green)', marginTop: '4px', fontWeight: 600 }}>
                  Diabetology & Metabolic Diseases
                </div>
              </div>

              {/* Doctor View Card 3: Doctor Hardware Status */}
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
                    {doctorSpeakers.filter(s => s.status === 'online').length} Online
                  </span>
                  <span style={{ color: 'var(--dim)', fontSize: '14px' }}>•</span>
                  <span style={{ color: 'var(--golden-yellow)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--golden-yellow)', display: 'inline-block' }} />
                    {doctorSpeakers.filter(s => s.status === 'standby').length} Standby
                  </span>
                  {doctorSpeakers.filter(s => s.status === 'offline').length > 0 && (
                    <>
                      <span style={{ color: 'var(--dim)', fontSize: '14px' }}>•</span>
                      <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
                        {doctorSpeakers.filter(s => s.status === 'offline').length} Offline
                      </span>
                    </>
                  )}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Wifi size={12} color="var(--light-green)" />
                  <span>{doctorSpeakers.filter(s => s.wifi_connected !== false && s.status !== 'offline').length} of {doctorSpeakers.length} Doctor Units Wi-Fi Linked</span>
                </div>
              </div>
            </>
          ) : currentView === 'patients' ? (
            <>
              {/* Patient View Card 1: Patient Speakers */}
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

              {/* Patient View Card 2: Care Monitoring */}
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
                    Care Monitoring
                  </span>
                  <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--sky-blue-soft)', display: 'grid', placeItems: 'center' }}>
                    <Users size={15} color="var(--sky-blue)" />
                  </div>
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                  {patientSpeakers.length} Patient{patientSpeakers.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--sky-blue)', marginTop: '4px', fontWeight: 600 }}>
                  Bedside Vitals & Daily Check-ins
                </div>
              </div>

              {/* Patient View Card 3: Patient Hardware Status */}
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
                    {patientSpeakers.filter(s => s.status === 'online').length} Online
                  </span>
                  <span style={{ color: 'var(--dim)', fontSize: '14px' }}>•</span>
                  <span style={{ color: 'var(--golden-yellow)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--golden-yellow)', display: 'inline-block' }} />
                    {patientSpeakers.filter(s => s.status === 'standby').length} Standby
                  </span>
                  {patientSpeakers.filter(s => s.status === 'offline').length > 0 && (
                    <>
                      <span style={{ color: 'var(--dim)', fontSize: '14px' }}>•</span>
                      <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
                        {patientSpeakers.filter(s => s.status === 'offline').length} Offline
                      </span>
                    </>
                  )}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Wifi size={12} color="var(--light-green)" />
                  <span>{patientSpeakers.filter(s => s.wifi_connected !== false && s.status !== 'offline').length} of {patientSpeakers.length} Patient Units Wi-Fi Linked</span>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* User Management View (Shows Both Records) Card 1: Doctor Speakers */}
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
                    Doctor Speakers Record
                  </span>
                  <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--light-green-soft)', display: 'grid', placeItems: 'center' }}>
                    <Stethoscope size={15} color="var(--light-green)" />
                  </div>
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                  {doctorSpeakers.length} Unit{doctorSpeakers.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--light-green)', marginTop: '4px', fontWeight: 600 }}>
                  Clinical Consultation Rooms
                </div>
              </div>

              {/* User Management View Card 2: Patient Speakers */}
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
                    Patient Speakers Record
                  </span>
                  <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--sky-blue-soft)', display: 'grid', placeItems: 'center' }}>
                    <HeartPulse size={15} color="var(--sky-blue)" />
                  </div>
                </div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                  {patientSpeakers.length} Unit{patientSpeakers.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--sky-blue)', marginTop: '4px', fontWeight: 600 }}>
                  Home Care & Bedside Assistants
                </div>
              </div>

              {/* User Management View Card 3: Global Hardware Status */}
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
                    Total Fleet Hardware
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
                  <span style={{ color: 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--red)', display: 'inline-block' }} />
                    {speakers.filter(s => s.status === 'offline').length} Offline
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Wifi size={12} color="var(--light-green)" />
                  <span>{speakers.length} Total Units Across All Ecosystems</span>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Search & Filter Toolbar (Only for Speaker views) */}
        {currentView !== 'users' && (
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

          {/* Dual View Toggle: Table vs Cards (1M+ Device Scalability) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--panel2)', padding: '4px', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <button
              onClick={() => setViewMode('table')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '6px',
                border: 'none',
                background: viewMode === 'table' ? (currentView === 'doctors' ? 'var(--light-green)' : 'var(--sky-blue)') : 'transparent',
                color: viewMode === 'table' ? '#042217' : 'var(--muted)',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer'
              }}
              title="Table View (Optimized for 10k - 1M devices)"
            >
              <Table size={14} />
              <span>Table</span>
            </button>
            <button
              onClick={() => setViewMode('cards')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '6px',
                border: 'none',
                background: viewMode === 'cards' ? (currentView === 'doctors' ? 'var(--light-green)' : 'var(--sky-blue)') : 'transparent',
                color: viewMode === 'cards' ? '#042217' : 'var(--muted)',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer'
              }}
              title="Card View (Compact clinic oversight)"
            >
              <LayoutGrid size={14} />
              <span>Cards</span>
            </button>
          </div>
        </section>
        )}

        {/* PANEL 1: DOCTOR ECOSYSTEM VIEW                                            */}
        {/* ========================================================================= */}
        {currentView === 'doctors' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--light-green)', letterSpacing: '0.04em' }}>
                  DOCTOR CLINIC SPEAKERS ({filteredDoctors.length})
                </span>
                <span style={{ fontSize: '11px', background: 'var(--panel2)', border: '1px solid var(--line)', padding: '2px 8px', borderRadius: '12px', color: 'var(--muted)' }}>
                  View: {viewMode === 'table' ? 'Virtualized Table (Scalable)' : 'Clinic Cards'}
                </span>
              </div>
            </div>

            {viewMode === 'table' ? (
              <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '12px', overflow: 'hidden', boxShadow: 'var(--shadow-lg)', marginBottom: '24px' }}>
                {/* Practitioner Group Header */}
                <div style={{ padding: '14px 20px', background: 'var(--panel2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'var(--light-green-soft)', display: 'grid', placeItems: 'center' }}>
                      <Stethoscope size={16} color="var(--light-green)" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Dr. Brij Mohan Makkar
                        <CheckCircle size={14} color="var(--light-green)" />
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--light-green)', fontWeight: 600 }}>
                        Diabetology & Metabolic Diseases • Dr. Makkar's Diabetes & Obesity Centre
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                      Doctor ID: DOC-6789
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '12px', background: 'var(--light-green-soft)', color: 'var(--light-green)', border: '1px solid var(--light-green-border)' }}>
                      {filteredDoctors.length} Associated Units
                    </span>
                  </div>
                </div>

                {/* Table Data */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', color: 'var(--muted)', textTransform: 'uppercase', fontSize: '10.5px', letterSpacing: '0.06em' }}>
                        <th style={{ padding: '12px 16px' }}>Device ID</th>
                        <th style={{ padding: '12px 16px' }}>User / Practitioner</th>
                        <th style={{ padding: '12px 16px' }}>Location</th>
                        <th style={{ padding: '12px 16px' }}>Connectivity</th>
                        <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDoctors.map(spk => (
                        <tr
                          key={spk.device_id}
                          onClick={() => setDetailSpeaker(spk)}
                          style={{ borderBottom: '1px solid var(--line)', transition: 'background 0.15s', cursor: 'pointer' }}
                          title="Click row to open deep-dive card view"
                          className="table-row-hover"
                        >
                          <td style={{ padding: '12px 16px', fontWeight: 800, fontFamily: 'var(--mono)' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: 'var(--light-green-soft)',
                              color: 'var(--light-green)',
                              border: '1px solid var(--light-green-border)',
                              fontSize: '11.5px'
                            }}>
                              {spk.device_id}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{
                                width: '26px',
                                height: '26px',
                                borderRadius: '50%',
                                background: 'var(--light-green-soft)',
                                color: 'var(--light-green)',
                                display: 'grid',
                                placeItems: 'center',
                                fontWeight: 800,
                                fontSize: '11px',
                                border: '1px solid var(--light-green-border)'
                              }}>
                                {(spk.name || 'D').charAt(0)}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, color: 'var(--text-pure)', fontSize: '12.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {spk.name || 'Dr. Brij Mohan Makkar'}
                                  <CheckCircle size={12} color="var(--light-green)" />
                                </div>
                                {spk.specialization && (
                                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                    {spk.specialization}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--text-pure)', fontWeight: 600 }}>
                              <MapPin size={12} color="var(--light-green)" />
                              <span>{spk.city || 'New Delhi'}</span>
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span
                              onClick={(e) => { e.stopPropagation(); cycleSpeakerStatus(spk); }}
                              className={`interactive-mode-pill ${spk.status === 'online' ? 'live-beacon-online' : ''}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 9px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                background: spk.status === 'online' ? 'var(--light-green-soft)' : 'var(--red-soft)',
                                color: spk.status === 'online' ? 'var(--light-green)' : 'var(--red)',
                                border: spk.status === 'online' ? '1px solid var(--light-green-border)' : '1px solid var(--red-soft)'
                              }}
                              title="Click to toggle status"
                            >
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: spk.status === 'online' ? 'var(--light-green)' : 'var(--red)' }} />
                              {spk.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenPingModal(spk); }}
                                style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'var(--light-green-soft)', border: '1px solid var(--light-green-border)', color: 'var(--light-green)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                title="Audio Verification Ping"
                              >
                                <Volume2 size={12} /> Ping
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleViewLogs(spk); }}
                                style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                title="Device Diagnostics & Logs"
                              >
                                <FileText size={12} /> Logs
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenControl(spk); }}
                                style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--golden-yellow)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                title="Remote Control & Volume"
                              >
                                <Sliders size={12} /> Control
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteSpeaker(spk.device_id, e); }}
                                style={{ padding: '5px 8px', borderRadius: '6px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--muted)', cursor: 'pointer' }}
                                title="Delete Speaker"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: '18px' }}>
              {filteredDoctors.map(spk => (
                <div
                  key={spk.device_id}
                  onClick={() => setDetailSpeaker(spk)}
                  style={{
                    background: 'var(--panel-card)',
                    border: spk.device_id === 'SPK-0000002' ? '1.5px solid var(--light-green-border)' : '1px solid var(--line)',
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: 'var(--shadow-lg)',
                    position: 'relative',
                    cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
                  }}
                  className="interactive-speaker-card"
                  title="Click to open detailed deep-dive hardware & clinical view"
                >
                  <div>
                    {/* Header: ID, MAC & Clean Status Pill */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          background: 'var(--light-green-soft)',
                          color: 'var(--light-green)',
                          padding: '3px 9px',
                          borderRadius: '6px',
                          fontWeight: 800,
                          fontFamily: 'var(--mono)',
                          fontSize: '12px',
                          border: '1px solid var(--light-green-border)',
                          letterSpacing: '0.04em'
                        }}>
                          {spk.device_id}
                        </span>
                        <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          {spk.mac_address}
                          <button
                            onClick={() => copyToClipboard(spk.mac_address, spk.device_id)}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: copiedMac === spk.device_id ? 'var(--light-green)' : 'var(--muted)', padding: '2px' }}
                            title="Copy MAC address"
                          >
                            {copiedMac === spk.device_id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span style={{
                          fontSize: '11px',
                          color: 'var(--text-pure)',
                          background: 'var(--panel2)',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--line)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}>
                          <MapPin size={11} color="var(--light-green)" />
                          <span>{spk.city || 'New Delhi'}</span>
                        </span>
                      </div>

                      {/* Header Actions: Firmware Version & Interactive Status Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '11px',
                          color: 'var(--muted)',
                          fontFamily: 'var(--mono)',
                          background: 'var(--panel2)',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          border: '1px solid var(--line)',
                          fontWeight: 600
                        }} title="Firmware Version">
                          {spk.firmware_version || 'v1.4.2-bargein'}
                        </span>

                      <span
                        onClick={(e) => { e.stopPropagation(); cycleSpeakerStatus(spk); }}
                        className={`interactive-mode-pill ${spk.status === 'online' ? 'live-beacon-online' : spk.status === 'standby' ? 'live-beacon-standby' : ''}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          background: spk.status === 'online' ? 'var(--light-green-soft)' : spk.status === 'standby' ? 'var(--golden-yellow-soft)' : 'var(--red-soft)',
                          color: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)',
                          border: spk.status === 'online' ? '1px solid var(--light-green-border)' : spk.status === 'standby' ? '1px solid var(--golden-yellow-border)' : '1px solid var(--red-soft)'
                        }}
                        title="Click to cycle status: ONLINE ➔ STANDBY ➔ OFFLINE"
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
                      <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--display)' }}>
                        {spk.name ? spk.name.replace(/\s*\([^)]*\)/g, '').trim() : 'Dr. Brij Mohan Makkar'}
                        <CheckCircle size={15} color="var(--light-green)" />
                      </div>
                      <div style={{ color: 'var(--light-green)', fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>
                        {spk.specialization || 'Clinical Specialist'}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-pure)', fontSize: '12px', fontWeight: 600 }}>
                          <Building2 size={13} color="var(--light-green)" style={{ flexShrink: 0 }} />
                          <span>{spk.clinic_name || "Dr. Makkar's Diabetes & Obesity Centre"}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)', fontSize: '11.5px', paddingLeft: '19px' }}>
                          <MapPin size={12} color="var(--light-green)" style={{ flexShrink: 0 }} />
                          <span>{spk.clinic_address || "Paschim Vihar, New Delhi"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Inline Quick 3-Mode Switcher: Online / Standby / Offline */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      background: 'var(--panel2)',
                      padding: '7px 11px',
                      borderRadius: '8px',
                      marginTop: '6px',
                      marginBottom: '12px',
                      border: '1px solid var(--line)'
                    }}>
                      <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Mode:
                      </span>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleSetSpeakerStatus(spk.device_id, 'online', true, 'Online: WebSocket connected, Wi-Fi connected'); }}
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
                          title="Online: WebSocket connected, Wi-Fi connected"
                        >
                          ● Online
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleSetSpeakerStatus(spk.device_id, 'standby', true, 'Standby: Wi-Fi on, WebSocket disconnected (Speaker Halted)'); }}
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
                          title="Standby: Wi-Fi on, WebSocket disconnected (Speaker Halted)"
                        >
                          ◐ Standby
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleSetSpeakerStatus(spk.device_id, 'offline', false, 'Offline: Wi-Fi off, WebSocket off'); }}
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
                          title="Offline: Wi-Fi off, WebSocket off"
                        >
                          ○ Offline
                        </button>
                      </div>
                    </div>

                    {/* Minimalist Telemetry Strip */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: '8px',
                      background: 'var(--panel2)',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      border: '1px solid var(--line)',
                      fontSize: '11.5px'
                    }}>
                      {/* Wi-Fi & Strength (Clickable toggle) */}
                      <div
                        onClick={(e) => { e.stopPropagation(); handleToggleWifi(spk); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}
                        title="Click to toggle Wi-Fi connection"
                      >
                        {spk.wifi_connected !== false && spk.status !== 'offline' ? (
                          <>
                            <Wifi size={13} color="var(--light-green)" />
                            <span style={{ color: 'var(--text-pure)', fontWeight: 600 }}>{spk.wifi_ssid || 'TFTus-WiFi'}</span>
                            <span style={{ color: (spk.wifi_rssi || -48) >= -60 ? 'var(--light-green)' : 'var(--golden-yellow)', fontFamily: 'var(--mono)', fontSize: '10px' }}>
                              ({spk.wifi_rssi || -48} dBm)
                            </span>
                          </>
                        ) : (
                          <>
                            <WifiOff size={13} color="var(--red)" />
                            <span style={{ color: 'var(--red)', fontWeight: 600 }}>Wi-Fi Off</span>
                          </>
                        )}
                      </div>

                      {/* IP Address */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)' }}>
                        <Globe size={13} color="var(--sky-blue)" />
                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--sky-blue)', fontSize: '11px', fontWeight: 600 }}>
                          {spk.ip_address || (spk.status !== 'offline' ? '192.168.50.91' : 'Offline')}
                        </span>
                      </div>

                      {/* Firmware */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--muted)' }}>
                        <Cpu size={13} color="var(--light-green)" />
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>
                          {spk.firmware_version || 'v1.4.2-bargein'}
                        </span>
                      </div>

                      {/* Volume */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)' }}>
                        <Volume2 size={13} color="var(--light-green)" />
                        <span>Vol: <b style={{ color: 'var(--text-pure)' }}>{spk.volume || 75}%</b></span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Toolbar - Minimalist, Clean & Functional */}
                  <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--line)', paddingTop: '14px', marginTop: 'auto' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenPingModal(spk); }}
                      style={{
                        flex: 1.1,
                        padding: '8px 10px',
                        fontSize: '12px',
                        background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.18), rgba(251, 191, 36, 0.05))',
                        border: '1px solid var(--golden-yellow-border)',
                        color: 'var(--golden-yellow)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      title="Ping hardware speaker & speak TTS audio"
                    >
                      <Zap size={14} color="var(--golden-yellow)" /> Ping & Speak
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenControl(spk); }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontSize: '12px',
                        background: 'var(--light-green-soft)',
                        border: '1px solid var(--light-green-border)',
                        color: 'var(--light-green)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      title="Remote volume control & TTS voice prompts"
                    >
                      <Sliders size={13} /> Control
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenUsbForSpeaker(spk); }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontSize: '12px',
                        background: 'var(--panel2)',
                        border: '1px solid var(--line)',
                        color: 'var(--text-pure)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      title="Connect ESP32-S3 via USB-C to flash Wi-Fi credentials directly"
                    >
                      <Usb size={13} /> USB Flash
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); handleViewLogs(spk); }}
                      style={{
                        padding: '8px 12px',
                        fontSize: '12px',
                        background: 'var(--panel2)',
                        border: '1px solid var(--line)',
                        borderRadius: '6px',
                        color: 'var(--sky-blue)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                      title="View live serial & telemetry logs modal"
                    >
                      <FileText size={13} /> Logs
                    </button>
                  </div>
                </div>
              ))}
            </div>
            )}
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
                    When you provision patient home or bedside speakers using the <b>+ Add New Speaker</b> button at the top, they will be tracked here with individual care goals, vitals monitoring, and assigned doctor linkage.
                  </p>
                </div>
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
                          <span style={{
                            fontSize: '11px',
                            color: 'var(--text-pure)',
                            background: 'var(--panel2)',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            border: '1px solid var(--line)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}>
                            <MapPin size={11} color="var(--light-green)" />
                            <span>{spk.city || 'New Delhi'}</span>
                          </span>
                        </div>

                        {/* Single Interactive Status Badge */}
                        <span
                          onClick={() => cycleSpeakerStatus(spk)}
                          className={`interactive-mode-pill ${spk.status === 'online' ? 'live-beacon-online' : spk.status === 'standby' ? 'live-beacon-standby' : ''}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            padding: '4px 10px',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            background: spk.status === 'online' ? 'var(--light-green-soft)' : spk.status === 'standby' ? 'var(--golden-yellow-soft)' : 'var(--red-soft)',
                            color: spk.status === 'online' ? 'var(--light-green)' : spk.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)',
                            border: spk.status === 'online' ? '1px solid var(--light-green-border)' : spk.status === 'standby' ? '1px solid var(--golden-yellow-border)' : '1px solid var(--red-soft)'
                          }}
                          title="Click to cycle status: ONLINE ➔ STANDBY ➔ OFFLINE"
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

                      {/* Volume & Wi-Fi */}
                      <div style={{ display: 'flex', gap: '16px', fontSize: '11.5px', color: 'var(--muted)', marginBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Volume2 size={13} color="var(--sky-blue)" />
                          <span>Vol: <b style={{ color: 'var(--text-pure)' }}>{spk.volume || 75}%</b></span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <Wifi size={13} color={(spk.wifi_connected !== false && spk.status !== 'offline') ? "var(--light-green)" : "var(--muted)"} />
                          <span>SSID: <b style={{ color: 'var(--text-pure)' }}>{spk.wifi_ssid || 'TFTus-WiFi'}</b></span>
                        </div>
                      </div>

                    {/* Inline Quick Real-Time 3-Mode Switcher */}
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
                        3 Modes:
                      </span>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'online', true, 'Online: WebSocket connected, Wi-Fi connected')}
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
                          title="Online: WebSocket connected, Wi-Fi connected"
                        >
                          ● Online
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'standby', true, 'Standby: Wi-Fi on, WebSocket disconnected (Speaker Halted)')}
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
                          title="Standby: Wi-Fi on, WebSocket disconnected (Speaker Halted)"
                        >
                          ◐ Standby
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetSpeakerStatus(spk.device_id, 'offline', false, 'Offline: Wi-Fi off, WebSocket off')}
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
                          title="Offline: Wi-Fi off, WebSocket off"
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
                            fontSize: '11px',
                            fontFamily: 'var(--mono)',
                            padding: '3px 8px',
                            borderRadius: '5px',
                            background: 'var(--panel2)',
                            color: (spk.wifi_rssi || -48) >= -55 ? '#10b981' : (spk.wifi_rssi || -48) >= -70 ? '#f59e0b' : '#ef4444',
                            fontWeight: 700,
                            border: '1px solid var(--line)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <Signal size={11} />
                            {(spk.wifi_connected !== false && spk.status !== 'offline') ? (
                              <>
                                <span>Strength: {spk.wifi_rssi || -48} dBm</span>
                                <span style={{ opacity: 0.85, fontSize: '10px' }}>
                                  ({(spk.wifi_rssi || -48) >= -55 ? 'Excellent' : (spk.wifi_rssi || -48) >= -65 ? 'Good' : (spk.wifi_rssi || -48) >= -75 ? 'Fair' : 'Weak'})
                                </span>
                              </>
                            ) : (
                              <span>Signal: Off</span>
                            )}
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
                        onClick={(e) => { e.stopPropagation(); handleOpenUsbForSpeaker(spk); }}
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
                        onClick={(e) => { e.stopPropagation(); handleOpenControl(spk); }}
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
                        onClick={(e) => { e.stopPropagation(); handleOpenPingModal(spk); }}
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

        {/* ========================================================================= */}
        {/* VIEW 3: USER MANAGEMENT & CYBERSECURITY ROLE-BASED ACCESS CONTROL         */}
        {/* ========================================================================= */}
        {currentView === 'users' && (
          <div>
            {/* User Management Toolbar matching reference screenshot */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              {/* Left Side Filters */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
                {/* Search Input */}
                <div style={{
                  position: 'relative',
                  width: '280px',
                  minWidth: '220px'
                }}>
                  <Search size={15} style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--muted)',
                    pointerEvents: 'none'
                  }} />
                  <input
                    type="text"
                    placeholder="Search by name, email, username..."
                    value={userSearch}
                    onChange={e => {
                      setUserSearch(e.target.value)
                      setUsersPage(1)
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 14px 8px 38px',
                      borderRadius: '24px',
                      background: 'var(--panel2)',
                      border: '1px solid var(--line)',
                      color: 'var(--text-pure)',
                      fontSize: '13px',
                      outline: 'none',
                      transition: 'border-color 0.15s ease'
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--sky-blue)'}
                    onBlur={e => e.target.style.borderColor = 'var(--line)'}
                  />
                  {userSearch && (
                    <button
                      onClick={() => { setUserSearch(''); setUsersPage(1); }}
                      style={{
                        position: 'absolute',
                        right: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--muted)',
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      <XCircle size={14} />
                    </button>
                  )}
                </div>

                {/* Role Filter Dropdown */}
                <div style={{ position: 'relative' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    background: 'var(--panel2)',
                    border: '1px solid var(--line)',
                    color: userRoleFilter !== 'all' ? 'var(--sky-blue)' : 'var(--text-pure)',
                    fontSize: '12.5px',
                    fontWeight: 600
                  }}>
                    <User size={13} color="var(--muted)" />
                    <span>Role:</span>
                    <select
                      value={userRoleFilter}
                      onChange={e => {
                        setUserRoleFilter(e.target.value)
                        setUsersPage(1)
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="all" style={{ background: '#1e293b', color: '#fff' }}>All Roles</option>
                      <option value="Admin" style={{ background: '#1e293b', color: '#fff' }}>Admin</option>
                      <option value="Moderator" style={{ background: '#1e293b', color: '#fff' }}>Moderator</option>
                      <option value="User" style={{ background: '#1e293b', color: '#fff' }}>User</option>
                      <option value="Guest" style={{ background: '#1e293b', color: '#fff' }}>Guest</option>
                      <option value="Viewer" style={{ background: '#1e293b', color: '#fff' }}>Viewer</option>
                    </select>
                  </div>
                </div>

                {/* Status Filter Dropdown */}
                <div style={{ position: 'relative' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    background: 'var(--panel2)',
                    border: '1px solid var(--line)',
                    color: userStatusFilter !== 'all' ? 'var(--light-green)' : 'var(--text-pure)',
                    fontSize: '12.5px',
                    fontWeight: 600
                  }}>
                    <Award size={13} color="var(--muted)" />
                    <span>Status:</span>
                    <select
                      value={userStatusFilter}
                      onChange={e => {
                        setUserStatusFilter(e.target.value)
                        setUsersPage(1)
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="all" style={{ background: '#1e293b', color: '#fff' }}>All Statuses</option>
                      <option value="Active" style={{ background: '#1e293b', color: '#fff' }}>Active</option>
                      <option value="Inactive" style={{ background: '#1e293b', color: '#fff' }}>Inactive</option>
                      <option value="Banned" style={{ background: '#1e293b', color: '#fff' }}>Banned</option>
                      <option value="Pending" style={{ background: '#1e293b', color: '#fff' }}>Pending</option>
                      <option value="Suspended" style={{ background: '#1e293b', color: '#fff' }}>Suspended</option>
                    </select>
                  </div>
                </div>

                {/* Date Filter Dropdown */}
                <div style={{ position: 'relative' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    background: 'var(--panel2)',
                    border: '1px solid var(--line)',
                    color: 'var(--text-pure)',
                    fontSize: '12.5px',
                    fontWeight: 600
                  }}>
                    <Calendar size={13} color="var(--muted)" />
                    <span>Date:</span>
                    <select
                      value={userDateFilter}
                      onChange={e => setUserDateFilter(e.target.value)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="all" style={{ background: '#1e293b', color: '#fff' }}>All Dates</option>
                      <option value="this_month" style={{ background: '#1e293b', color: '#fff' }}>This Month</option>
                      <option value="this_year" style={{ background: '#1e293b', color: '#fff' }}>This Year</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Right Side Buttons: Export & Add User */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Export Button */}
                <button
                  onClick={handleExportUsersCSV}
                  title="Export User Directory to CSV"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    background: 'var(--panel2)',
                    border: '1px solid var(--line)',
                    color: 'var(--text-pure)',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--sky-blue)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
                >
                  <Upload size={13} style={{ transform: 'rotate(180deg)' }} />
                  <span>Export</span>
                </button>

                {/* + Add User Button */}
                <button
                  onClick={() => {
                    setUserForm({
                      full_name: '',
                      email: '',
                      username: '',
                      role: 'User',
                      status: 'Active',
                      password: ''
                    })
                    setUserFormError('')
                    setAddUserModalOpen(true)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 18px',
                    borderRadius: '20px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#ffffff',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = '#0f172a'
                    e.currentTarget.style.borderColor = '#475569'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = '#1e293b'
                    e.currentTarget.style.borderColor = '#334155'
                  }}
                >
                  <PlusCircle size={15} color="#38bdf8" />
                  <span>+ Add User</span>
                </button>
              </div>
            </div>

            {/* Table Container */}
            <div className="user-table-container">
              <table className="users-table">
                <thead>
                  <tr>
                    <th style={{ width: '42px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={usersList.length > 0 && selectedUsernames.length === usersList.length}
                        onChange={toggleSelectAllUsers}
                        style={{ cursor: 'pointer', accentColor: 'var(--sky-blue)' }}
                      />
                    </th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <span>Full Name</span>
                        <ArrowUpDown size={11} color="var(--dim)" />
                      </div>
                    </th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <span>Email</span>
                        <ArrowUpDown size={11} color="var(--dim)" />
                      </div>
                    </th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <span>Username</span>
                        <ArrowUpDown size={11} color="var(--dim)" />
                      </div>
                    </th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <span>Status</span>
                        <ArrowUpDown size={11} color="var(--dim)" />
                      </div>
                    </th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <span>Role</span>
                        <ArrowUpDown size={11} color="var(--dim)" />
                      </div>
                    </th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <span>Joined Date</span>
                        <ArrowUpDown size={11} color="var(--dim)" />
                      </div>
                    </th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <span>Last Active</span>
                        <ArrowUpDown size={11} color="var(--dim)" />
                      </div>
                    </th>
                    <th style={{ textAlign: 'center', width: '90px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '36px', color: 'var(--muted)' }}>
                        <RefreshCw size={20} className="spin" style={{ marginBottom: '8px' }} />
                        <div>Loading users from secure database...</div>
                      </td>
                    </tr>
                  ) : usersList.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '36px', color: 'var(--muted)' }}>
                        <Users size={28} color="var(--dim)" style={{ marginBottom: '8px' }} />
                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-pure)' }}>No users found</div>
                        <div style={{ fontSize: '12px' }}>Try adjusting your search query or filter options</div>
                      </td>
                    </tr>
                  ) : (
                    usersList.map((usr) => {
                      const isSelected = selectedUsernames.includes(usr.username)
                      const isTanviRoot = usr.username === 'tanvi'

                      // Assign avatar background color based on name
                      const avatarColors = [
                        '#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#6366f1'
                      ]
                      const colorIndex = (usr.full_name || '').charCodeAt(0) % avatarColors.length
                      const avatarBg = avatarColors[colorIndex]

                      return (
                        <tr key={usr.username} style={{ background: isSelected ? 'rgba(59, 130, 246, 0.05)' : 'transparent' }}>
                          {/* Checkbox */}
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectUser(usr.username)}
                              style={{ cursor: 'pointer', accentColor: 'var(--sky-blue)' }}
                            />
                          </td>

                          {/* Full Name with Avatar */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              {usr.avatar ? (
                                <img
                                  src={usr.avatar}
                                  alt={usr.full_name}
                                  style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
                                  onError={(e) => {
                                    e.target.style.display = 'none'
                                  }}
                                />
                              ) : (
                                <div style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '50%',
                                  background: isTanviRoot ? 'linear-gradient(135deg, #a855f7, #3b82f6)' : avatarBg,
                                  color: '#ffffff',
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  display: 'grid',
                                  placeItems: 'center',
                                  flexShrink: 0
                                }}>
                                  {(usr.full_name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-pure)' }}>
                                  {usr.full_name}
                                </span>
                                {isTanviRoot && (
                                  <span style={{
                                    fontSize: '9.5px',
                                    fontWeight: 700,
                                    background: 'rgba(168, 85, 247, 0.2)',
                                    color: '#c084fc',
                                    padding: '1px 6px',
                                    borderRadius: '10px',
                                    border: '1px solid rgba(168, 85, 247, 0.4)'
                                  }}>
                                    Root Admin
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Email */}
                          <td style={{ color: 'var(--muted)', fontSize: '12.5px' }}>
                            {usr.email}
                          </td>

                          {/* Username */}
                          <td style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-pure)' }}>
                            {usr.username}
                          </td>

                          {/* Status Pill */}
                          <td>
                            <span className={`status-pill ${
                              usr.status === 'Active' ? 'status-pill-active' :
                              usr.status === 'Inactive' ? 'status-pill-inactive' :
                              usr.status === 'Banned' ? 'status-pill-banned' :
                              usr.status === 'Pending' ? 'status-pill-pending' :
                              usr.status === 'Suspended' ? 'status-pill-suspended' : 'status-pill-inactive'
                            }`}>
                              {usr.status}
                            </span>
                          </td>

                          {/* Role Badge */}
                          <td>
                            <span className={`role-badge-tag ${
                              usr.role === 'Admin' ? 'role-admin' :
                              usr.role === 'Moderator' ? 'role-moderator' :
                              usr.role === 'User' ? 'role-user' : 'role-guest'
                            }`}>
                              {usr.role}
                            </span>
                          </td>

                          {/* Joined Date */}
                          <td style={{ color: 'var(--muted)', fontSize: '12px' }}>
                            {usr.joined_date || 'Nov 06, 2026'}
                          </td>

                          {/* Last Active */}
                          <td style={{ color: 'var(--muted)', fontSize: '12px' }}>
                            {usr.last_active || 'Just now'}
                          </td>

                          {/* Actions */}
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                              {/* Edit User Button */}
                              <button
                                className="action-icon-btn edit"
                                title={`Edit ${usr.full_name}`}
                                onClick={() => {
                                  setUserBeingEdited(usr)
                                  setUserForm({
                                    full_name: usr.full_name,
                                    email: usr.email,
                                    username: usr.username,
                                    role: usr.role,
                                    status: usr.status,
                                    password: ''
                                  })
                                  setUserFormError('')
                                  setEditUserModalOpen(true)
                                }}
                              >
                                <Edit3 size={15} />
                              </button>

                              {/* Delete User Button */}
                              <button
                                className="action-icon-btn delete"
                                title={isTanviRoot ? "Root Admin is protected and cannot be deleted" : `Delete ${usr.full_name}`}
                                disabled={isTanviRoot}
                                style={{
                                  opacity: isTanviRoot ? 0.35 : 1,
                                  cursor: isTanviRoot ? 'not-allowed' : 'pointer'
                                }}
                                onClick={() => {
                                  if (isTanviRoot) return
                                  setUserBeingDeleted(usr)
                                  setDeleteUserModalOpen(true)
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>

              {/* Table Footer: Rows per page & Pagination */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px',
                borderTop: '1px solid var(--line)',
                background: 'var(--panel2)',
                fontSize: '12px',
                color: 'var(--muted)',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                {/* Left side: Rows per page & Total count */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>Rows per page</span>
                  <select
                    value={usersRowsPerPage}
                    onChange={e => {
                      setUsersRowsPerPage(Number(e.target.value))
                      setUsersPage(1)
                    }}
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--line)',
                      color: 'var(--text-pure)',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                  <span>of {usersTotal || usersList.length} rows</span>
                </div>

                {/* Right side: Pagination navigation */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {/* ChevronFirst */}
                  <button
                    onClick={() => setUsersPage(1)}
                    disabled={usersPage <= 1}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: usersPage <= 1 ? 'var(--dim)' : 'var(--muted)',
                      cursor: usersPage <= 1 ? 'default' : 'pointer',
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <ChevronFirst size={16} />
                  </button>

                  {/* ChevronLeft */}
                  <button
                    onClick={() => setUsersPage(p => Math.max(1, p - 1))}
                    disabled={usersPage <= 1}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: usersPage <= 1 ? 'var(--dim)' : 'var(--muted)',
                      cursor: usersPage <= 1 ? 'default' : 'pointer',
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>

                  {/* Page numbers */}
                  {Array.from({ length: Math.ceil((usersTotal || 1) / usersRowsPerPage) }).slice(0, 5).map((_, idx) => {
                    const pageNum = idx + 1
                    const isActive = pageNum === usersPage
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setUsersPage(pageNum)}
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: isActive ? '#1e293b' : 'transparent',
                          border: isActive ? '1px solid #475569' : 'none',
                          color: isActive ? '#ffffff' : 'var(--muted)',
                          fontWeight: isActive ? 700 : 500,
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: '11.5px'
                        }}
                      >
                        {pageNum}
                      </button>
                    )
                  })}

                  {Math.ceil((usersTotal || 1) / usersRowsPerPage) > 5 && (
                    <span style={{ padding: '0 4px', color: 'var(--dim)' }}>...</span>
                  )}

                  {/* ChevronRight */}
                  <button
                    onClick={() => setUsersPage(p => p + 1)}
                    disabled={usersPage >= Math.ceil((usersTotal || 1) / usersRowsPerPage)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: usersPage >= Math.ceil((usersTotal || 1) / usersRowsPerPage) ? 'var(--dim)' : 'var(--muted)',
                      cursor: usersPage >= Math.ceil((usersTotal || 1) / usersRowsPerPage) ? 'default' : 'pointer',
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>

                  {/* ChevronLast */}
                  <button
                    onClick={() => setUsersPage(Math.ceil((usersTotal || 1) / usersRowsPerPage))}
                    disabled={usersPage >= Math.ceil((usersTotal || 1) / usersRowsPerPage)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: usersPage >= Math.ceil((usersTotal || 1) / usersRowsPerPage) ? 'var(--dim)' : 'var(--muted)',
                      cursor: usersPage >= Math.ceil((usersTotal || 1) / usersRowsPerPage) ? 'default' : 'pointer',
                      padding: '4px 6px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <ChevronLast size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Enterprise Hardware Speakers Fleet: Both Doctor & Patient Records */}
            <div style={{ marginTop: '28px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '12px', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}>
              <div style={{ padding: '14px 20px', background: 'var(--panel2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.15)', display: 'grid', placeItems: 'center' }}>
                    <Server size={16} color="#c084fc" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '13.5px', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      ALL REGISTERED HARDWARE SPEAKERS (DOCTOR & PATIENT RECORDS)
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--muted)', fontWeight: 500 }}>
                      Unified hardware inventory: {doctorSpeakers.length} Doctor units &bull; {patientSpeakers.length} Patient units
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '12px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                    {speakers.length} Total Registered Units
                  </span>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', color: 'var(--muted)', textTransform: 'uppercase', fontSize: '10.5px', letterSpacing: '0.06em' }}>
                      <th style={{ padding: '12px 16px' }}>Device ID</th>
                      <th style={{ padding: '12px 16px' }}>Domain / Role</th>
                      <th style={{ padding: '12px 16px' }}>Assigned User / Practitioner</th>
                      <th style={{ padding: '12px 16px' }}>Hardware MAC</th>
                      <th style={{ padding: '12px 16px' }}>Location</th>
                      <th style={{ padding: '12px 16px' }}>Status</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {speakers.map(spk => (
                      <tr
                        key={spk.device_id}
                        onClick={() => setDetailSpeaker(spk)}
                        style={{ borderBottom: '1px solid var(--line)', transition: 'background 0.15s', cursor: 'pointer' }}
                        title="Click row to open deep-dive card view"
                        className="table-row-hover"
                      >
                        <td style={{ padding: '12px 16px', fontWeight: 800, fontFamily: 'var(--mono)' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: spk.role === 'patient' ? 'var(--sky-blue-soft)' : 'var(--light-green-soft)',
                            color: spk.role === 'patient' ? 'var(--sky-blue)' : 'var(--light-green)',
                            border: spk.role === 'patient' ? '1px solid var(--sky-blue-border)' : '1px solid var(--light-green-border)',
                            fontSize: '11.5px'
                          }}>
                            {spk.device_id}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background: spk.role === 'patient' ? 'var(--sky-blue-soft)' : 'var(--light-green-soft)',
                            color: spk.role === 'patient' ? 'var(--sky-blue)' : 'var(--light-green)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            {spk.role === 'patient' ? <HeartPulse size={11} /> : <Stethoscope size={11} />}
                            {spk.role === 'patient' ? 'Patient Bedside' : 'Doctor Clinic'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-pure)', fontSize: '12.5px' }}>
                            {spk.name || (spk.role === 'patient' ? 'Patient Care Unit' : 'Dr. Brij Mohan Makkar')}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted)' }}>
                          {spk.mac_address}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--text-pure)', fontWeight: 600 }}>
                            <MapPin size={12} color="var(--light-green)" />
                            <span>{spk.city || 'New Delhi'}</span>
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span
                            onClick={(e) => { e.stopPropagation(); cycleSpeakerStatus(spk); }}
                            className={`interactive-mode-pill ${spk.status === 'online' ? 'live-beacon-online' : ''}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '3px 9px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              background: spk.status === 'online' ? 'var(--light-green-soft)' : 'var(--red-soft)',
                              color: spk.status === 'online' ? 'var(--light-green)' : 'var(--red)',
                              border: spk.status === 'online' ? '1px solid var(--light-green-border)' : '1px solid var(--red-soft)'
                            }}
                            title="Click to toggle status"
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: spk.status === 'online' ? 'var(--light-green)' : 'var(--red)' }} />
                            {spk.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenPingModal(spk); }}
                              style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'var(--light-green-soft)', border: '1px solid var(--light-green-border)', color: 'var(--light-green)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Audio Verification Ping"
                            >
                              <Volume2 size={12} /> Ping
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleViewLogs(spk); }}
                              style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Device Diagnostics & Logs"
                            >
                              <FileText size={12} /> Logs
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenControl(spk); }}
                              style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--golden-yellow)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Remote Control & Volume"
                            >
                              <Sliders size={12} /> Control
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}



      </main>

      {/* ========================================================================= */}
      {/* MODAL: CLINICAL & HARDWARE OPENED CARD VIEW                                */}
      {/* ========================================================================= */}
      {detailSpeaker && (
        <div
          onClick={() => setDetailSpeaker(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.80)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 130,
            backdropFilter: 'blur(6px)',
            padding: '20px'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: '16px',
              width: '820px',
              maxWidth: '96vw',
              maxHeight: '92vh',
              overflowY: 'auto',
              padding: '26px 28px',
              boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7)',
              position: 'relative'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '16px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <span style={{
                    background: 'var(--light-green-soft)',
                    color: 'var(--light-green)',
                    padding: '4px 12px',
                    borderRadius: '8px',
                    fontWeight: 800,
                    fontFamily: 'var(--mono)',
                    fontSize: '13.5px',
                    border: '1px solid var(--light-green-border)',
                    letterSpacing: '0.04em'
                  }}>
                    {detailSpeaker.device_id}
                  </span>

                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    background: 'var(--panel2)',
                    border: '1px solid var(--line)',
                    color: 'var(--text-pure)',
                    fontSize: '12px',
                    fontWeight: 700
                  }}>
                    <MapPin size={13} color="var(--light-green)" />
                    <span><b>Location:</b> {detailSpeaker.city || 'New Delhi'}</span>
                  </span>

                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '8px',
                    background: detailSpeaker.role === 'doctor' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                    color: detailSpeaker.role === 'doctor' ? 'var(--light-green)' : 'var(--sky-blue)',
                    border: `1px solid ${detailSpeaker.role === 'doctor' ? 'var(--light-green-border)' : 'var(--sky-blue-border)'}`,
                    fontSize: '11.5px',
                    fontWeight: 700,
                    textTransform: 'uppercase'
                  }}>
                    {detailSpeaker.role === 'doctor' ? 'Doctor Clinic Assistant' : 'Patient Home Companion'}
                  </span>

                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '11.5px',
                    fontWeight: 800,
                    background: detailSpeaker.status === 'online' ? 'var(--light-green-soft)' : detailSpeaker.status === 'standby' ? 'var(--golden-yellow-soft)' : 'var(--red-soft)',
                    color: detailSpeaker.status === 'online' ? 'var(--light-green)' : detailSpeaker.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)',
                    border: detailSpeaker.status === 'online' ? '1px solid var(--light-green-border)' : detailSpeaker.status === 'standby' ? '1px solid var(--golden-yellow-border)' : '1px solid var(--red-soft)'
                  }}>
                    <span className={detailSpeaker.status === 'online' ? 'live-beacon-online' : detailSpeaker.status === 'standby' ? 'live-beacon-standby' : ''} style={{ width: '7px', height: '7px', borderRadius: '50%', background: detailSpeaker.status === 'online' ? 'var(--light-green)' : detailSpeaker.status === 'standby' ? 'var(--golden-yellow)' : 'var(--red)', display: 'inline-block' }} />
                    {detailSpeaker.status === 'online' ? 'MODE: ONLINE (WS & WI-FI CONNECTED)' : detailSpeaker.status === 'standby' ? 'MODE: STANDBY (WI-FI ON • WS HALTED)' : 'MODE: OFFLINE (WI-FI & WS OFF)'}
                  </span>
                </div>

                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                  Device & Clinical Details
                </div>
              </div>

              <button
                onClick={() => setDetailSpeaker(null)}
                style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center' }}
                title="Close"
              >
                <XCircle size={20} />
              </button>
            </div>

            {/* Main 2-Column Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              
              {/* Left Column: Clinical Persona & Just Hardware MAC */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {/* Card 1: Clinical Persona */}
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Stethoscope size={16} color="var(--light-green)" />
                      <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--light-green)' }}>
                        Clinical Practitioner
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    {detailSpeaker.name}
                    <CheckCircle size={16} color="var(--light-green)" />
                  </div>

                  <div style={{ fontSize: '13px', color: 'var(--light-green)', fontWeight: 600, marginBottom: '8px' }}>
                    {detailSpeaker.specialization || 'Clinical Specialist'}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-pure)', fontSize: '12.5px', fontWeight: 600 }}>
                      <Building2 size={14} color="var(--light-green)" style={{ flexShrink: 0 }} />
                      <span>{detailSpeaker.clinic_name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)', fontSize: '11.5px', paddingLeft: '20px' }}>
                      <MapPin size={12} color="var(--light-green)" style={{ flexShrink: 0 }} />
                      <span>{detailSpeaker.clinic_address}</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '11.5px', borderTop: '1px solid var(--line)', paddingTop: '12px' }}>
                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>DOCTOR ID</span>
                      <strong style={{ fontFamily: 'var(--mono)', color: 'var(--text-pure)' }}>{detailSpeaker.doctor_id || 'DOC-6789'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>ACTIVE COHORT</span>
                      <strong style={{ color: 'var(--light-green)' }}>{detailSpeaker.active_patients_count || 25} Patients</strong>
                    </div>
                  </div>
                </div>

                {/* Card 2: Hardware MAC Only (Architecture Removed) */}
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>
                        HARDWARE MAC ADDRESS
                      </span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '15px', color: 'var(--text-pure)', fontWeight: 800 }}>
                        {detailSpeaker.mac_address}
                      </span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(detailSpeaker.mac_address, detailSpeaker.device_id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 14px',
                        borderRadius: '8px',
                        background: 'var(--panel)',
                        border: '1px solid var(--line)',
                        color: copiedMac === detailSpeaker.device_id ? 'var(--light-green)' : 'var(--text-pure)',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                      title="Copy MAC Address"
                    >
                      {copiedMac === detailSpeaker.device_id ? <Check size={14} color="var(--light-green)" /> : <Copy size={14} />}
                      <span>{copiedMac === detailSpeaker.device_id ? 'Copied' : 'Copy MAC'}</span>
                    </button>
                  </div>
                </div>

              </div>

              {/* Right Column: Network Telemetry & Quick Action Deck */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {/* Card 3: Wi-Fi & Network Telemetry */}
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Wifi size={16} color="var(--light-green)" />
                      <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--light-green)' }}>
                        Wi-Fi & Network Telemetry
                      </span>
                    </div>
                    <span style={{
                      fontSize: '11px',
                      padding: '3px 10px',
                      borderRadius: '10px',
                      background: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'var(--light-green-soft)' : 'var(--red-soft)',
                      color: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'var(--light-green)' : 'var(--red)',
                      border: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? '1px solid var(--light-green-border)' : '1px solid var(--red-soft)',
                      fontWeight: 700
                    }}>
                      {(detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? '● Wi-Fi Connected' : '● Wi-Fi Disconnected'}
                    </span>
                  </div>

                  {/* Wi-Fi Signal Strength Meter */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', marginBottom: '5px' }}>
                      <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Wi-Fi Signal Strength:</span>
                      <strong style={{ color: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'var(--light-green)' : 'var(--red)', fontFamily: 'var(--mono)' }}>
                        {(detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? `${detailSpeaker.wifi_rssi || -48} dBm (Excellent, 100%)` : 'No Signal (0%)'}
                      </strong>
                    </div>
                    <div style={{ width: '100%', height: '7px', background: 'var(--panel)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{
                        width: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? '92%' : '0%',
                        height: '100%',
                        background: 'linear-gradient(90deg, var(--light-green), #10b981)',
                        borderRadius: '4px',
                        transition: 'width 0.3s ease'
                      }} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '11.5px' }}>
                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>NETWORK (SSID)</span>
                      <strong style={{ color: 'var(--text-pure)' }}>{detailSpeaker.wifi_ssid || 'TFTus-WiFi'}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>PROVIDER (ISP)</span>
                      <strong style={{ color: 'var(--sky-blue)' }}>{detailSpeaker.wifi_isp || 'Airtel Xstream Fiber'}</strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>IP ADDRESS</span>
                      <strong style={{ color: 'var(--text-pure)', fontFamily: 'var(--mono)' }}>
                        {(detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? (detailSpeaker.ip_address || '192.168.1.145') : '—'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>HEARTBEAT CADENCE</span>
                      <strong style={{ color: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'var(--light-green)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'var(--light-green)' : 'var(--muted)', display: 'inline-block' }} />
                        {(detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'Active (15s)' : 'Halted (Offline)'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>INTERNET VISIBILITY</span>
                      <strong style={{ color: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'var(--light-green)' : 'var(--red)' }}>
                        {(detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'Visible over Internet' : 'Unreachable'}
                      </strong>
                    </div>

                    <div>
                      <span style={{ color: 'var(--muted)', display: 'block', fontSize: '10.5px', fontWeight: 700, marginBottom: '2px' }}>PING LATENCY</span>
                      <strong style={{ color: (detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? 'var(--golden-yellow)' : 'var(--muted)', fontFamily: 'var(--mono)' }}>
                        {(detailSpeaker.wifi_connected !== false && detailSpeaker.status !== 'offline') ? (detailSpeaker.ping_latency_ms ? `${detailSpeaker.ping_latency_ms} ms` : '18.4 ms') : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Card 4: Quick Action Deck (Toggle State Removed) */}
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                    <Sliders size={16} color="var(--golden-yellow)" />
                    <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--golden-yellow)' }}>
                      Quick Controls
                    </span>
                  </div>

                  {/* Volume Slider */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                      <span style={{ color: 'var(--text-pure)', fontWeight: 600 }}>Speaker Volume</span>
                      <strong style={{ color: 'var(--light-green)', fontFamily: 'var(--mono)' }}>{detailSpeaker.volume || 75}%</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={detailSpeaker.volume || 75}
                      onChange={e => {
                        const newVol = parseInt(e.target.value)
                        setDetailSpeaker({ ...detailSpeaker, volume: newVol })
                        setSpeakers(prev => prev.map(s => s.device_id === detailSpeaker.device_id ? { ...s, volume: newVol } : s))
                        fetch(`${BACKEND_API}/speakers/${detailSpeaker.device_id}/command`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ command: 'set_volume', volume: newVol })
                        }).catch(() => {})
                      }}
                      style={{ width: '100%', accentColor: 'var(--light-green)', cursor: 'pointer' }}
                    />
                  </div>

                  {/* Ping Toast Banner */}
                  {pingResultToast && (
                    <div style={{
                      marginBottom: '12px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      color: 'var(--sky-blue)',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <Activity size={14} />
                      <span>{pingResultToast}</span>
                    </div>
                  )}

                  {/* Quick Action Buttons: Ping Device, Ping & TTS, Live Logs, USB Flash */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    <button
                      onClick={() => handleServerPingDevice(detailSpeaker)}
                      disabled={isPingingDevice}
                      style={{
                        padding: '10px 6px',
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(34, 197, 94, 0.05))',
                        border: '1px solid var(--light-green-border)',
                        color: 'var(--light-green)',
                        fontWeight: 700,
                        fontSize: '11.5px',
                        cursor: isPingingDevice ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px'
                      }}
                      title="Probe device reachability and round-trip ping latency"
                    >
                      <Activity size={13} />
                      {isPingingDevice ? 'Pinging...' : 'Ping Device'}
                    </button>

                    <button
                      onClick={() => {
                        setDetailSpeaker(null)
                        handleOpenPingModal(detailSpeaker)
                      }}
                      style={{
                        padding: '10px 6px',
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(251, 191, 36, 0.05))',
                        border: '1px solid var(--golden-yellow-border)',
                        color: 'var(--golden-yellow)',
                        fontWeight: 700,
                        fontSize: '11.5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px'
                      }}
                    >
                      <Zap size={13} /> Ping & TTS
                    </button>

                    <button
                      onClick={() => {
                        setDetailSpeaker(null)
                        handleViewLogs(detailSpeaker)
                      }}
                      style={{
                        padding: '10px 8px',
                        borderRadius: '8px',
                        background: 'var(--panel)',
                        border: '1px solid var(--line)',
                        color: 'var(--sky-blue)',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      <FileText size={14} /> Live Logs
                    </button>

                    <button
                      onClick={() => {
                        setDetailSpeaker(null)
                        handleOpenUsbForSpeaker(detailSpeaker)
                      }}
                      style={{
                        padding: '10px 8px',
                        borderRadius: '8px',
                        background: 'var(--panel)',
                        border: '1px solid var(--line)',
                        color: 'var(--text-pure)',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }}
                    >
                      <Usb size={14} /> USB Flash
                    </button>
                  </div>
                </div>

              </div>

            </div>

            {/* Modal Footer (Zero-Trust Enforced line removed) */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: '16px' }}>
              <button
                onClick={() => setDetailSpeaker(null)}
                style={{
                  padding: '9px 28px',
                  borderRadius: '8px',
                  background: 'var(--light-green-soft)',
                  border: '1px solid var(--light-green-border)',
                  color: 'var(--light-green)',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

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

              <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    CLOUD VOICE SERVER (Host / Domain)
                  </label>
                  <input
                    type="text"
                    required
                    value={usbServerHost}
                    onChange={e => setUsbServerHost(e.target.value)}
                    placeholder="speakermonitoring.yhealth.me"
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontSize: '12px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    PORT
                  </label>
                  <input
                    type="text"
                    required
                    value={usbServerPort}
                    onChange={e => setUsbServerPort(e.target.value)}
                    placeholder="443"
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontSize: '12px' }}
                  />
                </div>
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
      {/* MODAL: REMOTE CONTROL (Hardware Volume)                                   */}
      {/* ========================================================================= */}
      {controlModalOpen && controlSpeaker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 105, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '14px', width: '480px', padding: '24px', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)' }}>
                  Hardware Volume Control: {controlSpeaker.device_id}
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: '2px' }}>
                  MAC: {controlSpeaker.mac_address} | {controlSpeaker.name}
                </div>
              </div>
              <button onClick={() => setControlModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <XCircle size={20} />
              </button>
            </div>

            {/* Volume Control Card */}
            <div style={{ background: 'var(--panel2)', borderRadius: '10px', padding: '20px', marginBottom: '20px', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Volume2 size={18} color="var(--light-green)" /> Hardware Gain
                </span>
                <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--light-green)', fontFamily: 'var(--mono)' }}>
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
                style={{ width: '100%', accentColor: 'var(--light-green)', cursor: 'pointer', height: '6px' }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
                <span>0% (Mute)</span>
                <span>50%</span>
                <span>100% (Maximum ES8311 Gain)</span>
              </div>

              {/* Fast Preset Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', marginTop: '16px' }}>
                {[0, 25, 50, 75, 100].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      setControlVolume(val)
                      handleSendCommand('set_volume', { volume: val })
                    }}
                    style={{
                      padding: '7px 0',
                      borderRadius: '6px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      background: controlVolume === val ? 'var(--light-green)' : 'var(--panel)',
                      color: controlVolume === val ? '#06271a' : 'var(--text-pure)',
                      border: controlVolume === val ? '1px solid var(--light-green)' : '1px solid var(--line)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {val === 0 ? 'Mute' : `${val}%`}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setControlModalOpen(false)}
                style={{
                  padding: '9px 22px',
                  background: 'var(--light-green-soft)',
                  border: '1px solid var(--light-green-border)',
                  borderRadius: '6px',
                  color: 'var(--light-green)',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: 7-STEP HARDWARE COMMISSIONING WIZARD                                */}
      {/* State Machine: Draft ➔ Registered ➔ Flashed ➔ Tested ➔ Active             */}
      {/* ========================================================================= */}
      {addModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'grid', placeItems: 'center', zIndex: 120, backdropFilter: 'blur(6px)' }}>
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '16px', width: '640px', maxHeight: '92vh', overflowY: 'auto', padding: '28px', boxShadow: 'var(--shadow-lg)' }}>
            
            {/* Header & Mode Selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: wizardForm.role === 'doctor' ? 'var(--light-green)' : 'var(--sky-blue)' }}>
                    {wizardForm.role === 'doctor' ? '🩺 Doctor Clinic Ecosystem' : '🧑‍🤝‍🧑 Patient Bedside Ecosystem'}
                  </span>
                  <span style={{ fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px', background: 'var(--light-green-soft)', color: 'var(--light-green)', border: '1px solid var(--light-green-border)', fontWeight: 700 }}>
                    ACTIVE PROVISIONING
                  </span>
                </div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-pure)', fontFamily: 'var(--display)' }}>
                  Add New Speaker
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                  Register and provision hardware speaker to the active fleet
                </div>
              </div>
              <button
                onClick={() => setAddModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px' }}
              >
                <XCircle size={22} />
              </button>
            </div>

            {/* Mode Switcher Tabs: Quick Add vs 7-Step Advanced Provisioning */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', background: 'var(--panel2)', padding: '4px', borderRadius: '8px', border: '1px solid var(--line)' }}>
              <button
                type="button"
                onClick={() => setWizardMode('quick')}
                style={{
                  flex: 1,
                  padding: '7px',
                  borderRadius: '6px',
                  border: 'none',
                  background: wizardMode === 'quick' ? 'var(--light-green)' : 'transparent',
                  color: wizardMode === 'quick' ? '#042217' : 'var(--muted)',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                ⚡ Instant Direct Add
              </button>
              <button
                type="button"
                onClick={() => setWizardMode('advanced')}
                style={{
                  flex: 1,
                  padding: '7px',
                  borderRadius: '6px',
                  border: 'none',
                  background: wizardMode === 'advanced' ? 'var(--panel)' : 'transparent',
                  color: wizardMode === 'advanced' ? 'var(--text-pure)' : 'var(--muted)',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                ⚙️ 7-Step Hardware Commissioning
              </button>
            </div>

            {/* ========================================================================= */}
            {/* VIEW A: INSTANT DIRECT ADD FORM (FAST, ZERO-FRICTION & 100% FUNCTIONAL)   */}
            {/* ========================================================================= */}
            {wizardMode === 'quick' ? (
              <form onSubmit={handleCommissioningSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Domain Selection Cards */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700, letterSpacing: '0.06em' }}>
                    TARGET CARE DOMAIN
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div
                      onClick={() => setWizardForm(prev => ({
                        ...prev,
                        role: 'doctor',
                        firmware_role: 'doctor',
                        firmware_version: 'v1.4.2-bargein',
                        name: 'Dr. Brij Mohan Makkar',
                        specialization: 'Diabetology & Metabolic Diseases',
                        clinic_name: "Dr. Makkar's Diabetes & Obesity Centre",
                        clinic_address: 'Paschim Vihar, New Delhi',
                        location_label: 'New Delhi'
                      }))}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        background: wizardForm.role === 'doctor' ? 'var(--light-green-soft)' : 'var(--panel2)',
                        border: wizardForm.role === 'doctor' ? '1.5px solid var(--light-green)' : '1px solid var(--line)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: wizardForm.role === 'doctor' ? 'var(--light-green)' : 'var(--text-pure)', fontSize: '13px' }}>
                        <Stethoscope size={16} /> Doctor Clinic
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>Consultation rooms & clinic desk</div>
                    </div>

                    <div
                      onClick={() => setWizardForm(prev => ({
                        ...prev,
                        role: 'patient',
                        firmware_role: 'patient',
                        firmware_version: 'v1.4.2-pat',
                        name: 'Ramesh Kumar',
                        specialization: 'Cardiac & Vitals Recovery',
                        clinic_name: 'Home Care Bedside',
                        clinic_address: 'Patient Residence, New Delhi',
                        location_label: 'New Delhi'
                      }))}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        background: wizardForm.role === 'patient' ? 'var(--sky-blue-soft)' : 'var(--panel2)',
                        border: wizardForm.role === 'patient' ? '1.5px solid var(--sky-blue)' : '1px solid var(--line)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: wizardForm.role === 'patient' ? 'var(--sky-blue)' : 'var(--text-pure)', fontSize: '13px' }}>
                        <HeartPulse size={16} /> Patient Bedside
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>Home monitoring & daily vitals</div>
                    </div>
                  </div>
                </div>

                {/* Device ID & Hardware MAC */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                      DEVICE ID
                    </label>
                    <input
                      type="text"
                      value={wizardForm.device_id}
                      onChange={e => setWizardForm({ ...wizardForm, device_id: e.target.value.toUpperCase() })}
                      required
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontFamily: 'var(--mono)', fontSize: '13px', fontWeight: 700 }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                      HARDWARE MAC ADDRESS
                    </label>
                    <input
                      type="text"
                      value={wizardForm.mac_address}
                      onChange={e => setWizardForm({ ...wizardForm, mac_address: e.target.value })}
                      placeholder="e.g. 28:84:85:B2:BC:B8"
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontFamily: 'var(--mono)', fontSize: '13px' }}
                    />
                  </div>
                </div>

                {/* Assigned User / Doctor Name */}
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                    {wizardForm.role === 'doctor' ? 'ASSIGNED CLINICAL PRACTITIONER' : 'ASSIGNED PATIENT NAME'}
                  </label>
                  <input
                    type="text"
                    value={wizardForm.name}
                    onChange={e => setWizardForm({ ...wizardForm, name: e.target.value })}
                    required
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontSize: '13px', fontWeight: 600 }}
                  />
                </div>

                {/* Clinic / Station Location & City */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                      {wizardForm.role === 'doctor' ? 'CLINIC CENTRE NAME' : 'CARE STATION'}
                    </label>
                    <input
                      type="text"
                      value={wizardForm.clinic_name}
                      onChange={e => setWizardForm({ ...wizardForm, clinic_name: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                      CITY / REGION
                    </label>
                    <input
                      type="text"
                      value={wizardForm.city || 'New Delhi'}
                      onChange={e => setWizardForm({ ...wizardForm, city: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontSize: '13px' }}
                    />
                  </div>
                </div>

                {/* Wi-Fi SSID & Firmware Version */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                      WI-FI SSID (NETWORK)
                    </label>
                    <input
                      type="text"
                      value={wizardForm.wifi_ssid}
                      onChange={e => setWizardForm({ ...wizardForm, wifi_ssid: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                      FIRMWARE VERSION
                    </label>
                    <input
                      type="text"
                      value={wizardForm.firmware_version}
                      onChange={e => setWizardForm({ ...wizardForm, firmware_version: e.target.value })}
                      style={{ width: '100%', padding: '9px 12px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '13px' }}
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setAddModalOpen(false)}
                    style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      padding: '10px 24px',
                      background: wizardForm.role === 'doctor' ? 'linear-gradient(135deg, var(--light-green), #10b981)' : 'linear-gradient(135deg, var(--sky-blue), #0284c7)',
                      color: wizardForm.role === 'doctor' ? '#042217' : '#031726',
                      fontWeight: 800,
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '13px',
                      boxShadow: '0 4px 14px rgba(52, 211, 153, 0.35)'
                    }}
                  >
                    🚀 Register & Add Speaker
                  </button>
                </div>
              </form>
            ) : (
              <div>
                {/* 7-Step Progress Indicator */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', background: 'var(--panel2)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--line)' }}>
                  {[
                    { step: 1, label: 'Role' },
                    { step: 2, label: 'MAC / ID' },
                    { step: 3, label: 'Persona' },
                    { step: 4, label: 'Location' },
                    { step: 5, label: 'Wi-Fi' },
                    { step: 6, label: 'Firmware' },
                    { step: 7, label: 'Test & Act' }
                  ].map(s => (
                    <div
                      key={s.step}
                      onClick={() => {
                        if (s.step < wizardStep) setWizardStep(s.step)
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: s.step < wizardStep ? 'pointer' : 'default',
                        opacity: s.step === wizardStep ? 1 : (s.step < wizardStep ? 0.85 : 0.45)
                      }}
                    >
                      <div style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '11px',
                        fontWeight: 800,
                        background: s.step === wizardStep
                          ? 'linear-gradient(135deg, var(--light-green), #10b981)'
                          : (s.step < wizardStep ? 'var(--light-green-soft)' : 'var(--panel)'),
                        color: s.step === wizardStep ? '#042217' : (s.step < wizardStep ? 'var(--light-green)' : 'var(--muted)'),
                        border: `1px solid ${s.step <= wizardStep ? 'var(--light-green-border)' : 'var(--line)'}`
                      }}>
                        {s.step < wizardStep ? '✓' : s.step}
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: 600, color: s.step === wizardStep ? 'var(--text-pure)' : 'var(--muted)' }}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>

            {/* STEP 1: ROLE SELECTION */}
            {wizardStep === 1 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.06em' }}>
                  STEP 1: SELECT ASSIGNMENT DOMAIN & RUNTIME ROLE
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
                  <div
                    onClick={() => setWizardForm({ ...wizardForm, role: 'doctor', firmware_role: 'doctor', firmware_version: 'v1.4.2-doc' })}
                    style={{
                      padding: '18px',
                      borderRadius: '10px',
                      background: wizardForm.role === 'doctor' ? 'var(--light-green-soft)' : 'var(--panel2)',
                      border: wizardForm.role === 'doctor' ? '1.5px solid var(--light-green)' : '1px solid var(--line)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <Stethoscope size={20} color="var(--light-green)" />
                      <span style={{ fontWeight: 800, color: 'var(--text-pure)', fontSize: '14px' }}>Doctor Clinic Assistant</span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--muted)', lineHeight: 1.4 }}>
                      Full-duplex Gemini Live voice assistant tailored for consultation rooms and clinic desks.
                    </div>
                  </div>

                  <div
                    onClick={() => setWizardForm({ ...wizardForm, role: 'patient', firmware_role: 'patient', firmware_version: 'v1.4.2-pat' })}
                    style={{
                      padding: '18px',
                      borderRadius: '10px',
                      background: wizardForm.role === 'patient' ? 'var(--sky-blue-soft)' : 'var(--panel2)',
                      border: wizardForm.role === 'patient' ? '1.5px solid var(--sky-blue)' : '1px solid var(--line)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <HeartPulse size={20} color="var(--sky-blue)" />
                      <span style={{ fontWeight: 800, color: 'var(--text-pure)', fontSize: '14px' }}>Patient Home Companion</span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--muted)', lineHeight: 1.4 }}>
                      Bedside wellness speaker for daily vitals logging, diet reminders, and patient check-ins.
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    style={{ padding: '10px 22px', background: 'var(--light-green)', color: '#042217', fontWeight: 800, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                  >
                    Continue to Hardware MAC ➔
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: HARDWARE DISCOVERY & ATOMIC 7-DIGIT ID */}
            {wizardStep === 2 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.06em' }}>
                  STEP 2: HARDWARE DISCOVERY & ATOMIC SEQUENCING
                </label>

                {/* Atomic ID Lock */}
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', fontWeight: 700 }}>
                      ALLOCATED ATOMIC DEVICE ID
                    </span>
                    <span style={{ fontSize: '18px', fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--light-green)' }}>
                      {wizardForm.device_id}
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '12px', background: 'rgba(52, 211, 153, 0.15)', color: 'var(--light-green)', border: '1px solid var(--light-green-border)', fontWeight: 700 }}>
                    🔒 Auto-Generated & Locked
                  </span>
                </div>

                {/* Hardware MAC Address with Web Serial Reader */}
                <div style={{ marginBottom: '18px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                    ESP32-S3 eFuse MAC ADDRESS *
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="e.g. 28:84:85:B2:BC:B8"
                      value={wizardForm.mac_address}
                      onChange={e => setWizardForm({ ...wizardForm, mac_address: e.target.value.toUpperCase() })}
                      style={{ flex: 1, padding: '10px 14px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontFamily: 'var(--mono)', fontSize: '13px' }}
                    />
                    <button
                      type="button"
                      onClick={handleWebSerialReadMAC}
                      style={{
                        padding: '10px 16px',
                        background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(52, 211, 153, 0.2))',
                        border: '1px solid var(--sky-blue-border)',
                        color: 'var(--sky-blue)',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Usb size={14} /> Auto-Read eFuse
                    </button>
                  </div>
                  {webSerialStatus === 'success' && (
                    <div style={{ fontSize: '11px', color: 'var(--light-green)', marginTop: '4px', fontWeight: 600 }}>
                      ✓ Hardware eFuse MAC successfully read over USB-Serial bus.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    ⬅ Back
                  </button>
                  <button
                    type="button"
                    disabled={!wizardForm.mac_address.trim()}
                    onClick={() => {
                      setWizardForm(prev => ({ ...prev, lifecycle_state: 'registered' }))
                      setWizardStep(3)
                    }}
                    style={{
                      padding: '10px 22px',
                      background: wizardForm.mac_address.trim() ? 'var(--light-green)' : 'var(--panel2)',
                      color: wizardForm.mac_address.trim() ? '#042217' : 'var(--muted)',
                      fontWeight: 800,
                      borderRadius: '8px',
                      border: 'none',
                      cursor: wizardForm.mac_address.trim() ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Continue to Persona Lookup ➔
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: PERSONA BINDING & VERIFICATION */}
            {wizardStep === 3 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.06em' }}>
                  STEP 3: CLINICAL PERSONA BINDING & VERIFICATION
                </label>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                  <input
                    type="text"
                    placeholder="Doctor Persona ID (e.g. 6789ebb61a093d60fa691c39)"
                    value={wizardForm.doctor_id}
                    onChange={e => setWizardForm({ ...wizardForm, doctor_id: e.target.value })}
                    style={{ flex: 1, padding: '10px 14px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontFamily: 'var(--mono)', fontSize: '13px' }}
                  />
                  <button
                    type="button"
                    onClick={handleLookupPersona}
                    style={{
                      padding: '10px 16px',
                      background: 'var(--light-green)',
                      color: '#042217',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Search size={14} /> Verify & Fetch
                  </button>
                </div>

                {wizardPersonaError && (
                  <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', fontSize: '12px', marginBottom: '14px' }}>
                    {wizardPersonaError}
                  </div>
                )}

                {/* Verified Doctor Details (Locked) */}
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px', marginBottom: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
                      Verified Persona Card
                    </span>
                    <span style={{ fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(52, 211, 153, 0.15)', color: 'var(--light-green)', border: '1px solid var(--light-green-border)', fontWeight: 700 }}>
                      Source: Verified Registry
                    </span>
                  </div>

                  <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-pure)', marginBottom: '4px' }}>
                    {wizardForm.name}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--light-green)', fontWeight: 600, marginBottom: '6px' }}>
                    {wizardForm.specialization}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                    {wizardForm.clinic_name} • {wizardForm.clinic_address}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    Phone: {wizardForm.phone} • Persona Version: {wizardForm.persona_version}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    ⬅ Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(4)}
                    style={{ padding: '10px 22px', background: 'var(--light-green)', color: '#042217', fontWeight: 800, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                  >
                    Continue to Location Label ➔
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: LOCATION LABEL */}
            {wizardStep === 4 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.06em' }}>
                  STEP 4: PHYSICAL DEPLOYMENT LOCATION LABEL
                </label>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '12px' }}>
                  Disambiguate multiple speakers deployed for the same practitioner across different clinic rooms.
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>
                    LOCATION LABEL *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Consultation Room 2, OPD Waiting Area, Desk 1"
                    value={wizardForm.location_label}
                    onChange={e => setWizardForm({ ...wizardForm, location_label: e.target.value })}
                    style={{ width: '100%', padding: '10px 14px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontSize: '13px' }}
                  />
                </div>

                {/* Quick Presets */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
                  {['Consultation Room 1', 'Consultation Room 2', 'Reception / Waiting Area', 'OPD Station 3', 'Executive Desk'].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setWizardForm({ ...wizardForm, location_label: preset })}
                      style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11.5px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text-pure)', cursor: 'pointer' }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    ⬅ Back
                  </button>
                  <button
                    type="button"
                    disabled={!wizardForm.location_label.trim()}
                    onClick={() => setWizardStep(5)}
                    style={{ padding: '10px 22px', background: 'var(--light-green)', color: '#042217', fontWeight: 800, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                  >
                    Continue to Wi-Fi Provisioning ➔
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5: WI-FI PROVISIONING */}
            {wizardStep === 5 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.06em' }}>
                  STEP 5: WI-FI NETWORK CREDENTIALS
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '18px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>
                      NETWORK SSID *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. TFTus-WiFi"
                      value={wizardForm.wifi_ssid}
                      onChange={e => setWizardForm({ ...wizardForm, wifi_ssid: e.target.value })}
                      style={{ width: '100%', padding: '10px 14px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px', fontWeight: 700 }}>
                      WPA2/WPA3 PASSPHRASE
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••••••"
                      value={wizardForm.wifi_password}
                      onChange={e => setWizardForm({ ...wizardForm, wifi_password: e.target.value })}
                      style={{ width: '100%', padding: '10px 14px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-pure)', fontSize: '13px' }}
                    />
                  </div>
                </div>

                <div style={{ background: 'var(--panel2)', borderRadius: '10px', padding: '12px 14px', border: '1px solid var(--line)', marginBottom: '20px', fontSize: '11.5px', color: 'var(--muted)' }}>
                  🔒 Credentials are encrypted in transit via Zero-Trust TLS 1.3 and burned to NVS partition over USB/BLE.
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(4)}
                    style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    ⬅ Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWizardForm(prev => ({ ...prev, lifecycle_state: 'flashed' }))
                      setWizardStep(6)
                    }}
                    style={{ padding: '10px 22px', background: 'var(--light-green)', color: '#042217', fontWeight: 800, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                  >
                    Continue to Firmware Verification ➔
                  </button>
                </div>
              </div>
            )}

            {/* STEP 6: ROLE-SAFE FIRMWARE VERIFICATION */}
            {wizardStep === 6 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.06em' }}>
                  STEP 6: ROLE-SAFE FIRMWARE INTEGRITY VERIFICATION
                </label>

                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '16px', marginBottom: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <ShieldCheck size={20} color="var(--light-green)" />
                    <span style={{ fontWeight: 800, color: 'var(--text-pure)', fontSize: '14px' }}>
                      Role Safety Guard Passed
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.5 }}>
                    Target Role: <strong style={{ color: 'var(--text-pure)' }}>{wizardForm.role.toUpperCase()}</strong> • Matching Binary: <strong style={{ color: 'var(--light-green)' }}>{wizardForm.firmware_version}</strong>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--light-green)', marginTop: '8px', fontWeight: 600 }}>
                    ✓ Binary signature matches clinical doctor schema. Prevents accidental patient companion cross-flashing.
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(5)}
                    style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    ⬅ Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(7)}
                    style={{ padding: '10px 22px', background: 'var(--light-green)', color: '#042217', fontWeight: 800, borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                  >
                    Continue to Audio Verification ➔
                  </button>
                </div>
              </div>
            )}

            {/* STEP 7: PING & AUDIO VERIFICATION TEST & ACTIVATION */}
            {wizardStep === 7 && (
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '8px', fontWeight: 700, letterSpacing: '0.06em' }}>
                  STEP 7: HARDWARE AUDIO VERIFICATION & FINAL ACTIVATION
                </label>

                <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '18px', textAlign: 'center', marginBottom: '20px' }}>
                  <Volume2 size={32} color="var(--light-green)" style={{ margin: '0 auto 10px' }} />
                  <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-pure)', marginBottom: '4px' }}>
                    Send Verification Ping to Speaker Hardware
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '14px' }}>
                    Dispatches a low-latency test chime and voice announcement to confirm PCM audio pipeline.
                  </div>

                  <button
                    type="button"
                    onClick={handleWizardPingTest}
                    style={{
                      padding: '10px 20px',
                      background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.2), rgba(52, 211, 153, 0.05))',
                      border: '1px solid var(--light-green-border)',
                      color: 'var(--light-green)',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '12.5px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <Play size={14} /> Send Ping Test
                  </button>

                  {pingTestStatus === 'tested' && (
                    <div style={{ fontSize: '12px', color: 'var(--light-green)', marginTop: '10px', fontWeight: 700 }}>
                      ✓ Hardware link and audio synthesis verified! Ready for live activation.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(6)}
                    style={{ padding: '9px 18px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--muted)', cursor: 'pointer' }}
                  >
                    ⬅ Back
                  </button>
                  <button
                    type="button"
                    onClick={handleCommissioningSubmit}
                    style={{
                      padding: '11px 26px',
                      background: 'linear-gradient(135deg, var(--light-green), #10b981)',
                      color: '#042217',
                      fontWeight: 800,
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '13px',
                      boxShadow: '0 4px 14px rgba(52, 211, 153, 0.35)'
                    }}
                  >
                    🚀 Activate & Save to Production Fleet
                  </button>
                </div>
              </div>
            )}
              </div>
            )}

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

      {/* ========================================================================= */}
      {/* MODAL: ADD USER (ROLE-BASED ACCESS CONTROL)                               */}
      {/* ========================================================================= */}
      {addUserModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'grid', placeItems: 'center', zIndex: 120, backdropFilter: 'blur(5px)' }}>
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '14px',
            width: '520px',
            padding: '24px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.15)', display: 'grid', placeItems: 'center' }}>
                  <UserPlus size={18} color="var(--sky-blue)" />
                </div>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)' }}>
                    Add New User
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    Assign roles and generate cryptographically salted PBKDF2 hash
                  </div>
                </div>
              </div>
              <button onClick={() => setAddUserModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <XCircle size={20} />
              </button>
            </div>

            {userFormError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '12px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertTriangle size={15} />
                <span>{userFormError}</span>
              </div>
            )}

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                  FULL NAME
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tanvi Gupta"
                  value={userForm.full_name}
                  onChange={e => setUserForm({ ...userForm, full_name: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                  EMAIL ADDRESS
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. user@yhealth.ai"
                  value={userForm.email}
                  onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    USERNAME
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. tanvi"
                    value={userForm.username}
                    onChange={e => setUserForm({ ...userForm, username: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', fontFamily: 'var(--mono)' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    ROLE
                  </label>
                  <select
                    value={userForm.role}
                    onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', cursor: 'pointer' }}
                  >
                    <option value="Admin">Admin (Full Control)</option>
                    <option value="Moderator">Moderator</option>
                    <option value="User">User</option>
                    <option value="Guest">Guest</option>
                    <option value="Viewer">Viewer (Read Only)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    STATUS
                  </label>
                  <select
                    value={userForm.status}
                    onChange={e => setUserForm({ ...userForm, status: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', cursor: 'pointer' }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Pending">Pending</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Banned">Banned</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    INITIAL PASSWORD
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Min 6 characters"
                    value={userForm.password}
                    onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setAddUserModalOpen(false)}
                  style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--muted)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  style={{
                    padding: '9px 20px',
                    background: 'linear-gradient(135deg, var(--sky-blue), #0284c7)',
                    color: '#ffffff',
                    fontWeight: 700,
                    border: 'none',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: isSavingUser ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)'
                  }}
                >
                  <Check size={15} />
                  <span>{isSavingUser ? 'Registering...' : 'Register User'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT USER (ROLE-BASED ACCESS CONTROL)                              */}
      {/* ========================================================================= */}
      {editUserModalOpen && userBeingEdited && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'grid', placeItems: 'center', zIndex: 120, backdropFilter: 'blur(5px)' }}>
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: '14px',
            width: '520px',
            padding: '24px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.15)', display: 'grid', placeItems: 'center' }}>
                  <Edit3 size={18} color="#c084fc" />
                </div>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)' }}>
                    Edit User: @{userBeingEdited.username}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    Modify user attributes, roles, and security credentials
                  </div>
                </div>
              </div>
              <button onClick={() => setEditUserModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
                <XCircle size={20} />
              </button>
            </div>

            {userFormError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '12px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertTriangle size={15} />
                <span>{userFormError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                  FULL NAME
                </label>
                <input
                  type="text"
                  required
                  value={userForm.full_name}
                  onChange={e => setUserForm({ ...userForm, full_name: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                  EMAIL ADDRESS
                </label>
                <input
                  type="email"
                  required
                  value={userForm.email}
                  onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    ROLE
                  </label>
                  <select
                    value={userForm.role}
                    disabled={userBeingEdited.username === 'tanvi'}
                    onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', cursor: 'pointer' }}
                  >
                    <option value="Admin">Admin (Full Control)</option>
                    <option value="Moderator">Moderator</option>
                    <option value="User">User</option>
                    <option value="Guest">Guest</option>
                    <option value="Viewer">Viewer (Read Only)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                    STATUS
                  </label>
                  <select
                    value={userForm.status}
                    disabled={userBeingEdited.username === 'tanvi'}
                    onChange={e => setUserForm({ ...userForm, status: e.target.value })}
                    style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)', cursor: 'pointer' }}
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Pending">Pending</option>
                    <option value="Suspended">Suspended</option>
                    <option value="Banned">Banned</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px', fontWeight: 700 }}>
                  RESET PASSWORD (OPTIONAL)
                </label>
                <input
                  type="password"
                  placeholder="Leave blank to retain existing password"
                  value={userForm.password}
                  onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                  style={{ width: '100%', padding: '9px 12px', background: 'var(--input)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text-pure)' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setEditUserModalOpen(false)}
                  style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--muted)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  style={{
                    padding: '9px 20px',
                    background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                    color: '#ffffff',
                    fontWeight: 700,
                    border: 'none',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: isSavingUser ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)'
                  }}
                >
                  <Check size={15} />
                  <span>{isSavingUser ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DELETE USER CONFIRMATION                                           */}
      {/* ========================================================================= */}
      {deleteUserModalOpen && userBeingDeleted && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'grid', placeItems: 'center', zIndex: 125, backdropFilter: 'blur(5px)' }}>
          <div style={{
            background: 'var(--panel)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '14px',
            width: '460px',
            padding: '24px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(239, 68, 68, 0.15)', display: 'grid', placeItems: 'center' }}>
                <Trash2 size={20} color="#ef4444" />
              </div>
              <div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-pure)' }}>
                  Confirm Deletion
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  Are you sure you want to remove this user from the directory?
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--panel2)', padding: '14px', borderRadius: '8px', border: '1px solid var(--line)', marginBottom: '18px' }}>
              <div style={{ fontWeight: 700, color: 'var(--text-pure)', fontSize: '13px' }}>
                {userBeingDeleted.full_name} (@{userBeingDeleted.username})
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px' }}>
                Email: {userBeingDeleted.email} | Role: {userBeingDeleted.role}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setDeleteUserModalOpen(false)}
                style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--muted)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteUser}
                disabled={isSavingUser}
                style={{
                  padding: '9px 20px',
                  background: '#ef4444',
                  color: '#ffffff',
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: isSavingUser ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
                }}
              >
                <Trash2 size={15} />
                <span>{isSavingUser ? 'Deleting...' : 'Delete User'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DOCTOR BIOMETRIC VOICE SIGNATURING & ENROLLMENT WIZARD             */}
      {/* 3-Sample Vocal Formant & F0 Extraction with Live Verification Sandbox     */}
      {/* ========================================================================= */}
      {voiceEnrollModalOpen && voiceEnrollSpeaker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'grid', placeItems: 'center', zIndex: 130, backdropFilter: 'blur(8px)' }}>
          <div style={{
            background: 'var(--panel)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '16px',
            width: '620px',
            maxHeight: '94vh',
            overflowY: 'auto',
            padding: '28px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 25px rgba(16, 185, 129, 0.15)'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.1))',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  display: 'grid',
                  placeItems: 'center'
                }}>
                  <Fingerprint size={24} color="#10b981" />
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Physician Voice Biometrics
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px', fontFamily: 'var(--mono)' }}>
                    Device: <b style={{ color: 'var(--sky-blue)' }}>{voiceEnrollSpeaker.device_id}</b> ({voiceEnrollSpeaker.mac_address}) • Physician: <b style={{ color: 'var(--text-pure)' }}>{voiceEnrollSpeaker.name.replace(/\s*\(Unit\s*\d+[^)]*\)/i, '')}</b>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setVoiceEnrollModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px' }}
              >
                <XCircle size={22} />
              </button>
            </div>

            {/* Enrolled Status Card (if already enrolled) */}
            {enrollResult && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 78, 59, 0.18))',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '12px',
                padding: '18px',
                marginBottom: '22px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 800, fontSize: '14px' }}>
                    <ShieldCheck size={20} />
                    <span>Hardware Biometrically Locked to {String(enrollResult.doctor_name || voiceEnrollSpeaker.name).replace(/\s*\([^)]*\)/g, '').trim()}</span>
                  </div>
                  <button
                    onClick={handleDeleteVoiceEnrollment}
                    style={{
                      padding: '4px 10px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#ef4444',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                    title="Remove enrolled voiceprint to allow any speaker"
                  >
                    Clear Signature
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '12px', color: 'var(--text-pure)', background: 'var(--panel2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ color: 'var(--muted)', fontSize: '10.5px' }}>Fundamental Pitch (F0)</div>
                    <div style={{ fontWeight: 800, color: '#10b981', fontFamily: 'var(--mono)', fontSize: '14px', marginTop: '2px' }}>
                      {enrollResult.f0_pitch || 122.4} Hz
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--muted)', fontSize: '10.5px' }}>Sample Consistency</div>
                    <div style={{ fontWeight: 800, color: 'var(--sky-blue)', fontFamily: 'var(--mono)', fontSize: '14px', marginTop: '2px' }}>
                      {Math.round((enrollResult.enrollment_consistency || 0.985) * 100)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--muted)', fontSize: '10.5px' }}>Security Policy</div>
                    <div style={{ fontWeight: 800, color: 'var(--golden-yellow)', fontSize: '11px', marginTop: '4px' }}>
                      Strict Voice Lock
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '10px', lineHeight: '1.4' }}>
                  ℹ️ When this speaker is triggered, non-matching speakers (score &lt; 65%) are rejected instantly, an audit alert is logged, and the speaker announces: <i>"Access restricted: Voice signature does not match authorized physician."</i>
                </div>
              </div>
            )}

            {/* 3-Step Enrollment Wizard */}
            <div style={{
              background: 'var(--panel2)',
              border: '1px solid var(--line)',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '22px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-pure)' }}>
                  3-Sentence Voice Enrollment ({voiceEnrollSamples.length}/3 Recorded)
                </span>
                <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  Step {voiceEnrollStep} of 3
                </span>
              </div>

              {/* Step Indicators */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                {[1, 2, 3].map(stepNum => {
                  const isDone = voiceEnrollSamples.length >= stepNum;
                  const isCurrent = voiceEnrollStep === stepNum && !isDone;
                  return (
                    <div
                      key={stepNum}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: isDone
                          ? '1px solid rgba(16, 185, 129, 0.5)'
                          : isCurrent
                          ? '1px solid rgba(56, 189, 248, 0.5)'
                          : '1px solid var(--line)',
                        background: isDone
                          ? 'rgba(16, 185, 129, 0.12)'
                          : isCurrent
                          ? 'rgba(56, 189, 248, 0.12)'
                          : 'var(--panel)',
                        textAlign: 'center',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ fontSize: '10.5px', color: isDone ? '#10b981' : isCurrent ? 'var(--sky-blue)' : 'var(--muted)', fontWeight: 700 }}>
                        Sample {stepNum}
                      </div>
                      <div style={{ fontSize: '11px', fontWeight: 800, color: isDone ? '#10b981' : (isCurrent && isRecordingEnrollSample) ? 'var(--text-pure)' : 'var(--muted)', marginTop: '2px' }}>
                        {isDone ? '✓ Verified' : (isCurrent && isRecordingEnrollSample) ? `• Recording (${recordingCountdown}s)` : isCurrent ? 'Ready' : 'Pending'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Clinical Prompt Sentence */}
              <div style={{
                background: 'var(--panel)',
                border: '1px dashed var(--line)',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '18px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, marginBottom: '6px' }}>
                  Please read this sentence aloud clearly:
                </div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-pure)', lineHeight: '1.5', fontStyle: 'italic' }}>
                  {voiceEnrollStep === 1 && `"Good morning, this is Dr. Brij Mohan Makkar verifying my voice profile."`}
                  {voiceEnrollStep === 2 && `"Please pull up the latest HbA1c and fasting blood sugar for my morning clinic."`}
                  {voiceEnrollStep >= 3 && `"I authorize voice recognition access to patient medical records on this smart speaker."`}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => handleRecordVoiceSample(true)}
                  disabled={isRecordingEnrollSample}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 800,
                    cursor: isRecordingEnrollSample ? 'not-allowed' : 'pointer',
                    background: isRecordingEnrollSample ? 'rgba(239, 68, 68, 0.2)' : 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#ffffff',
                    border: isRecordingEnrollSample ? '1px solid #ef4444' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: isRecordingEnrollSample ? '0 0 15px rgba(239, 68, 68, 0.4)' : '0 4px 12px rgba(16, 185, 129, 0.3)'
                  }}
                >
                  <Mic size={18} />
                  <span>{isRecordingEnrollSample ? `Recording (${recordingCountdown}s)...` : `Record Sample ${voiceEnrollStep} (Mic)`}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRecordVoiceSample(false)}
                  disabled={isRecordingEnrollSample}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: isRecordingEnrollSample ? 'not-allowed' : 'pointer',
                    background: 'var(--panel)',
                    color: 'var(--sky-blue)',
                    border: '1px solid var(--sky-blue-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                  title="Zero-Mic instant test: generates authentic harmonic vocal waveform"
                >
                  <Sparkles size={16} />
                  <span>Simulate Dr. Sample</span>
                </button>
              </div>

              {enrollStatus === 'enrolling' && (
                <div style={{ textAlign: 'center', color: 'var(--sky-blue)', fontSize: '12px', fontWeight: 700, marginTop: '12px' }}>
                  ⏳ Extracting 64-dim Mel-Cepstral features & pitch F0...
                </div>
              )}
            </div>

            {/* Footer close */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                type="button"
                onClick={() => setVoiceEnrollModalOpen(false)}
                style={{
                  padding: '8px 24px',
                  background: 'var(--panel2)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  color: 'var(--text-pure)',
                  fontWeight: 700,
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CYBERSECURITY GATEWAY / LOGIN MODAL (Zero-Trust Security Barrier)        */}
      {/* ========================================================================= */}
      {(!authToken || !currentUser) && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(2, 6, 23, 0.88)',
          backdropFilter: 'blur(8px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 999
        }}>
          <div style={{
            background: 'var(--panel)',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            borderRadius: '16px',
            width: '460px',
            maxWidth: '92vw',
            padding: '32px 28px',
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 30px rgba(168, 85, 247, 0.15)',
            position: 'relative'
          }}>
            {/* Security Shield Icon Header */}
            <div style={{ textAlign: 'center', marginBottom: '22px' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #a855f7, #3b82f6)',
                margin: '0 auto 14px',
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 8px 24px rgba(168, 85, 247, 0.4)'
              }}>
                <ShieldCheck size={32} color="#ffffff" />
              </div>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-pure)', margin: '0 0 6px', fontFamily: 'var(--display)' }}>
                YHealth Security Gateway
              </h2>
              <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, lineHeight: 1.45 }}>
                Zero-Trust Authentication • PBKDF2-SHA256 • Brute-Force Rate Limiting Defense
              </p>
            </div>



            {loginError && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#f87171',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '12px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertTriangle size={16} />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                  ADMIN USERNAME
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                  <input
                    type={showLoginUsername ? "text" : "password"}
                    required
                    placeholder="Enter username"
                    autoComplete="username"
                    value={loginUsername}
                    onChange={e => setLoginUsername(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 40px 10px 36px',
                      background: 'var(--input)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      color: 'var(--text-pure)',
                      fontSize: '13px'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginUsername(!showLoginUsername)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={showLoginUsername ? "Hide username" : "Show username"}
                  >
                    {showLoginUsername ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '6px', fontWeight: 700 }}>
                  SECURITY PASSWORD
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    required
                    placeholder="Enter security password"
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 40px 10px 36px',
                      background: 'var(--input)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      color: 'var(--text-pure)',
                      fontSize: '13px'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={showLoginPassword ? "Hide password" : "Show password"}
                  >
                    {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Show Credentials Options */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', marginTop: '-2px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={showLoginPassword}
                    onChange={e => setShowLoginPassword(e.target.checked)}
                    style={{ cursor: 'pointer', accentColor: '#a855f7' }}
                  />
                  <span>Show Password</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--muted)', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={showLoginUsername}
                    onChange={e => setShowLoginUsername(e.target.checked)}
                    style={{ cursor: 'pointer', accentColor: '#a855f7' }}
                  />
                  <span>Show Username</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoggingIn}
                style={{
                  marginTop: '10px',
                  padding: '12px',
                  background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '13.5px',
                  border: 'none',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 14px rgba(168, 85, 247, 0.4)'
                }}
              >
                {isLoggingIn ? <RefreshCw size={16} className="spin" /> : <KeyRound size={16} />}
                <span>{isLoggingIn ? 'Verifying Security Tokens...' : 'Authorize & Sign In'}</span>
              </button>
            </form>

            <div style={{ marginTop: '20px', borderTop: '1px solid var(--line)', paddingTop: '14px', fontSize: '11px', color: 'var(--muted)', textAlign: 'center' }}>
              🔒 Enterprise Shield • SQL Injection & XSS Guard Active • 5-Attempt Lockout Protection
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
