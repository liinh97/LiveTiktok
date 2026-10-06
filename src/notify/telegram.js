// Gửi tin nhắn Telegram qua Bot API (miễn phí). Không cấu hình thì bỏ qua.

import { log } from '../log.js';

export class Telegram {
  constructor({ botToken, chatId }) {
    this.enabled = Boolean(botToken && chatId);
    this.url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    this.chatId = chatId;
  }

  async send(text) {
    if (!this.enabled) return;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log.warn(`Telegram trả lỗi ${res.status}`);
    } catch (err) {
      log.warn(`Không gửi được Telegram: ${err.message}`);
    }
  }
}
