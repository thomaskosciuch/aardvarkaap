# Slack App Configuration

## App Details
- **App Name**: Aardvark App

## Features
- **App Home**: Interactive home tab for users
- **Webhook Endpoint**: `/webhook` for external apps to send messages
- **Message Storage**: Stores recent webhook messages
- **Real-time Updates**: Updates app home when new webhook messages arrive

## Required Slack App Permissions

### OAuth & Permissions
- `app_mentions:read` - View messages that directly mention @your_app
- `channels:history` - View messages and other content in public channels
- `chat:write` - Send messages as the app
- `im:history` - View messages and other content in direct messages
- `im:read` - View basic information about direct messages
- `users:read` - View people in the workspace
- `users:read.email` - View email addresses of people in the workspace

### Event Subscriptions
- `app_home_opened` - When users open the app home

### App Home
- Enable "Home Tab" in App Home settings

## Webhook Usage

Send POST requests to `/webhook` with the following JSON structure:

```json
{
  "message": "Your message here",
  "source": "external-app-name",
  "channel": "#general"
}
```

### Parameters:
- `message` (required): The message content to display
- `source` (optional): Name of the sending application (default: "external-app")
- `channel` (optional): Slack channel to post to (if not provided, only updates app home)

### Example:
```bash
curl -X POST http://http://Aardva-Aardv-Ly4Ob1Ep7aFm-185688788.ca-central-1.elb.amazonaws.com/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello from my external app!",
    "source": "my-app",
    "channel": "#general"
  }'
```

## Endpoints

- `GET /health` - Health check
- `GET /webhook-messages` - Get all stored webhook messages
- `DELETE /webhook-messages` - Clear all stored webhook messages
- `POST /webhook` - Receive webhook messages from external apps
