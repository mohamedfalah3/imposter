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
    votes: {},
    round: 0
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
  const imposterIndex = Math.floor(Math.random() * room.players.length)
  const imposterId = room.players[imposterIndex].id

  const { data, error } = await supabase
    .from('rooms')
    .update({
      status: 'playing',
      imposter_id: imposterId,
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
  const nextIndex = (room.current_turn_index || 0) + 1
  const allSubmitted = nextIndex >= room.players.length

  const { data, error } = await supabase
    .from('rooms')
    .update({
      word_submissions: submissions,
      current_turn_index: nextIndex,
      status: allSubmitted ? 'voting' : 'playing',
      ...(allSubmitted ? { votes: {} } : {})
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
  const allVoted = room.players.every(p => votes[p.id])

  const { data, error } = await supabase
    .from('rooms')
    .update({
      votes: votes,
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

  const imposterIndex = Math.floor(Math.random() * room.players.length)
  const imposterId = room.players[imposterIndex].id

  const { data, error } = await supabase
    .from('rooms')
    .update({
      status: 'playing',
      word: word,
      category: category,
      imposter_id: imposterId,
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
