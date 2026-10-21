/*
 * AI Barricade - known AI crawler registry.
 * category: "training" = collects content for model training/datasets
 *           "search"   = indexes content for AI search/answer products
 *           "user"     = fetches a page when a person asks an AI tool to
 * Tokens are the robots.txt User-agent product tokens published by each operator.
 * Review this list periodically; operators add and retire tokens.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CRAWLERS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return [
    { token: 'GPTBot', operator: 'OpenAI', category: 'training', note: 'Collects content that may be used to train OpenAI models.' },
    { token: 'ClaudeBot', operator: 'Anthropic', category: 'training', note: 'Collects content that may be used to train Claude models.' },
    { token: 'Google-Extended', operator: 'Google', category: 'training', note: 'Control token (not a separate crawler) that opts content out of Gemini training. Does not affect Google Search.' },
    { token: 'CCBot', operator: 'Common Crawl', category: 'training', note: 'Builds the open Common Crawl dataset used by many language models.' },
    { token: 'Applebot-Extended', operator: 'Apple', category: 'training', note: 'Control token that opts content out of Apple AI training. Does not affect Applebot search indexing.' },
    { token: 'Bytespider', operator: 'ByteDance', category: 'training', note: 'ByteDance crawler, widely reported to collect data for AI models.' },
    { token: 'Amazonbot', operator: 'Amazon', category: 'training', note: 'Amazon crawler used for services including AI features.' },
    { token: 'FacebookBot', operator: 'Meta', category: 'training', note: 'Meta crawler used to improve AI/language models.' },
    { token: 'Meta-ExternalAgent', operator: 'Meta', category: 'training', note: 'Meta crawler for AI training and direct indexing.' },
    { token: 'cohere-ai', operator: 'Cohere', category: 'training', note: 'Cohere crawler token.' },
    { token: 'Diffbot', operator: 'Diffbot', category: 'training', note: 'Extracts structured data, often used to feed AI datasets.' },
    { token: 'ImagesiftBot', operator: 'Hive', category: 'training', note: 'Image-focused crawler.' },
    { token: 'anthropic-ai', operator: 'Anthropic', category: 'training', note: 'Legacy Anthropic token, kept for older rule sets.' },
    { token: 'Claude-Web', operator: 'Anthropic', category: 'training', note: 'Legacy Anthropic token, kept for older rule sets.' },

    { token: 'OAI-SearchBot', operator: 'OpenAI', category: 'search', note: 'Indexes sites for ChatGPT search. Blocking it can remove you from ChatGPT search results.' },
    { token: 'PerplexityBot', operator: 'Perplexity', category: 'search', note: 'Indexes sites for Perplexity search. Blocking it can remove you from Perplexity answers.' },
    { token: 'Claude-SearchBot', operator: 'Anthropic', category: 'search', note: 'Indexes sites for Claude search results.' },
    { token: 'DuckAssistBot', operator: 'DuckDuckGo', category: 'search', note: 'Fetches pages to produce DuckDuckGo AI-assisted answers.' },

    { token: 'ChatGPT-User', operator: 'OpenAI', category: 'user', note: 'Fetches a page when a ChatGPT user asks about it. Operators may not apply robots.txt to user-triggered fetches.' },
    { token: 'Claude-User', operator: 'Anthropic', category: 'user', note: 'Fetches a page when a Claude user asks about it.' },
    { token: 'Perplexity-User', operator: 'Perplexity', category: 'user', note: 'Fetches a page when a Perplexity user asks about it. Operators may not apply robots.txt to user-triggered fetches.' }
  ];
});
