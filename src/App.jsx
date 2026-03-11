import { useState, useEffect } from 'react'
import Home from './components/Home'
import Lobby from './components/Lobby'
import GameRoom from './components/GameRoom'
import { fetchRoom } from './gameLogic'
import './App.css'

function loadSession() {
  try {
    const raw = sessionStorage.getItem('imposter_session')
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function saveSession(screen, room, playerId) {
  try {
    if (room && playerId) {
      sessionStorage.setItem('imposter_session', JSON.stringify({ screen, roomId: room.id, playerId }))
    } else {
      sessionStorage.removeItem('imposter_session')
    }
  } catch {}
}

export default function App() {
  const [screen, setScreen] = useState('home') // home, lobby, game
  const [room, setRoom] = useState(null)
  const [playerId, setPlayerId] = useState(null)
  const [restoring, setRestoring] = useState(true)

  // Restore session on mount
  useEffect(() => {
    const session = loadSession()
    if (!session) { setRestoring(false); return }
    fetchRoom(session.roomId)
      .then(roomData => {
        // Check the player is still in the room
        if (!roomData.players.some(p => p.id === session.playerId)) {
          sessionStorage.removeItem('imposter_session')
          setRestoring(false)
          return
        }
        setRoom(roomData)
        setPlayerId(session.playerId)
        if (roomData.status === 'waiting') {
          setScreen('lobby')
        } else {
          setScreen('game')
        }
        setRestoring(false)
      })
      .catch(() => {
        sessionStorage.removeItem('imposter_session')
        setRestoring(false)
      })
  }, [])

  const handleJoinRoom = (roomData, pId) => {
    setRoom(roomData)
    setPlayerId(pId)
    setScreen('lobby')
    saveSession('lobby', roomData, pId)
  }

  const handleGameStart = (roomData) => {
    setRoom(roomData)
    setScreen('game')
    saveSession('game', roomData, playerId)
  }

  const handleLeave = () => {
    setRoom(null)
    setPlayerId(null)
    setScreen('home')
    saveSession(null, null, null)
  }

  const handleBackToLobby = (roomData) => {
    setRoom(roomData)
    setScreen('lobby')
    saveSession('lobby', roomData, playerId)
  }

  if (restoring) {
    return (
      <div className="app">
        <div className="app-bg"></div>
        <div className="app-content">
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#aaa' }}>
            <div className="spinner"></div>
            <p>Reconnecting...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="app-bg"></div>
      <div className="app-content">
        {screen === 'home' && (
          <Home onJoinRoom={handleJoinRoom} />
        )}
        {screen === 'lobby' && room && (
          <Lobby
            room={room}
            playerId={playerId}
            onGameStart={handleGameStart}
            onLeave={handleLeave}
          />
        )}
        {screen === 'game' && room && (
          <GameRoom
            room={room}
            playerId={playerId}
            onLeave={handleLeave}
            onBackToLobby={handleBackToLobby}
          />
        )}
      </div>
    </div>
  )
}
