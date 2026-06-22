// Vercel serverless function — /api/covers/image
// Proxies to HF FLUX.1-schnell using HF_TOKEN from Vercel env vars.
// Falls back gracefully (503) when token isn't set; client uses Pollinations.

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const hfToken = process.env.HF_TOKEN
  if (!hfToken) return res.status(503).json({ error: 'HF_TOKEN not configured' })

  const { scene = '', seed = 42 } = req.body || {}

  try {
    const upstream = await fetch(
      'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${hfToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs:     scene,
          parameters: { seed: Number(seed), num_inference_steps: 4, guidance_scale: 0, width: 512, height: 768 },
        }),
      }
    )

    if (!upstream.ok) {
      const body = await upstream.json().catch(() => ({}))
      return res.status(upstream.status).json({ error: body.error || `HF ${upstream.status}` })
    }

    const buf = Buffer.from(await upstream.arrayBuffer())
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.end(buf)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
