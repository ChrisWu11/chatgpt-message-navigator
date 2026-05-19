# ChatGPT Message Navigator

A lightweight Chrome extension for ChatGPT. It adds a small floating avatar button to the page, opens a compact list of the messages you sent in the current conversation, and lets you jump back to any message with one click.

## Installation

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.
6. Refresh your ChatGPT page.

## Usage

- Open any conversation on `https://chatgpt.com/` or `https://chat.openai.com/`.
- Click the floating avatar button in the lower-right corner.
- The panel shows previews of the messages you sent.
- Image-only messages and attachments are listed as image or attachment entries.
- Click any entry to smoothly scroll back to that message.
- In very long conversations, ChatGPT may only render nearby messages. The extension keeps collecting messages as you scroll through the conversation.

## Files

- `manifest.json`: Chrome extension configuration.
- `content.js`: Scans user messages, renders the floating panel, and handles jump navigation.
- `styles.css`: Styles for the floating button and message panel.
- `icons/`: Extension logo and Chrome icon sizes.
- `assets/kunkun.jpg`: Avatar image used by the floating button.
