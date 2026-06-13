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

/** Remove trailing slashes so URL joins don't produce `//`. */
function trimTrailingSlash(url) {
  return (url || '').replace(/\/+$/, '');
}

/**
 * Heuristic: reasoning-style models (OpenAI o-series, gpt-5, gpt-oss, DeepSeek-R,
 * etc.) use `max_completion_tokens` instead of `max_tokens` and often reject a
 * custom `temperature`. We start with those assumptions for matching models but
 * still adapt automatically based on the provider's error response.
 */
function isReasoningModel(model) {
  return /(^|[^a-z])(o1|o3|o4|gpt-5|gpt-oss|reason|deepseek-r)/i.test(model || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform an OpenAI-compatible chat completion that works across providers.
 *
 * Different OpenAI-compatible APIs disagree on parameter names: classic chat
 * models use `max_tokens` + `temperature`, while newer reasoning models (e.g.
 * BytePlus Ark `gpt-oss-*`, OpenAI o-series) require `max_completion_tokens` and
 * reject a custom temperature. This sends the most likely variant first and
 * automatically retries with the alternate when the provider complains. It also
 * retries transient 5xx errors (some providers return a flaky 500 with
 * "please retry later").
 */
async function chatCompletion(settings, messages, { maxTokens, temperature } = {}) {
  const url = `${trimTrailingSlash(settings.apiBaseUrl)}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.apiKey}`,
  };

  const reasoning = isReasoningModel(settings.model);
  let tokenParam = reasoning ? 'max_completion_tokens' : 'max_tokens';
  let includeTemperature = !reasoning;

  let adaptations = 0;
  let serverRetries = 0;

  // Cap total attempts so a misbehaving provider can never loop forever.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const body = { model: settings.model, messages };
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      body[tokenParam] = maxTokens;
    }
    if (includeTemperature && typeof temperature === 'number') {
      body.temperature = temperature;
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      throw new Error(`Network error contacting AI provider: ${networkErr.message}`);
    }

    if (response.ok) {
      return response.json();
    }

    const errorText = await response.text();
    const lower = errorText.toLowerCase();

    // Adapt to parameter incompatibilities (usually HTTP 400) and retry once each.
    if (response.status === 400 && adaptations < 3) {
      let adapted = false;
      if (tokenParam === 'max_tokens' && lower.includes('max_completion_tokens')) {
        tokenParam = 'max_completion_tokens';
        adapted = true;
      } else if (tokenParam === 'max_completion_tokens' && lower.includes('max_tokens')) {
        tokenParam = 'max_tokens';
        adapted = true;
      }
      if (includeTemperature && lower.includes('temperature')) {
        includeTemperature = false;
        adapted = true;
      }
      if (adapted) {
        adaptations += 1;
        continue;
      }
    }

    // Transient server-side errors: brief backoff then retry.
    if (response.status >= 500 && serverRetries < 2) {
      serverRetries += 1;
      await sleep(600 * serverRetries);
      continue;
    }

    throw new Error(`API Error ${response.status}: ${errorText}`);
  }

  throw new Error('AI provider request failed after multiple attempts. Please try again.');
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

  const data = await chatCompletion(
    settings,
    [
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
    { maxTokens: settings.maxTokens, temperature: settings.temperature },
  );

  if (!data.choices || !data.choices[0]) {
    throw new Error('Invalid API response: no choices returned');
  }

  const rawContent = data.choices[0].message.content;
  return parseAIResponse(rawContent, keyword);
}

async function testConnection(config = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };
  assertConfigured(settings);

  const data = await chatCompletion(
    settings,
    [{ role: 'user', content: 'Hello, respond with "Connection successful!"' }],
    { maxTokens: 50, temperature: 0 },
  );

  if (!data.choices || !data.choices[0]) {
    throw new Error('Invalid API response: no choices returned');
  }

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
