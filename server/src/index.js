import express from 'express'
import cors from 'cors'
import { config } from 'dotenv'
import ttsRouter from './routes/tts.js'
import youtubeRouter from './routes/youtube.js'
import coversRouter from './routes/covers.js'
import gutenbergRouter from './routes/gutenberg.js'

config()

const app = express()
const PORT = process.env.PORT || 3001
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(express.json({ limit: '10mb' }))

app.use('/api/tts',        ttsRouter)
app.use('/api/youtube',    youtubeRouter)
app.use('/api/covers',     coversRouter)
app.use('/api/gutenberg',  gutenbergRouter)

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', service: 'leavs-server', ts: Date.now() }),
)

app.listen(PORT, () =>
  console.log(`Leavs server listening on http://localhost:${PORT}`),
)
