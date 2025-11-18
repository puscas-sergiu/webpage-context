# Webpage Summarizer & Chat

A Chrome extension that leverages OpenAI's API to summarize web pages and YouTube videos, with an interactive chat interface for deeper content exploration.

## Features

- **Webpage Summarization**: Extract and summarize the main content from any webpage
- **YouTube Video Summarization**: Automatically extract video transcripts and generate detailed summaries with key learnings and actionable takeaways
- **Interactive Chat**: Ask questions about the current page or video content with conversation history
- **Automatic Transcript Panel**: Automatically opens YouTube transcript panels for seamless video analysis
- **Smart Content Extraction**: Intelligently extracts meaningful content while filtering out navigation, ads, and other noise

## Installation

### From Source

1. Clone this repository:
   ```bash
   git clone https://github.com/puscas-sergiu/webpage-context.git
   cd webpage-context
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in the top right)

4. Click "Load unpacked" and select the project directory

5. The extension icon should now appear in your Chrome toolbar

## Configuration

### Setting up your OpenAI API Key

1. Get your API key from [OpenAI's platform](https://platform.openai.com/api-keys)

2. Click the extension icon in your Chrome toolbar

3. Click the "Settings" (⚙️) button

4. Enter your OpenAI API key

5. Click "Save API Key"

6. The extension will test your key and confirm if it's valid

## Usage

### Summarizing a Webpage

1. Navigate to any webpage
2. Click the extension icon
3. Click "Summarize Page"
4. Wait for the AI-generated summary

### Summarizing a YouTube Video

1. Navigate to a YouTube video
2. Click the extension icon
3. Click "Summarize Video"
4. The extension will automatically open the transcript panel (if available)
5. Wait for the AI-generated summary with key insights and takeaways

### Chatting about Content

1. After loading a page or video, click the extension icon
2. Type your question in the chat input field
3. Press Enter or click Send
4. The AI will respond based on the page/video content
5. Continue the conversation with follow-up questions

### Managing Conversations

- **Clear Chat**: Click "Clear Chat" to start a new conversation
- **Conversation History**: The extension maintains context throughout your conversation about the current page

## Technical Details

### Built With

- **Manifest V3**: Latest Chrome extension architecture
- **OpenAI API**: Currently configured to use `gpt-5-nano-2025-08-07` model
- **JavaScript**: Vanilla JS for lightweight performance
- **Chrome APIs**: Storage, Scripting, and Active Tab permissions

### Content Extraction

- **Web Pages**: Uses intelligent selectors to find main content areas (articles, main sections) with fallback to body content cleaning
- **YouTube Videos**: Extracts transcript text from YouTube's native transcript panel
- **Content Limits**: Truncates content to 15,000 characters to stay within API limits

### API Configuration

The extension is currently configured to use:
- **Model**: `gpt-5-nano-2025-08-07`
- **API Endpoint**: `https://api.openai.com/v1/chat/completions`
- **Temperature**: 0.5 for balanced creativity and accuracy

## Privacy & Security

- Your OpenAI API key is stored locally in Chrome's sync storage
- No data is collected or stored by the extension itself
- All communication happens directly between your browser and OpenAI's API
- Content extraction happens locally in your browser

## Permissions Explained

- **activeTab**: Access the current tab's content for summarization
- **storage**: Store your API key and conversation history
- **scripting**: Inject content extraction scripts into web pages
- **host_permissions (api.openai.com)**: Make API calls to OpenAI

## Limitations

- Requires an active OpenAI API key with sufficient credits
- Content is truncated to 15,000 characters maximum
- YouTube videos must have transcripts/captions available
- Cannot access restricted pages (chrome://, chrome.google.com/webstore, etc.)

## Troubleshooting

### "OpenAI API Key not set in Settings"
- Make sure you've entered a valid API key in the extension settings

### "Could not extract YouTube transcript"
- Ensure the video has captions/transcripts available
- Try manually opening the transcript panel first
- Some videos may not have transcripts available

### "API Error: 401"
- Your API key is invalid or expired
- Check your API key in settings and update if necessary

### "API Error: 429"
- You've hit OpenAI's rate limit or quota
- Check your OpenAI account usage and billing

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available for personal and commercial use.

## Author

**puscas-sergiu**

## Acknowledgments

- Built with OpenAI's powerful language models
- YouTube transcript extraction leverages YouTube's native transcript feature
