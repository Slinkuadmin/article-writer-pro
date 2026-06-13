// ── Shared text utilities ──

/** Generate a URL-safe slug from text, falling back to fallbackText */
function slugify(text, fallbackText = '') {
  const source = (text || fallbackText || '').toString();
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'untitled';
}

/** Strip HTML tags and collapse whitespace */
function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** Count words in plain text */
function wordCount(plainText) {
  const t = (plainText || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Create an excerpt of `maxLen` chars from plain text */
function makeExcerpt(plainText, maxLen = 160) {
  const t = (plainText || '').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

// ── AI config ──
// SECURITY: No real credentials are hardcoded. The API base URL, model and API
// key are provided by the admin via the First-Run Setup Wizard / Settings and
// loaded from the (encrypted) settings store at runtime.

const DEFAULT_CONFIG = {
  apiBaseUrl: '',
  apiKey: '',
  model: '',
  maxTokens: 4096,
  temperature: 0.7,
};

/** Throw a clear error when the AI provider has not been configured yet. */
function assertConfigured(settings) {
  if (!settings.apiBaseUrl || !settings.apiKey || !settings.model) {
    throw new Error(
      'AI provider is not configured. Add the base URL, model and API key in Settings.',
    );
  }
}

function buildPrompt(template, keyword, language, tone, length) {
  const lengthMap = { short: '500', medium: '1000', long: '2000' };
  const wordCount = lengthMap[length] || '1000';
  return template
    .replace(/{keyword}/g, keyword)
    .replace(/{language}/g, language)
    .replace(/{tone}/g, tone)
    .replace(/{length}/g, wordCount);
}

// ── Resilient AI response parser ──

function parseAIResponse(text, originalKeyword) {
  // 1) Try JSON parse first
  let jsonResult = null;
  try {
    // Strip markdown code fences if model wrapped output
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    jsonResult = JSON.parse(cleaned);
  } catch {
    // Also try to extract JSON from within the text
    const jsonMatch = text.match(/\{[\s\S]*"content_html"[\s\S]*\}/);
    if (jsonMatch) {
      try { jsonResult = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
    }
  }

  if (jsonResult && typeof jsonResult === 'object') {
    const title = (jsonResult.title || '').trim();
    const contentHtml = (jsonResult.content_html || jsonResult.content || '').trim();
    const plain = stripHtml(contentHtml);
    return {
      title: title || originalKeyword,
      keyword: (jsonResult.keyword || originalKeyword || '').trim(),
      slug: slugify(title, originalKeyword),
      tags: Array.isArray(jsonResult.tags) ? jsonResult.tags : [],
      excerpt: (jsonResult.excerpt || '').trim() || makeExcerpt(plain),
      content: contentHtml,
      wordCount: wordCount(plain),
    };
  }

  // 2) Fallback: legacy TITLE / KEYWORD / CONTENT format
  let title = '';
  let keyword = originalKeyword || '';
  let content = '';

  const titleMatch = text.match(/TITLE:\s*(.+)/i);
  const keywordMatch = text.match(/KEYWORD:\s*(.+)/i);
  const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/i);

  if (titleMatch) title = titleMatch[1].trim();
  if (keywordMatch) keyword = keywordMatch[1].trim();
  if (contentMatch) content = contentMatch[1].trim();

  // 3) Fallback: use the entire text as content
  if (!content) {
    content = text;
    const h1Match = text.match(/<h1[^>]*>(.*?)<\/h1>/i);
    const mdH1 = text.match(/^#\s+(.+)/m);
    if (h1Match) title = h1Match[1].trim();
    else if (mdH1) title = mdH1[1].trim();
  }

  const plain = stripHtml(content);
  return {
    title: title || originalKeyword,
    keyword,
    slug: slugify(title, originalKeyword),
    tags: [],
    excerpt: makeExcerpt(plain),
    content,
    wordCount: wordCount(plain),
  };
}

async function generateArticle(keyword, promptTemplate, language, tone, length, config = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  assertConfigured(settings);

  const prompt = buildPrompt(promptTemplate, keyword, language, tone, length);

  const response = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a professional SEO content writer. You write comprehensive, engaging, and well-structured articles optimized for search engines.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices[0]) {
    throw new Error('Invalid API response: no choices returned');
  }

  const rawContent = data.choices[0].message.content;
  return parseAIResponse(rawContent, keyword);
}

async function testConnection(config = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  assertConfigured(settings);
  const response = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'user', content: 'Hello, respond with "Connection successful!"' }],
      max_tokens: 50,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export {
  generateArticle,
  testConnection,
  DEFAULT_CONFIG,
  buildPrompt,
  parseAIResponse,
  slugify,
  stripHtml,
  wordCount,
  makeExcerpt,
};
