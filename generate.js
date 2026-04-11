// api/generate.js
// Vercel Serverless Function — runs on the server, key never exposed to browser

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS headers — allow your Vercel domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt, aspect_ratio, duration } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // FAL_KEY = your fal.ai key, set in Vercel → Settings → Environment Variables
  // Name: FAL_KEY
  const FAL_KEY = process.env.FAL_KEY;
  if (!FAL_KEY) {
    return res.status(500).json({ error: 'API not configured. Add FAL_KEY to Vercel environment variables.' });
  }

  try {
    // Submit generation request to fal.ai
    const submitRes = await fetch('https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt,
        duration: duration || '5',
        aspect_ratio: aspect_ratio || '16:9'
      })
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      console.error('fal.ai submit error:', errText);
      return res.status(502).json({ error: 'Video generation service error. Check your fal.ai credits.' });
    }

    const submitData = await submitRes.json();
    const requestId = submitData.request_id;

    if (!requestId) {
      return res.status(502).json({ error: 'No request ID returned from generation service.' });
    }

    // Poll for result (max 120 seconds)
    let attempts = 0;
    const maxAttempts = 40;

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 3000)); // wait 3 seconds between polls
      attempts++;

      const statusRes = await fetch(`https://queue.fal.run/fal-ai/kling-video/v1/standard/text-to-video/requests/${requestId}`, {
        headers: { 'Authorization': `Key ${FAL_KEY}` }
      });

      if (!statusRes.ok) continue;

      const statusData = await statusRes.json();

      if (statusData.status === 'COMPLETED') {
        const videoUrl = statusData.output?.video?.url || statusData.output?.url;
        return res.status(200).json({
          success: true,
          video_url: videoUrl,
          request_id: requestId
        });
      }

      if (statusData.status === 'FAILED') {
        return res.status(200).json({
          success: false,
          error: 'Generation failed. Try a different prompt.',
          request_id: requestId
        });
      }

      // Still IN_QUEUE or IN_PROGRESS — send progress update
      // (status: IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED)
    }

    // Timeout — return request_id so frontend can keep polling
    return res.status(200).json({
      success: false,
      pending: true,
      request_id: requestId,
      message: 'Still generating. Use request_id to check status.'
    });

  } catch (err) {
    console.error('Generation handler error:', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
}
