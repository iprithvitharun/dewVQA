/**
 * Thin Claude API client using fetch() directly.
 * No SDK dependency — keeps bundle small.
 */

const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-4-20250514'

export async function getClaudeApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get('claudeApiKey')
  return result.claudeApiKey || null
}

export async function setClaudeApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ claudeApiKey: key })
}

interface ImageContent {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

interface TextContent {
  type: 'text'
  text: string
}

type ContentBlock = TextContent | ImageContent

interface ClaudeResponse {
  content: { type: string; text: string }[]
  usage: { input_tokens: number; output_tokens: number }
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  images?: { base64: string; mediaType: string }[]
): Promise<string> {
  // Build content blocks
  const content: ContentBlock[] = []

  // Add images first (if any)
  if (images) {
    for (const img of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        },
      })
    }
  }

  // Add text message
  content.push({ type: 'text', text: userMessage })

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    }),
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid Claude API key. Please check your key in settings.')
    }
    if (response.status === 429) {
      throw new Error('Claude API rate limit reached. Please wait a moment and try again.')
    }
    const errorBody = await response.text().catch(() => '')
    throw new Error(`Claude API error ${response.status}: ${errorBody.slice(0, 200)}`)
  }

  const data = (await response.json()) as ClaudeResponse

  const textBlock = data.content.find((b) => b.type === 'text')
  if (!textBlock) {
    throw new Error('Claude returned no text response.')
  }

  return textBlock.text
}
