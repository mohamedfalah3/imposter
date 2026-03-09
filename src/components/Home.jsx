import { useState } from 'react'
import { createRoom, joinRoom } from '../gameLogic'

export default function Home({ onJoinRoom }) {
  const [mode, setMode] = useState(null) // 'create' or 'join'
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) { setError('Please enter your name'); return }
    setLoading(true)
    setError('')
    try {
      const room = await createRoom(name.trim())
      const playerId = room.players[0].id
      onJoinRoom(room, playerId)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const handleJoin = async () => {
    if (!name.trim()) { setError('Please enter your name'); return }
    if (!roomCode.trim()) { setError('Please enter the room code'); return }
    setLoading(true)
    setError('')
    try {
      const { room, playerId } = await joinRoom(roomCode.trim(), name.trim())
      onJoinRoom(room, playerId)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="home-container">
      <div className="logo-section">
        <div className="logo-icon">🕵️</div>
        <h1>Imposter Game</h1>
        <p className="subtitle">Kurdish Word Edition</p>
      </div>

      {!mode && (
        <div className="mode-buttons">
          <button className="btn btn-primary btn-large" onClick={() => setMode('create')}>
            <span className="btn-icon">🏠</span>
            Create Room
          </button>
          <button className="btn btn-secondary btn-large" onClick={() => setMode('join')}>
            <span className="btn-icon">🚪</span>
            Join Room
          </button>
        </div>
      )}

      {mode && (
        <div className="form-section">
          <button className="btn-back" onClick={() => { setMode(null); setError('') }}>
            ← Back
          </button>

          <div className="input-group">
            <label>Your Name</label>
            <input
              type="text"
              placeholder="Enter your name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
            />
          </div>

          {mode === 'join' && (
            <div className="input-group">
              <label>Room Code</label>
              <input
                type="text"
                placeholder="Enter room code..."
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={6}
                style={{ direction: 'ltr', textAlign: 'center', letterSpacing: '4px', fontFamily: 'monospace' }}
              />
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          <button
            className="btn btn-primary btn-large"
            onClick={mode === 'create' ? handleCreate : handleJoin}
            disabled={loading}
          >
            {loading ? 'Loading...' : mode === 'create' ? 'Create' : 'Join Room'}
          </button>
        </div>
      )}

      <div className="rules-section">
        <h3>How to Play?</h3>
        <div className="rules-list">
          <div className="rule">
            <span className="rule-num">1</span>
            <span>Create a room or join an existing one</span>
          </div>
          <div className="rule">
            <span className="rule-num">2</span>
            <span>Everyone gets a word — except the imposter</span>
          </div>
          <div className="rule">
            <span className="rule-num">3</span>
            <span>Each player submits a related word without saying the secret word</span>
          </div>
          <div className="rule">
            <span className="rule-num">4</span>
            <span>Vote for who you think the imposter is!</span>
          </div>
        </div>
      </div>
    </div>
  )
}
