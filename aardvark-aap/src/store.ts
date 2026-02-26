export interface WebhookMessage {
  message: string;
  source: string;
  timestamp: string;
  id: string;
}

const messages: WebhookMessage[] = [];
const startTime = Date.now();

function add(msg: Pick<WebhookMessage, 'message' | 'source'>): void {
  messages.push({
    ...msg,
    timestamp: new Date().toISOString(),
    id: Date.now().toString(),
  });

  // Keep only last 50
  if (messages.length > 50) {
    messages.shift();
  }
}

function clear(): void {
  messages.length = 0;
}

function getRecent(n = 5): WebhookMessage[] {
  return messages.slice(-n).reverse();
}

export { messages, startTime, add, clear, getRecent };
