"use strict";

// Shared Apps Script transport.
async function personalWorkoutRequest(payload, write = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const url = WEB_APP_URL + (write ? '' : '?' + new URLSearchParams({
      ...payload,
      _: Date.now()
    }));
    const response = await fetch(url, write ? {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    } : {
      cache: 'no-store',
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Không kết nối được thư viện bài riêng.');
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

