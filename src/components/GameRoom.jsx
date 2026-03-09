import { useState, useEffect, useRef } from 'react'
import { subscribeToRoom, startVoting, castVote, newRound, submitWord } from '../gameLogic'

export default function GameRoom({ room: initialRoom, playerId, onLeave }) {
  const [room, setRoom] = useState(initialRoom)
  const [selectedVote, setSelectedVote] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [myWordInput, setMyWordInput] = useState('')
  const [timeLeft, setTimeLeft] = useState(30)
  const timerRef = useRef(null)
  const autoSubmittedRef = useRef(false)

  const isHost = room.players.find(p => p.id === playerId)?.isHost
  const isImposter = room.imposter_id === playerId
  const hasVoted = room.votes && room.votes[playerId]
  const currentTurnIndex = room.current_turn_index ?? 0
  const currentTurnPlayer = room.players[currentTurnIndex]
  const isMyTurn = currentTurnPlayer?.id === playerId
  const mySubmission = room.word_submissions?.[playerId]

  useEffect(() => {
    const unsubscribe = subscribeToRoom(room.id, (updatedRoom) => {
      setRoom(updatedRoom)
    })
    return unsubscribe
  }, [room.id])

  // Reset timer when turn changes
  useEffect(() => {
    if (room.status !== 'playing') return
    setTimeLeft(30)
    setMyWordInput('')
    autoSubmittedRef.current = false
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [room.current_turn_index, room.round, room.status])

  // Auto-submit when timer runs out and it's this player's turn
  useEffect(() => {
    if (timeLeft === 0 && isMyTurn && !mySubmission && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true
      submitWord(room.id, playerId, myWordInput.trim() || '-').catch(() => {})
    }
  }, [timeLeft, isMyTurn, mySubmission])

  const handleSubmitWord = async () => {
    if (!myWordInput.trim()) return
    setLoading(true)
    try {
      await submitWord(room.id, playerId, myWordInput.trim())
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const handleVote = async (voteTarget) => {
    setLoading(true)
    try {
      await castVote(room.id, playerId, voteTarget)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const handleNewRound = async () => {
    setSelectedVote(null)
    setMyWordInput('')
    setTimeLeft(30)
    setLoading(true)
    try {
      await newRound(room.id)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  // Calculate vote results (skips don't count)
  const getVoteResults = () => {
    const counts = {}
    room.players.forEach(p => { counts[p.id] = 0 })
    Object.values(room.votes || {}).forEach(votedId => {
      if (votedId !== 'skip' && counts[votedId] !== undefined) counts[votedId]++
    })
    return counts
  }

  const getMostVoted = () => {
    const counts = getVoteResults()
    let maxVotes = 0
    let mostVotedId = null
    Object.entries(counts).forEach(([id, count]) => {
      if (count > maxVotes) {
        maxVotes = count
        mostVotedId = id
      }
    })
    return mostVotedId
  }

  // PLAYING PHASE
  if (room.status === 'playing') {
    const submittedCount = Object.keys(room.word_submissions || {}).length

    return (
      <div className="game-container">
        <div className="game-header">
          <div className="round-badge">Round {room.round}</div>
          <div className="category-badge">📂 {room.category}</div>
        </div>

        {/* Word card — always visible */}
        <div className={`word-card ${isImposter ? 'imposter-card' : 'normal-card'}`}>
          {isImposter ? (
            <>
              <div className="word-icon">🕵️</div>
              <h2>You are the Imposter!</h2>
              <p className="word-hint">Try to figure out the secret word without revealing yourself</p>
            </>
          ) : (
            <>
              <div className="word-icon">👁️</div>
              <h2>{room.word}</h2>
              <p className="word-label">This is your word. Don't be obvious!</p>
            </>
          )}
        </div>

        {/* Turn indicator */}
        <div className={`turn-indicator ${isMyTurn ? 'turn-mine' : 'turn-other'}`}>
          {isMyTurn ? (
            <>
              <span className="turn-icon">✍️</span>
              <span>Your turn!</span>
            </>
          ) : (
            <>
              <span className="turn-icon">⏳</span>
              <span><strong>{currentTurnPlayer?.name}</strong>'s turn</span>
            </>
          )}
        </div>

        {/* Timer — only shown for the current player */}
        {isMyTurn && !mySubmission && (
          <div className={`timer-circle ${timeLeft <= 10 ? 'timer-urgent' : ''}`}>
            <span className="timer-number">{timeLeft}</span>
            <span className="timer-label">sec</span>
          </div>
        )}

        {/* Input — only for the current player */}
        {isMyTurn && !mySubmission && (
          <div className="word-submit-box">
            <p className="word-submit-label">Write a word related to the topic</p>
            <div className="word-submit-row">
              <input
                className="word-input"
                type="text"
                placeholder="Type your word..."
                value={myWordInput}
                onChange={e => setMyWordInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && myWordInput.trim() && handleSubmitWord()}
                disabled={loading}
                maxLength={40}
                autoFocus
              />
              <button
                className="btn btn-primary"
                onClick={handleSubmitWord}
                disabled={!myWordInput.trim() || loading}
              >
                {loading ? '...' : 'Submit ✓'}
              </button>
            </div>
          </div>
        )}

        {mySubmission && (
          <div className="word-submitted-badge">
            ✅ Word submitted: <strong>{mySubmission}</strong>
          </div>
        )}

        {/* Players queue */}
        <div className="players-list-game">
          <h3>Players ({submittedCount}/{room.players.length} submitted)</h3>
          {room.players.map((player, i) => {
            const sub = room.word_submissions?.[player.id]
            const isCurrent = i === currentTurnIndex
            return (
              <div
                key={player.id}
                className={`player-row ${player.id === playerId ? 'is-me' : ''} ${isCurrent ? 'turn-active-row' : ''}`}
              >
                <span className="turn-number">{i + 1}</span>
                <span className="player-avatar-small">{getAvatar(i)}</span>
                <span className="player-name-text">{player.name}</span>
                {player.id === playerId && <span className="me-badge">You</span>}
                {isCurrent && !sub && <span className="typing-badge">✍️</span>}
                {sub ? (
                  <span className="player-word-chip">💬 {sub}</span>
                ) : !isCurrent ? (
                  <span className="player-word-pending">⏳</span>
                ) : null}
              </div>
            )
          })}
        </div>

        {error && <div className="error-msg">{error}</div>}
      </div>
    )
  }

  // VOTING PHASE
  if (room.status === 'voting') {
    return (
      <div className="game-container">
        <div className="game-header">
          <div className="round-badge">🗳️ Voting</div>
        </div>

        <h3 className="vote-title">Who do you think is the imposter?</h3>

        {!hasVoted ? (
          <>
            <div className="vote-grid">
              {room.players.filter(p => p.id !== playerId).map((player, i) => (
                <button
                  key={player.id}
                  className={`vote-card ${selectedVote === player.id ? 'selected' : ''}`}
                  onClick={() => setSelectedVote(player.id)}
                >
                  <span className="player-avatar-small">{getAvatar(room.players.indexOf(player))}</span>
                  <span>{player.name}</span>
                </button>
              ))}
            </div>

            {error && <div className="error-msg">{error}</div>}

            <button
              className="btn btn-primary btn-large"
              onClick={() => handleVote(selectedVote)}
              disabled={!selectedVote || loading}
            >
              {loading ? 'Loading...' : 'Cast Vote'}
            </button>

            <button
              className="btn btn-skip"
              onClick={() => handleVote('skip')}
              disabled={loading}
            >
              {loading ? '...' : 'Skip Vote ⏭️'}
            </button>
          </>
        ) : (
          <div className="waiting-msg">
            <div className="spinner"></div>
            <span>Vote submitted! Waiting for others...</span>
            <div className="vote-progress">
              {Object.keys(room.votes || {}).length} / {room.players.length} voted
              {room.votes?.[playerId] === 'skip' && <span className="skip-note"> (skipped)</span>}
            </div>
          </div>
        )}
      </div>
    )
  }

  // RESULTS PHASE
  if (room.status === 'results') {
    const voteCounts = getVoteResults()
    const mostVotedId = getMostVoted()
    const imposterCaught = mostVotedId === room.imposter_id
    const imposterPlayer = room.players.find(p => p.id === room.imposter_id)

    return (
      <div className="game-container">
        <div className="results-header">
          <div className={`result-banner ${imposterCaught ? 'caught' : 'escaped'}`}>
            {imposterCaught ? (
              <>
                <div className="result-icon">🎉</div>
                <h2>Imposter Caught!</h2>
              </>
            ) : (
              <>
                <div className="result-icon">😈</div>
                <h2>Imposter Escaped!</h2>
              </>
            )}
          </div>
        </div>

        <div className="result-details">
          <div className="result-item">
            <span className="result-label">Imposter</span>
            <span className="result-value imposter-name">{imposterPlayer?.name} 🕵️</span>
          </div>
          <div className="result-item">
            <span className="result-label">Word</span>
            <span className="result-value">{room.word}</span>
          </div>
          <div className="result-item">
            <span className="result-label">Category</span>
            <span className="result-value">{room.category}</span>
          </div>
        </div>

        <div className="vote-results">
          <h3>Vote Results</h3>
          {room.players.map((player, i) => (
            <div key={player.id} className={`vote-result-row ${player.id === room.imposter_id ? 'is-imposter' : ''} ${player.id === mostVotedId ? 'most-voted' : ''}`}>
              <span className="player-avatar-small">{getAvatar(i)}</span>
              <span className="vote-player-name">{player.name}</span>
              {player.id === room.imposter_id && <span className="imposter-tag">🕵️ Imposter</span>}
              <div className="vote-bar-container">
                <div className="vote-bar" style={{ width: `${(voteCounts[player.id] / room.players.length) * 100}%` }}></div>
                <span className="vote-count">{voteCounts[player.id]} votes</span>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="result-actions">
          {isHost && (
            <button className="btn btn-primary btn-large" onClick={handleNewRound} disabled={loading}>
              {loading ? 'Loading...' : 'New Round 🔄'}
            </button>
          )}
          <button className="btn btn-danger" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>
    )
  }

  return null
}

function getAvatar(index) {
  const avatars = ['😀', '😎', '🤠', '🥳', '😈', '👻', '🤖', '👽', '🦊', '🐸', '🦁', '🐻']
  return avatars[index % avatars.length]
}
