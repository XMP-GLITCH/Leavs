// Whether audio is playing right now, readable from outside React.
//
// The service worker runs in autoUpdate mode, which reloads the page the
// moment a new worker activates. That is fine while reading and hostile while
// listening — a deploy would cut a session off mid-sentence. So the periodic
// update check in App.jsx holds off while this is true, and picks the update
// up at the next check once playback stops.
let playing = false

export const setPlaying = v => { playing = !!v }
export const isPlaying  = () => playing
