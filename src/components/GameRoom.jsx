import { useState, useEffect, useRef } from 'react'
import { subscribeToRoom, startVoting, castVote, newRound, submitWord, resetGame } from '../gameLogic'

export default function GameRoom({ room: initialRoom, playerId, onLeave, onBackToLobby }) {
  const [room, setRoom] = useState(initialRoom)
  const [selectedVote, setSelectedVote] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [myWordInput, setMyWordInput] = useState('')
  const [timeLeft, setTimeLeft] = useState(30)
  const [voteTimeLeft, setVoteTimeLeft] = useState(60)
  const [reviewTimeLeft, setReviewTimeLeft] = useState(5)
  const timerRef = useRef(null)
  const voteTimerRef = useRef(null)
  const reviewTimerRef = useRef(null)
  const autoSubmittedRef = useRef(false)
  const autoVotedRef = useRef(false)
  const autoNextRef = useRef(false)
  const [nextRoundCountdown, setNextRoundCountdown] = useState(null)

  const settings = room.settings || { imposters: 1, rounds: 3, turnTime: 30, voteTime: 60, mode: 'classic' }
  const turnTime = settings.turnTime ?? 30
  const voteTime = settings.voteTime ?? 60
  const maxRounds = settings.rounds ?? 3
  const isQuickMode = (settings.mode || 'classic') === 'quick'
  const imposterIds = room.imposter_ids?.length ? room.imposter_ids : (room.imposter_id ? [room.imposter_id] : [])

  const isHost = room.players.find(p => p.id === playerId)?.isHost
  const isImposter = imposterIds.includes(playerId)
  const hasVoted = room.votes && room.votes[playerId]
  const eliminatedPlayers = room.eliminated_players || []
  const isEliminated = eliminatedPlayers.includes(playerId)
  const activePlayers = room.players.filter(p => !eliminatedPlayers.includes(p.id))
  const currentTurnIndex = room.current_turn_index ?? 0
  const currentTurnPlayer = room.players[currentTurnIndex]
  const isMyTurn = !isEliminated && currentTurnPlayer?.id === playerId
  // In quick mode, submission keys are prefixed with the round number
  const mySubmissionKey = isQuickMode ? `r${room.round}_${playerId}` : playerId
  const mySubmission = room.word_submissions?.[mySubmissionKey]

  useEffect(() => {
    const unsubscribe = subscribeToRoom(room.id, (updatedRoom) => {
      setRoom(updatedRoom)
      if (updatedRoom.status === 'waiting') {
        onBackToLobby(updatedRoom)
      }
    })
    return unsubscribe
  }, [room.id])

  // Reset timer when turn changes
  useEffect(() => {
    if (room.status !== 'playing') return
    setTimeLeft(turnTime)
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

  // Review countdown — shows all submissions for 5s before voting
  // Host auto-transitions to voting via setTimeout (avoids stale-state race)
  const reviewTransitionRef = useRef(null)
  useEffect(() => {
    if (room.status !== 'reviewing') {
      if (reviewTimerRef.current) clearInterval(reviewTimerRef.current)
      if (reviewTransitionRef.current) clearTimeout(reviewTransitionRef.current)
      return
    }
    setReviewTimeLeft(5)
    if (reviewTimerRef.current) clearInterval(reviewTimerRef.current)
    if (reviewTransitionRef.current) clearTimeout(reviewTransitionRef.current)
    reviewTimerRef.current = setInterval(() => {
      setReviewTimeLeft(prev => {
        if (prev <= 1) { clearInterval(reviewTimerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
    // Host transitions to voting after 5s
    if (isHost) {
      reviewTransitionRef.current = setTimeout(() => {
        startVoting(room.id).catch(() => {})
      }, 5000)
    }
    return () => {
      clearInterval(reviewTimerRef.current)
      if (reviewTransitionRef.current) clearTimeout(reviewTransitionRef.current)
    }
  }, [room.status])

  // Reset loading & error when game phase, turn, or round changes
  useEffect(() => {
    setLoading(false)
    setError('')
  }, [room.status, room.current_turn_index, room.round])

  // Vote timer — eliminated players don't vote
  useEffect(() => {
    if (room.status !== 'voting' || hasVoted || isEliminated) {
      if (voteTimerRef.current) clearInterval(voteTimerRef.current)
      return
    }
    autoVotedRef.current = false
    setVoteTimeLeft(voteTime)
    if (voteTimerRef.current) clearInterval(voteTimerRef.current)
    voteTimerRef.current = setInterval(() => {
      setVoteTimeLeft(prev => {
        if (prev <= 1) { clearInterval(voteTimerRef.current); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(voteTimerRef.current)
  }, [room.status, hasVoted])

  // Auto-skip when vote timer expires
  useEffect(() => {
    if (voteTimeLeft === 0 && !hasVoted && room.status === 'voting' && !autoVotedRef.current && !isEliminated) {
      autoVotedRef.current = true
      castVote(room.id, playerId, 'skip').catch(() => {})
    }
  }, [voteTimeLeft, hasVoted, room.status])

  // Auto-advance to next round when imposter escaped and rounds remain
  useEffect(() => {
    if (room.status !== 'results') {
      setNextRoundCountdown(null)
      autoNextRef.current = false
      return
    }
    const ids = room.imposter_ids?.length ? room.imposter_ids : (room.imposter_id ? [room.imposter_id] : [])
    const eliminated = room.eliminated_players || []
    const vCounts = {}
    room.players.forEach(p => { vCounts[p.id] = 0 })
    Object.values(room.votes || {}).forEach(v => { if (v !== 'skip' && vCounts[v] !== undefined) vCounts[v]++ })
    let maxV = 0, topId = null, tiedAuto = false
    Object.entries(vCounts).forEach(([id, count]) => {
      if (count > maxV) { maxV = count; topId = id; tiedAuto = false }
      else if (count === maxV && maxV > 0) { tiedAuto = true }
    })
    const caught = !tiedAuto && ids.includes(topId)
    const newEliminated = (!tiedAuto && topId) ? [...eliminated, topId] : eliminated
    const remainingActive = room.players.filter(p => !newEliminated.includes(p.id))
    const imposterStillIn = ids.some(id => !newEliminated.includes(id))
    const imposterWinsByNumbers = remainingActive.length <= 2 && imposterStillIn && !caught
    const sRounds = (room.settings?.rounds ?? 3)
    const gameOver = caught || imposterWinsByNumbers || room.round >= sRounds
    if (gameOver || autoNextRef.current) return
    autoNextRef.current = true
    setNextRoundCountdown(3)
    const t1 = setTimeout(() => setNextRoundCountdown(2), 1000)
    const t2 = setTimeout(() => setNextRoundCountdown(1), 2000)
    const t3 = setTimeout(() => {
      setNextRoundCountdown(null)
      if (isHost) newRound(room.id).catch(() => {})
    }, 3000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [room.status])

  const handleSubmitWord = async () => {
    if (!myWordInput.trim()) return
    setLoading(true)
    try {
      await submitWord(room.id, playerId, myWordInput.trim())
      // Don't clear loading — subscription will update the UI
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const handleVote = async (voteTarget) => {
    setLoading(true)
    try {
      await castVote(room.id, playerId, voteTarget)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const handleNewRound = async () => {
    setSelectedVote(null)
    setMyWordInput('')
    setTimeLeft(turnTime)
    autoVotedRef.current = false
    setLoading(true)
    try {
      await newRound(room.id)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const handleBackToLobby = async () => {
    try {
      await resetGame(room.id)
      // all players navigate via subscription (status => 'waiting')
    } catch (err) {
      setError(err.message)
    }
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
    let tied = false
    Object.entries(counts).forEach(([id, count]) => {
      if (count > maxVotes) { maxVotes = count; mostVotedId = id; tied = false }
      else if (count === maxVotes && maxVotes > 0) { tied = true }
    })
    return tied ? null : mostVotedId
  }

  // PLAYING PHASE
  if (room.status === 'playing') {
    const submittedCount = isQuickMode
      ? Object.keys(room.word_submissions || {}).filter(k => k.startsWith(`r${room.round}_`)).length
      : Object.keys(room.word_submissions || {}).length

    return (
      <div className="game-container">
        <div className="game-header">
          <div className="round-badge">Round {room.round}{isQuickMode ? ` / 2` : ``}</div>
          {isQuickMode && <div className="quick-mode-badge">⚡ Quick Mode</div>}
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
          <h3>Players ({submittedCount}/{activePlayers.length} submitted)</h3>
          <div className="player-cards-grid">
            {room.players.map((player, i) => {
              const sub = isQuickMode
                ? room.word_submissions?.[`r${room.round}_${player.id}`]
                : room.word_submissions?.[player.id]
              const isCurrent = i === currentTurnIndex
              const isOut = eliminatedPlayers.includes(player.id)
              return (
                <div
                  key={player.id}
                  className={`player-card ${player.id === playerId ? 'is-me' : ''} ${isCurrent && !isOut ? 'turn-active-card' : ''} ${sub ? 'submitted-card' : ''} ${isOut ? 'eliminated-card' : ''}`}
                >
                  <div className="player-card-top">
                    <span className="player-card-num">{i + 1}</span>
                    {player.id === playerId && <span className="me-badge">You</span>}
                    {isOut && <span className="eliminated-badge">Out</span>}
                  </div>
                  <div className="player-card-name">{player.name}</div>
                  <div className="player-card-status">
                    {isOut ? (
                      <span className="player-card-waiting">eliminated</span>
                    ) : sub ? (
                      <span className="player-word-chip">{sub}</span>
                    ) : isCurrent ? (
                      <span className="player-card-typing">typing...</span>
                    ) : (
                      <span className="player-card-waiting">--</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {error && <div className="error-msg">{error}</div>}
      </div>
    )
  }

  // REVIEWING PHASE — all words submitted, countdown before voting
  if (room.status === 'reviewing') {
    return (
      <div className="game-container">
        <div className="game-header">
          <div className="round-badge">{isQuickMode ? 'Rounds 1 & 2' : `Round ${room.round}`}</div>
          <div className="round-badge" style={{ background: '#c8860a' }}>All Submitted!</div>
          {isQuickMode && <div className="quick-mode-badge">⚡ Quick Mode</div>}
        </div>

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

        <div className="timer-circle" style={{ margin: '16px auto' }}>
          <span className="timer-number">{reviewTimeLeft}</span>
          <span className="timer-label">sec</span>
        </div>
        <p style={{ textAlign: 'center', color: '#aaa', marginBottom: '12px', fontSize: '0.9rem' }}>Voting starts in {reviewTimeLeft}s...</p>

        <div className="players-list-game">
          {isQuickMode ? (
            <>
              {[1, 2].map(rnd => (
                <div key={rnd}>
                  <h3 style={{ marginBottom: '8px' }}>Round {rnd} words</h3>
                  <div className="player-cards-grid">
                    {room.players.map((player, i) => {
                      const sub = room.word_submissions?.[`r${rnd}_${player.id}`]
                      return (
                        <div key={player.id} className={`player-card submitted-card ${player.id === playerId ? 'is-me' : ''}`}>
                          <div className="player-card-top">
                            <span className="player-card-num">{i + 1}</span>
                            {player.id === playerId && <span className="me-badge">You</span>}
                          </div>
                          <div className="player-card-name">{player.name}</div>
                          <div className="player-card-status">
                            <span className="player-word-chip">{sub || '-'}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <h3>Everyone's words</h3>
              <div className="player-cards-grid">
                {room.players.map((player, i) => {
                  const sub = room.word_submissions?.[player.id]
                  return (
                    <div key={player.id} className={`player-card submitted-card ${player.id === playerId ? 'is-me' : ''}`}>
                      <div className="player-card-top">
                        <span className="player-card-num">{i + 1}</span>
                        {player.id === playerId && <span className="me-badge">You</span>}
                      </div>
                      <div className="player-card-name">{player.name}</div>
                      <div className="player-card-status">
                        <span className="player-word-chip">{sub || '-'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // VOTING PHASE
  if (room.status === 'voting') {
    return (
      <div className="game-container">
        <div className="game-header">
          <div className="round-badge">🗳️ Voting</div>
          {isQuickMode && <div className="quick-mode-badge">⚡ Quick Mode</div>}
        </div>

        <h3 className="vote-title">Who do you think is the imposter?</h3>

        {/* Quick mode: show both rounds' words for reference */}
        {isQuickMode && (
          <div className="quick-words-summary">
            {[1, 2].map(rnd => (
              <div key={rnd} className="quick-round-col">
                <div className="quick-round-label">Round {rnd}</div>
                {room.players.filter(p => !eliminatedPlayers.includes(p.id)).map(player => (
                  <div key={player.id} className="quick-word-row">
                    <span className="quick-word-name">{player.id === playerId ? 'You' : player.name}</span>
                    <span className="player-word-chip">{room.word_submissions?.[`r${rnd}_${player.id}`] || '-'}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!hasVoted && (
          <div className={`timer-circle ${voteTimeLeft <= 10 ? 'timer-urgent' : ''}`}>
            <span className="timer-number">{voteTimeLeft}</span>
            <span className="timer-label">sec</span>
          </div>
        )}

        {isEliminated ? (
          <div className="waiting-msg">
            <span>👁️ You were eliminated — watching the vote...</span>
            <div className="vote-progress">
              {Object.keys(room.votes || {}).length} / {activePlayers.length} voted
            </div>
          </div>
        ) : !hasVoted ? (
          <>
            <div className="vote-grid">
              {room.players
                .filter(p => p.id !== playerId && !eliminatedPlayers.includes(p.id))
                .map((player) => (
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
              {Object.keys(room.votes || {}).length} / {activePlayers.length} voted
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
    const mostVotedId = getMostVoted()  // null if tie
    const imposterCaught = mostVotedId !== null && imposterIds.includes(mostVotedId)
    const isTie = mostVotedId === null
    const imposterPlayers = room.players.filter(p => imposterIds.includes(p.id))
    // use the newly updated eliminated_players from DB (includes just-eliminated player)
    const newEliminated = eliminatedPlayers
    const remainingActive = room.players.filter(p => !newEliminated.includes(p.id))
    const imposterStillIn = imposterIds.some(id => !newEliminated.includes(id))
    const imposterWinsByNumbers = remainingActive.length <= 2 && imposterStillIn && !imposterCaught
    const isGameOver = imposterCaught || imposterWinsByNumbers || room.round >= maxRounds
    const innocentsWin = isGameOver && imposterCaught
    const imposterWins = isGameOver && !imposterCaught

    return (
      <div className="game-container">
        <div className="game-header">
          <div className="round-badge">{isQuickMode ? 'Quick Mode' : `Round ${room.round} / ${maxRounds}`}</div>
          {isGameOver && <div className="category-badge">Game Over</div>}
          {isQuickMode && <div className="quick-mode-badge">⚡ Quick Mode</div>}
        </div>

        {isGameOver ? (
          <div className={`final-banner ${innocentsWin ? 'innocents-win' : 'imposter-wins'}`}>
            {innocentsWin ? (
              <>
                <div className="final-icon">🏆</div>
                <h2>Innocents Win!</h2>
                <p>The imposter{imposterPlayers.length > 1 ? 's were' : ' was'} caught!</p>
              </>
            ) : (
              <>
                <div className="final-icon">😈</div>
                <h2>Imposter{imposterPlayers.length > 1 ? 's' : ''} Win{imposterPlayers.length > 1 ? '' : 's'}!</h2>
                <p>{imposterWinsByNumbers
                  ? `Only ${remainingActive.length} players remain — impossible to catch the imposter.`
                  : isTie ? 'The vote was tied — no one was caught.' : 'The imposter escaped all rounds.'
                }</p>
              </>
            )}
          </div>
        ) : (
          <div className="results-header">
            <div className={`result-banner ${imposterCaught ? 'caught' : 'escaped'}`}>
              {imposterCaught ? (
                <>
                  <div className="result-icon">🎉</div>
                  <h2>Imposter{imposterPlayers.length > 1 ? 's' : ''} Caught!</h2>
                </>
              ) : (
                <>
                  <div className="result-icon">😈</div>
                  <h2>{isTie ? 'Vote Tied!' : 'Imposter Escaped!'}</h2>
                  {isTie && <p style={{color:'#aaa',fontSize:'0.85rem',margin:'4px 0 0'}}>No one was eliminated</p>}
                </>
              )}
            </div>
          </div>
        )}

        <div className="vote-results">
          <h3>Vote Results</h3>
          {room.players.map((player, i) => (
            <div key={player.id} className={`vote-result-row ${isGameOver && imposterIds.includes(player.id) ? 'is-imposter' : ''} ${player.id === mostVotedId ? 'most-voted' : ''}`}>
              <span className="player-avatar-small">{getAvatar(i)}</span>
              <span className="vote-player-name">{player.name}</span>
              {isGameOver && imposterIds.includes(player.id) && <span className="imposter-tag">🕵️ Imposter</span>}
              <div className="vote-bar-container">
                <div className="vote-bar" style={{ width: `${(voteCounts[player.id] / room.players.length) * 100}%` }}></div>
                <span className="vote-count">{voteCounts[player.id]} votes</span>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="result-actions">
          {!isGameOver && nextRoundCountdown !== null && (
            <p className="next-round-msg">Next round in {nextRoundCountdown}...</p>
          )}
          {isHost && isGameOver && (
            <button className="btn btn-primary btn-large" onClick={handleBackToLobby} disabled={loading}>
              {loading ? 'Loading...' : '🔄 Play Again'}
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
