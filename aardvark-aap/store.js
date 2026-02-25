const messages = [];
const startTime = Date.now();

function add(msg) {
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

function clear() {
  messages.length = 0;
}

function getRecent(n = 5) {
  return messages.slice(-n).reverse();
}

module.exports = { messages, startTime, add, clear, getRecent };
