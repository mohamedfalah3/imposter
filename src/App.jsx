import { useState } from 'react'
import Home from './components/Home'
import Lobby from './components/Lobby'
import GameRoom from './components/GameRoom'
import './App.css'

export default function App() {
  const [screen, setScreen] = useState('home') // home, lobby, game
  const [room, setRoom] = useState(null)
  const [playerId, setPlayerId] = useState(null)

  const handleJoinRoom = (roomData, pId) => {
    setRoom(roomData)
    setPlayerId(pId)
    setScreen('lobby')
  }

  const handleGameStart = (roomData) => {
    setRoom(roomData)
    setScreen('game')
  }

  const handleLeave = () => {
    setRoom(null)
    setPlayerId(null)
    setScreen('home')
  }

  const handleBackToLobby = (roomData) => {
    setRoom(roomData)
    setScreen('lobby')
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
