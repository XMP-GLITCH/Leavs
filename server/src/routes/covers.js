import { Router } from 'express'

const router = Router()

const STYLE_VARIANTS = [
  'photorealistic editorial illustration, cinematic lighting, dramatic composition',
  'minimalist graphic design, geometric shapes, bold clean layout',
  'painterly oil artwork, rich textures, impressionist style',
  'bold contemporary digital art, high contrast, modern aesthetic',
]

// ─── Gemini helpers ──────────────────────────────────────────────────────────

function toDataUrl(data, mimeType = 'image/png') {
  if (typeof data === 'string') return `data:${mimeType};base64,${data}`
  return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`
}

const IMAGE_MODELS = [
  'gemini-2.5-flash-preview-image-generation',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
]

async function generateOneCover(ai, prompt) {
  for (const model of IMAGE_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config:   { responseModalities: ['IMAGE'] },
      })
      for (const part of (response.candidates?.[0]?.content?.parts ?? [])) {
        if (part.inlineData?.data) {
          return toDataUrl(part.inlineData.data, part.inlineData.mimeType || 'image/png')
        }
      }
    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('not found') || msg.includes('NOT_FOUND') || msg.includes('INVALID_ARGUMENT') || msg.includes('not supported')) continue
      throw err
    }
  }
  throw new Error('No image returned from any Gemini image model')
}

// Use Gemini text to extract 4 visual cover concepts appropriate to the actual content type
async function analyzeBook(ai, title, author, excerpt) {
  const response = await ai.models.generateContent({
    model:    'gemini-2.0-flash',
    contents: `You are a visual art director creating cover artwork for "${title}" by ${author}.

Here is an excerpt from the actual book:
---
${excerpt.slice(0, 5000)}
---

Step 1 — identify the content type: Is this a novel/fiction, medical guide, instruction manual, self-help, academic text, biography, technical reference, or something else? What visual aesthetic is most appropriate and professional for this type? Examples:
- Medical/pharmaceutical guide → clean clinical iconography, minimal, precise line art, soft clinical colours
- Technical instruction manual → clear diagrammatic design, modern flat illustration, structured layout feel
- Literary novel → atmospheric scene, painterly or cinematic, evocative mood
- Self-help → clean modern design, symbolic, optimistic colours
- Academic → understated, typographic-feeling layout, muted scholarly tones

Step 2 — describe 4 visually distinct cover art concepts that match BOTH the identified content type AND actual visual elements or concepts from the text. Each concept must:
- Use the aesthetic appropriate for this content type (not forced artsy if it is a clinical guide)
- Reference real objects, concepts, or themes from the actual text above (not generic)
- Be purely visual — no people, no faces, no figures, no silhouettes, no text, no letters
- Focus on objects, environments, abstract shapes, light, colour, texture — never a person
- Be 1–2 sentences including a brief style note (e.g. "clean minimal clinical illustration:", "flat icon design:")

Return ONLY a valid JSON array of 4 strings. No markdown fences, no commentary, nothing else.`,
  })
  const raw   = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  const parsed = JSON.parse(clean)
  if (Array.isArray(parsed) && parsed.length) return parsed.slice(0, 4)
  throw new Error('analyzeBook returned unexpected shape')
}

// Fallback scene descriptions when no API key / analysis fails
function fallbackScenes(title) {
  return [
    `Flat clean minimal illustration: abstract geometric shapes and symbols representing the subject matter of "${title}". No people. Muted professional colour palette.`,
    `Minimal graphic design: bold simple icon or object relevant to "${title}" on a clean background. No humans, no faces. Solid modern aesthetic.`,
    `Abstract visual composition: textured shapes, patterns, and colours evoking the tone of "${title}". No figures, no people. Contemporary design.`,
    `Clean diagrammatic illustration: symbolic object or environment from "${title}". No people, no faces, no silhouettes. Precise lines, professional layout.`,
  ]
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Analyze book text → 4 scene descriptions (used by client before Pollinations)
router.post('/analyze', async (req, res) => {
  const { title = 'a story', author = '', excerpt = '' } = req.body

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || !excerpt) {
    return res.json({ scenes: fallbackScenes(title) })
  }

  try {
    const { GoogleGenAI } = await import('@google/genai')
    const ai     = new GoogleGenAI({ apiKey })
    const scenes = await analyzeBook(ai, title, author, excerpt)
    res.json({ scenes })
  } catch (err) {
    console.error('[Covers/analyze]', err.message)
    // Non-fatal — client falls back gracefully
    res.json({ scenes: fallbackScenes(title) })
  }
})

// Gemini image generation — uses book text excerpt for context
router.post('/generate', async (req, res) => {
  const { title, author, genre, themes, excerpt } = req.body
  if (!title) return res.status(400).json({ error: 'title is required' })

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(503).json({
      error: 'Cover generation not configured',
      hint:  'Add GEMINI_API_KEY to server/.env — free at aistudio.google.com/apikey',
    })
  }

  try {
    const { GoogleGenAI } = await import('@google/genai')
    const ai = new GoogleGenAI({ apiKey })

    // Analyze real book content to get 4 scene descriptions
    let scenes = null
    if (excerpt) {
      scenes = await analyzeBook(ai, title, author, excerpt).catch(err => {
        console.warn('[Covers/generate] analyzeBook failed, using generic prompts:', err.message)
        return null
      })
    }

    // Build image prompts from scene analysis or generic style variants
    const prompts = scenes
      ? scenes.map(scene =>
          `${scene} ` +
          `No people, no faces, no human figures. No text, no words, no letters. Portrait orientation 2:3 ratio. Publishable professional quality.`
        )
      : STYLE_VARIANTS.map(style => {
          const base = `A striking visual artwork for the book "${title}"${author ? ` by ${author}` : ''}. `
          const genre_hint = genre ? `Genre: ${genre}. ` : ''
          const theme_hint = themes ? `Themes: ${themes}. ` : ''
          return base + genre_hint + theme_hint + `Visual style: ${style}. Portrait 2:3. No text, no letters.`
        })

    const results = await Promise.allSettled(prompts.map(p => generateOneCover(ai, p)))
    const covers  = results.filter(r => r.status === 'fulfilled').map(r => r.value)

    if (!covers.length) {
      const firstErr = results.find(r => r.status === 'rejected')?.reason
      throw firstErr ?? new Error('All cover generations failed')
    }

    res.json({ covers })
  } catch (err) {
    console.error('[Covers/generate]', err.message)
    const msg = err.message || ''
    if (msg.includes('API_KEY_INVALID') || msg.includes('not valid')) {
      return res.status(401).json({ error: 'Invalid Gemini API key — check GEMINI_API_KEY in server/.env' })
    }
    res.status(500).json({ error: msg || 'Cover generation failed' })
  }
})

// Hugging Face FLUX.1-schnell — direct API, no prompt rewriting
router.post('/image', async (req, res) => {
  const { scene = '', seed = '42', title = '' } = req.body

  const hfToken = process.env.HF_TOKEN
  if (!hfToken) {
    return res.status(503).json({
      error:  'HF_TOKEN not configured',
      hint:   'Add HF_TOKEN to server/.env — free at huggingface.co/settings/tokens',
    })
  }

  const prompt = scene
    ? `${scene} No people, no faces, no human figures, no silhouettes. No text, no letters, no words.`
    : `Abstract minimal illustration inspired by "${title}". No people, no faces. No text, no letters.`

  try {
    const upstream = await fetch(
      'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          inputs:     prompt,
          parameters: { seed: Number(seed), num_inference_steps: 4, guidance_scale: 0, width: 512, height: 768 },
        }),
        signal: AbortSignal.timeout(120_000),
      }
    )

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}))
      if (upstream.status === 503 && body.estimated_time) {
        return res.status(503).json({ error: 'Model loading', estimated_time: body.estimated_time })
      }
      return res.status(502).json({ error: body.error || `HF error ${upstream.status}` })
    }

    const contentType = upstream.headers.get('Content-Type') || 'image/jpeg'
    res.setHeader('Content-Type', contentType)
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    console.error('[HF image]', err.message, err.cause?.message, err.cause?.code)
    res.status(500).json({ error: err.message, cause: err.cause?.message, code: err.cause?.code })
  }
})

export default router
