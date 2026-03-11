import { useState, useEffect } from 'react'
import { startGame, subscribeToRoom, leaveRoom, updateSettings, fetchRoom } from '../gameLogic'

export default function Lobby({ room: initialRoom, playerId, onGameStart, onLeave }) {
  const [room, setRoom] = useState(initialRoom)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState(initialRoom.settings || { imposters: 1, rounds: 3, turnTime: 30, voteTime: 60, mode: 'classic' })

  const isHost = room.players.find(p => p.id === playerId)?.isHost
  const maxImposters = Math.max(1, Math.floor(room.players.length / 2))

  useEffect(() => {
    const unsubscribe = subscribeToRoom(room.id, (updatedRoom) => {
      // Detect if this player was kicked
      if (!updatedRoom.players.find(p => p.id === playerId)) {
        onLeave()
        return
      }
      setRoom(updatedRoom)
      if (updatedRoom.settings) setSettings(updatedRoom.settings)
      if (updatedRoom.status === 'playing') {
        onGameStart(updatedRoom)
      }
    })
    return unsubscribe
  }, [room.id])

  // Re-fetch room state when tab becomes visible (handles background disconnects)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchRoom(room.id).then(updatedRoom => {
          setRoom(updatedRoom)
          if (updatedRoom.settings) setSettings(updatedRoom.settings)
          if (updatedRoom.status === 'playing') {
            onGameStart(updatedRoom)
          }
        }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [room.id])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
      const input = document.createElement('input')
      input.value = room.code
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleStart = async () => {
    setLoading(true)
    setError('')
    try {
      const updated = await startGame(room.id)
      onGameStart(updated)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const handleLeave = async () => {
    await leaveRoom(room.id, playerId)
    onLeave()
  }

  const handleKick = async (targetId) => {
    try { await leaveRoom(room.id, targetId) } catch {}
  }

  const handleSettingChange = async (key, value) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    try { await updateSettings(room.id, newSettings) } catch {}
  }

  const handleModeChange = async (newMode) => {
    const newSettings = {
      ...settings,
      mode: newMode,
      rounds: newMode === 'quick' ? 2 : (settings.rounds === 2 ? 3 : settings.rounds),
    }
    setSettings(newSettings)
    try { await updateSettings(room.id, newSettings) } catch {}
  }

  return (
    <div className="lobby-container">
      <div className="room-header">
        <h2>Waiting Room</h2>
        <div className="room-code-display" onClick={handleCopy}>
          <span className="code-label">Room Code</span>
          <span className="code-value">{room.code}</span>
          <span className="copy-hint">{copied ? '✓ Copied!' : 'Tap to copy'}</span>
        </div>
      </div>

      <div className="players-section">
        <h3>Players ({room.players.length})</h3>
        <div className="players-grid">
          {room.players.map((player, index) => (
            <div key={player.id} className={`player-card ${player.id === playerId ? 'is-me' : ''}`}>
              <div className="player-avatar">{getAvatar(index)}</div>
              <span className="player-name">{player.name}</span>
              {player.isHost && <span className="host-badge">Host</span>}
              {player.id === playerId && <span className="me-badge">You</span>}
              {isHost && player.id !== playerId && (
                <button
                  className="kick-btn"
                  onClick={() => handleKick(player.id)}
                  title={`Kick ${player.name}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Settings Panel */}
      <div className="settings-section">
        <h3>⚙️ Game Settings</h3>

        {/* Mode Selection */}
        <div className="setting-row">
          <span className="setting-label">🎮 Mode</span>
          {isHost ? (
            <div className="mode-toggle">
              <button
                className={`mode-btn ${settings.mode !== 'quick' ? 'mode-btn-active' : ''}`}
                onClick={() => handleModeChange('classic')}
              >
                Classic
              </button>
              <button
                className={`mode-btn ${settings.mode === 'quick' ? 'mode-btn-active' : ''}`}
                onClick={() => handleModeChange('quick')}
              >
                Quick ⚡
              </button>
            </div>
          ) : (
            <span className="setting-value-display">
              {settings.mode === 'quick' ? 'Quick ⚡' : 'Classic'}
            </span>
          )}
        </div>

        <div className="setting-row">
          <span className="setting-label">🕵️ Imposters</span>
          {isHost ? (
            <div className="setting-controls">
              <button className="setting-btn" onClick={() => handleSettingChange('imposters', settings.imposters - 1)} disabled={settings.imposters <= 1}>−</button>
              <span className="setting-value">{settings.imposters}</span>
              <button className="setting-btn" onClick={() => handleSettingChange('imposters', settings.imposters + 1)} disabled={settings.imposters >= maxImposters}>+</button>
            </div>
          ) : <span className="setting-value-display">{settings.imposters}</span>}
        </div>
        <div className="setting-row">
          <span className="setting-label">🔁 Rounds</span>
          {isHost ? (
            <div className="setting-controls">
              <button className="setting-btn" onClick={() => handleSettingChange('rounds', settings.rounds - 1)} disabled={settings.rounds <= 1 || settings.mode === 'quick'}>−</button>
              <span className="setting-value">{settings.rounds}</span>
              <button className="setting-btn" onClick={() => handleSettingChange('rounds', settings.rounds + 1)} disabled={settings.rounds >= 10 || settings.mode === 'quick'}>+</button>
            </div>
          ) : <span className="setting-value-display">{settings.rounds}</span>}
        </div>
        <div className="setting-row">
          <span className="setting-label">⏱️ Turn Time</span>
          {isHost ? (
            <div className="setting-controls">
              <button className="setting-btn" onClick={() => handleSettingChange('turnTime', settings.turnTime - 10)} disabled={settings.turnTime <= 10}>−</button>
              <span className="setting-value">{settings.turnTime}s</span>
              <button className="setting-btn" onClick={() => handleSettingChange('turnTime', settings.turnTime + 10)} disabled={settings.turnTime >= 120}>+</button>
            </div>
          ) : <span className="setting-value-display">{settings.turnTime}s</span>}
        </div>
        <div className="setting-row">
          <span className="setting-label">🗳️ Vote Time</span>
          {isHost ? (
            <div className="setting-controls">
              <button className="setting-btn" onClick={() => handleSettingChange('voteTime', settings.voteTime - 15)} disabled={settings.voteTime <= 15}>−</button>
              <span className="setting-value">{settings.voteTime}s</span>
              <button className="setting-btn" onClick={() => handleSettingChange('voteTime', settings.voteTime + 15)} disabled={settings.voteTime >= 180}>+</button>
            </div>
          ) : <span className="setting-value-display">{settings.voteTime}s</span>}
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="lobby-actions">
        {isHost ? (
          <button
            className="btn btn-primary btn-large"
            onClick={handleStart}
            disabled={loading || room.players.length < 3}
          >
            {loading ? 'Loading...' : room.players.length < 3 ? `Need 3+ players (${room.players.length}/3)` : 'Start Game 🎮'}
          </button>
        ) : (
          <div className="waiting-msg">
            <div className="spinner"></div>
            <span>Waiting for host to start the game...</span>
          </div>
        )}
        <button className="btn btn-danger" onClick={handleLeave}>
          Leave
        </button>
      </div>
    </div>
  )
}

function getAvatar(index) {
  const avatars = ['😀', '😎', '🤠', '🥳', '😈', '👻', '🤖', '👽', '🦊', '🐸', '🦁', '🐻']
  return avatars[index % avatars.length]
}
