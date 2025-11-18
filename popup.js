const chatMessages = document.getElementById('chat-messages');
const summarizeBtn = document.getElementById('summarize-btn');
const summarizeVideoBtn = document.getElementById('summarize-video-btn'); // New button
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const statusArea = document.getElementById('status-area');

const apiKeyInput = document.getElementById('api-key');
const saveApiKeyBtn = document.getElementById('save-api-key');
const settingsStatus = document.getElementById('settings-status');

const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

let chatHistory = []; // Store conversation history { role: 'user'/'assistant', content: 'message' }
let currentTabUrl = ''; // Store current tab URL

// --- Tab Handling ---
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// --- UI Helper Functions ---
function addMessage(role, text) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', role);
    messageDiv.innerHTML = text.replace(/\n/g, '<br>'); // Basic newline handling
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (role === 'user' || role === 'assistant') {
         chatHistory.push({ role, content: text });
    }
}

function showStatus(message, type = 'loading', area = statusArea) {
    area.textContent = message;
    area.className = `status ${type}`;
    area.style.display = message ? 'block' : 'none';
}

function disableInputs(disabled = true) {
    summarizeBtn.disabled = disabled;
    summarizeVideoBtn.disabled = disabled; // Disable new button too
    userInput.disabled = disabled;
    sendBtn.disabled = disabled;
}

// --- Dynamic Button Visibility ---
function updateButtonVisibility() {
    // Basic check for YouTube video page
    const isYouTubeVideo = currentTabUrl && currentTabUrl.includes("youtube.com/watch");

    if (isYouTubeVideo) {
        summarizeVideoBtn.style.display = 'block'; // Show YT button
        summarizeBtn.style.display = 'none'; // Hide generic summarize button
    } else {
        summarizeVideoBtn.style.display = 'none';  // Hide YT button
        summarizeBtn.style.display = 'block'; // Show generic summarize button
    }
     // Ensure buttons are re-enabled if they were disabled during a previous action
     // disableInputs(false); // Re-enable potentially disabled buttons when visibility changes
}


// --- API Key Handling ---
async function loadApiKey() {
    const result = await chrome.storage.sync.get(['openaiApiKey']);
    if (result.openaiApiKey) {
        apiKeyInput.value = result.openaiApiKey;
        console.log("API Key loaded.");
        return true;
    } else {
        console.log("API Key not found.");
        showStatus('OpenAI API Key is not set. Please add it in Settings.', 'error');
        return false;
    }
}

saveApiKeyBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        try {
            await chrome.storage.sync.set({ openaiApiKey: apiKey });
            showStatus('API Key saved successfully!', 'success', settingsStatus);
            if (statusArea.textContent.includes('API Key is not set')) {
                 showStatus('', '', statusArea);
            }
            // Test the key
            showStatus('Testing API key...', 'loading', statusArea);
            disableInputs(true); // Disable while testing
            chrome.runtime.sendMessage({ type: 'testApiKey' }, (response) => {
                disableInputs(false); // Re-enable after test
                if (response?.success) {
                    showStatus('API Key is valid!', 'success', statusArea);
                } else {
                    showStatus(`API Key test failed: ${response?.error || 'Unknown error'}`, 'error', statusArea);
                }
                 setTimeout(() => showStatus('', '', statusArea), 3000);
            });

        } catch (error) {
            console.error('Error saving API key:', error);
            showStatus(`Error saving API key: ${error.message}`, 'error', settingsStatus);
             disableInputs(false); // Re-enable if save failed
        }
    } else {
        showStatus('Please enter an API key.', 'error', settingsStatus);
    }
     setTimeout(() => showStatus('', '', settingsStatus), 3000);
});

// --- Core Functionality ---

async function sendMessageToBackground(action, userMessage = null) {
    if (!await loadApiKey()) return;

    disableInputs(true);
    showStatus('Processing...', 'loading');

    const messagePayload = {
        type: action, // 'summarize', 'summarizeVideo', 'chat'
        prompt: userMessage,
        history: chatHistory // Send current history
    };

    chrome.runtime.sendMessage(messagePayload, (response) => {
        disableInputs(false); // Always re-enable after response or error

        if (chrome.runtime.lastError) {
             // Handle cases where the background script couldn't be reached
             console.error("Runtime error:", chrome.runtime.lastError);
             showStatus(`Error communicating with background: ${chrome.runtime.lastError.message}`, 'error');
             addMessage('error', `Error: ${chrome.runtime.lastError.message}`);
             return; // Stop processing
         }

        if (response?.error) {
            showStatus(`Error: ${response.error}`, 'error');
            addMessage('error', `Error: ${response.error}`);
            console.error("Error from background:", response.error);
        } else if (response?.content) {
            showStatus(''); // Clear status on success
            addMessage('assistant', response.content);
        } else {
             // Handle cases where background sent an unexpected response (e.g., undefined)
             showStatus('Received no response content from background.', 'error');
             console.error("Received empty or invalid response:", response);
             addMessage('error', 'Error: Received no valid response content.');
        }

        // Clear loading status if it wasn't replaced by an error
        if (statusArea.classList.contains('loading')) {
           showStatus('', '');
        }
    });
}

summarizeBtn.addEventListener('click', () => {
    chatHistory = [];
    chatMessages.innerHTML = '';
    addMessage('system', 'Requesting page summary...');
    sendMessageToBackground('summarize');
});

// Listener for the new video summary button
summarizeVideoBtn.addEventListener('click', () => {
    chatHistory = [];
    chatMessages.innerHTML = '';
    addMessage('system', 'Requesting video insights summary...');
    sendMessageToBackground('summarizeVideo'); // Use the new action type
});

sendBtn.addEventListener('click', () => {
    const messageText = userInput.value.trim();
    if (messageText) {
        addMessage('user', messageText);
        userInput.value = '';
        sendMessageToBackground('chat', messageText);
    }
});

userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendBtn.click();
    }
});

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
     await loadApiKey(); // Load key first

     // Get current tab URL to set button visibility
     try {
         const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
         if (activeTab?.url) {
             currentTabUrl = activeTab.url;
         }
     } catch (error) {
         console.error("Error getting active tab URL on init:", error);
         statusArea.textContent = "Could not determine current tab URL.";
         statusArea.className = 'status error';
         statusArea.style.display = 'block';
     }
     updateButtonVisibility(); // Show/hide relevant summarize button

    // Focus input if on chat tab? (Optional)
    // if (document.getElementById('chat').classList.contains('active')) {
    //     userInput.focus();
    // }
});

// Listen for potential future messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "add_chat_message") {
        addMessage(request.role, request.text);
        sendResponse({ received: true });
        return true;
    }
});