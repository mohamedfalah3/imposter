import { supabase } from './supabaseClient'
import wordCategories from './wordList'

// Generate a random 6-character room code
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const array = new Uint8Array(6)
  crypto.getRandomValues(array)
  for (let i = 0; i < 6; i++) {
    code += chars[array[i] % chars.length]
  }
  return code
}

// Pick a random word and category
export function pickRandomWord() {
  const catIndex = Math.floor(Math.random() * wordCategories.length)
  const category = wordCategories[catIndex]
  const wordIndex = Math.floor(Math.random() * category.words.length)
  return {
    category: category.category,
    word: category.words[wordIndex]
  }
}

// Create a new game room
export async function createRoom(hostName) {
  const roomCode = generateRoomCode()
  const { word, category } = pickRandomWord()

  const { data, error } = await supabase.from('rooms').insert({
    code: roomCode,
    host_name: hostName,
    word: word,
    category: category,
    status: 'waiting', // waiting, playing, voting, results
    players: [{ name: hostName, id: crypto.randomUUID(), isHost: true }],
    imposter_id: null,
    imposter_ids: [],
    votes: {},
    round: 0,
    eliminated_players: [],
    settings: { imposters: 1, rounds: 3, turnTime: 30, voteTime: 60 }
  }).select().single()

  if (error) throw error
  return data
}

// Join an existing room
export async function joinRoom(roomCode, playerName) {
  const { data: room, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', roomCode.toUpperCase())
    .single()

  if (fetchError || !room) throw new Error('Room not found')
  if (room.status !== 'waiting') throw new Error('Game already started')

  const existingNames = room.players.map(p => p.name)
  if (existingNames.includes(playerName)) throw new Error('This name is already taken')

  const newPlayer = { name: playerName, id: crypto.randomUUID(), isHost: false }
  const updatedPlayers = [...room.players, newPlayer]

  const { data, error } = await supabase
    .from('rooms')
    .update({ players: updatedPlayers })
    .eq('id', room.id)
    .select()
    .single()

  if (error) throw error
  return { room: data, playerId: newPlayer.id }
}

// Start the game - assign imposter
export async function startGame(roomId) {
  const { data: room, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single()

  if (fetchError) throw fetchError
  if (room.players.length < 3) throw new Error('Need at least 3 players')

  const { word, category } = pickRandomWord()
  const stngs = room.settings || { imposters: 1 }
  const maxImp = Math.max(1, Math.floor(room.players.length / 2))
  const impCount = Math.min(stngs.imposters || 1, maxImp)
  const shuffled = [...room.players].sort(() => Math.random() - 0.5)
  const imposterIds = shuffled.slice(0, impCount).map(p => p.id)

  const { data, error } = await supabase
    .from('rooms')
    .update({
      status: 'playing',
      imposter_id: imposterIds[0],
      imposter_ids: imposterIds,
      word: word,
      category: category,
      votes: {},
      word_submissions: {},
      current_turn_index: 0,
      round: room.round + 1
    })
    .eq('id', roomId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Submit a word description during playing phase (turn-based)
export async function submitWord(roomId, playerId, wordInput) {
  const { data: room, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single()

  if (fetchError) throw fetchError

  const submissions = { ...(room.word_submissions || {}), [playerId]: wordInput }
  const eliminated = room.eliminated_players || []
  const activePlayers = room.players.filter(p => !eliminated.includes(p.id))
  const allSubmitted = activePlayers.every(p => submissions[p.id])

  // Advance turn index, skipping eliminated players
  let nextIndex = (room.current_turn_index || 0) + 1
  while (nextIndex < room.players.length && eliminated.includes(room.players[nextIndex]?.id)) {
    nextIndex++
  }

  const { data, error } = await supabase
    .from('rooms')
    .update({
      word_submissions: submissions,
      current_turn_index: nextIndex,
      status: allSubmitted ? 'reviewing' : 'playing',
    })
    .eq('id', roomId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Cast a vote
export async function castVote(roomId, voterId, suspectId) {
  const { data: room, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single()

  if (fetchError) throw fetchError

  const votes = { ...room.votes, [voterId]: suspectId }
  const eliminated = room.eliminated_players || []
  const activePlayers = room.players.filter(p => !eliminated.includes(p.id))
  const allVoted = activePlayers.every(p => votes[p.id])

  // Compute elimination when all votes are in
  let eliminated_players = [...(room.eliminated_players || [])]
  if (allVoted) {
    const vCounts = {}
    room.players.forEach(p => { vCounts[p.id] = 0 })
    Object.values(votes).forEach(v => { if (v !== 'skip' && vCounts[v] !== undefined) vCounts[v]++ })
    let maxV = 0, topId = null, tied = false
    Object.entries(vCounts).forEach(([id, count]) => {
      if (count > maxV) { maxV = count; topId = id; tied = false }
      else if (count === maxV && maxV > 0) { tied = true }
    })
    if (!tied && topId) eliminated_players.push(topId)
  }

  const { data, error } = await supabase
    .from('rooms')
    .update({
      votes,
      eliminated_players,
      status: allVoted ? 'results' : 'voting'
    })
    .eq('id', roomId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Move to voting phase
export async function startVoting(roomId) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ status: 'voting', votes: {} })
    .eq('id', roomId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Reset room for new round
export async function newRound(roomId) {
  const { word, category } = pickRandomWord()
  const { data: room, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single()

  if (fetchError) throw fetchError

  const rStngs = room.settings || { imposters: 1 }
  const eliminated = room.eliminated_players || []
  const activePlayers = room.players.filter(p => !eliminated.includes(p.id))
  const rMax = Math.max(1, Math.floor(activePlayers.length / 2))
  const rCount = Math.min(rStngs.imposters || 1, rMax)
  const rShuffled = [...activePlayers].sort(() => Math.random() - 0.5)
  const rImposterIds = rShuffled.slice(0, rCount).map(p => p.id)

  // Start at first non-eliminated player
  let startIndex = 0
  while (startIndex < room.players.length && eliminated.includes(room.players[startIndex]?.id)) {
    startIndex++
  }

  const { data, error } = await supabase
    .from('rooms')
    .update({
      status: 'playing',
      word: word,
      category: category,
      imposter_id: rImposterIds[0],
      imposter_ids: rImposterIds,
      votes: {},
      word_submissions: {},
      eliminated_players: eliminated,
      current_turn_index: startIndex,
      round: room.round + 1
    })
    .eq('id', roomId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Update room settings (host only)
export async function updateSettings(roomId, settings) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ settings })
    .eq('id', roomId)
    .select()
    .single()
  if (error) throw error
  return data
}

// Reset room to waiting state for replay
export async function resetGame(roomId) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ status: 'waiting', round: 0, votes: {}, word_submissions: {}, imposter_id: null, imposter_ids: [], eliminated_players: [], current_turn_index: 0 })
    .eq('id', roomId)
    .select()
    .single()
  if (error) throw error
  return data
}

// Subscribe to room changes
export function subscribeToRoom(roomId, callback) {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `id=eq.${roomId}`
    }, (payload) => {
      callback(payload.new)
    })
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

// Remove player from room
export async function leaveRoom(roomId, playerId) {
  const { data: room, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single()

  if (fetchError) throw fetchError

  const updatedPlayers = room.players.filter(p => p.id !== playerId)

  if (updatedPlayers.length === 0) {
    await supabase.from('rooms').delete().eq('id', roomId)
    return null
  }

  const { data, error } = await supabase
    .from('rooms')
    .update({ players: updatedPlayers })
    .eq('id', roomId)
    .select()
    .single()

  if (error) throw error
  return data
}
