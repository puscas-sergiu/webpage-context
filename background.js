// --- Constants ---
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-5-nano-2025-08-07'; // Or 'gpt-4' / 'gpt-4-turbo' etc.
const TRANSCRIPT_BUTTON_SELECTOR = 'button[aria-label="Show transcript"]'; // More reliable selector
const TRANSCRIPT_PANEL_SELECTOR = '#panels ytd-transcript-renderer'; // Selector to check if panel might be open

// --- Helper Functions ---

async function getApiKey() {
    const result = await chrome.storage.sync.get(['openaiApiKey']);
    return result.openaiApiKey;
}

function extractPageContent() {
    // (Keep the existing extractPageContent function as it was)
    let text = '';
    const selectors = ['main', 'article', '[role="main"]', '.post-content', '.entry-content'];
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            text = element.innerText;
            break;
        }
    }

    if (!text || text.length < 200) {
        const bodyClone = document.body.cloneNode(true);
        ["script", "style", "nav", "footer", "aside", "header", "button", "form", "figure", "iframe", "noscript"].forEach(tag => {
            bodyClone.querySelectorAll(tag).forEach(el => el.remove());
        });
         text = bodyClone.innerText;
    }

    text = text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, '');
    text = text.replace(/\s\s+/g, ' ').trim();

    const MAX_CONTENT_LENGTH = 15000;
     if (text.length > MAX_CONTENT_LENGTH) {
         console.log(`Content truncated from ${text.length} to ${MAX_CONTENT_LENGTH} chars.`);
         text = text.substring(0, MAX_CONTENT_LENGTH) + "... [Content Truncated]";
     }
    return text || "[Could not extract meaningful content.]";
}

// --- NEW FUNCTION: To be injected to click the transcript button ---
async function clickTranscriptButton() {
    console.log("Attempting to click 'Show transcript' button...");
    // Selector for the button based on aria-label (more stable)
    const buttonSelector = 'button[aria-label="Show transcript"]';
     // Selector to check if the transcript panel seems visible
     const transcriptPanelSelector = '#panels ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'; // Cover both panel types

    try {
        // Check if the transcript panel is already visible
        const transcriptPanel = document.querySelector(transcriptPanelSelector);
         if (transcriptPanel && transcriptPanel.checkVisibility && transcriptPanel.checkVisibility()) { // checkVisibility is more modern
            console.log("Transcript panel appears to be already open.");
            return { success: true, alreadyOpen: true, message: "Transcript panel already open." };
        } else if (transcriptPanel && !transcriptPanel.checkVisibility) {
             // Fallback check if checkVisibility isn't supported (less reliable)
             const style = window.getComputedStyle(transcriptPanel);
             if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                 console.log("Transcript panel seems already open (fallback check).");
                 return { success: true, alreadyOpen: true, message: "Transcript panel already open (fallback)." };
             }
         }

        // Find the description container first, as the button is usually inside it
        const descriptionContainer = document.querySelector('#description.ytd-watch-metadata, #description-inline-expander');
        if (!descriptionContainer) {
            console.warn("Could not find description container to search within.");
             // If container not found, search the whole document as a fallback
             const button = document.querySelector(buttonSelector);
             if (button) {
                 console.log("Found 'Show transcript' button (document fallback). Clicking...");
                 button.click();
                 return { success: true, alreadyOpen: false, message: "Clicked 'Show transcript' button (document fallback)." };
             } else {
                 console.error("'Show transcript' button not found anywhere.");
                 return { success: false, message: "Could not find the 'Show transcript' button." };
             }
        }

         // Find the "Show transcript" button *within* the description container
         const button = descriptionContainer.querySelector(buttonSelector);

        if (button) {
            console.log("Found 'Show transcript' button within description. Clicking...");
            button.click();
            return { success: true, alreadyOpen: false, message: "Clicked 'Show transcript' button." };
        } else {
             // Sometimes the button is outside the initial description, under a "more" button
             const moreButton = descriptionContainer.querySelector('tp-yt-paper-button#expand, yt-button-shape button[aria-label="Show more"]'); // Old and new selectors
             if (moreButton) {
                 console.log("Found 'Show more' button, clicking it first...");
                 moreButton.click();
                 // Wait briefly for content to potentially load after clicking "more"
                 await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay
                 // Try finding the transcript button again
                 const buttonAfterMore = document.querySelector(buttonSelector); // Search document now
                 if (buttonAfterMore) {
                    console.log("Found 'Show transcript' button after clicking 'Show more'. Clicking transcript button...");
                    buttonAfterMore.click();
                    return { success: true, alreadyOpen: false, message: "Clicked 'Show more', then 'Show transcript'." };
                 } else {
                     console.error("'Show transcript' button not found even after clicking 'Show more'.");
                     return { success: false, message: "Clicked 'Show more', but couldn't find 'Show transcript' button afterwards." };
                 }
             } else {
                console.error("'Show transcript' button not found in description, and no 'Show more' button found.");
                return { success: false, message: "Could not find the 'Show transcript' button or a 'Show more' button." };
             }
        }
    } catch (error) {
        console.error("Error trying to click 'Show transcript' button:", error);
        return { success: false, message: `Error during button click attempt: ${error.message}` };
    }
}


async function extractYouTubeCaptionText() {
    // (Keep the existing extractYouTubeCaptionText function as it was)
    console.log("Attempting YouTube transcript extraction...");
    let transcriptText = '';
    const MAX_WAIT_MS = 3000; // Increased wait time slightly as it might take longer after auto-click
    const CHECK_INTERVAL_MS = 500;
    let waitedMs = 0;

    try {
        const primarySelector = 'ytd-transcript-segment-renderer div.segment yt-formatted-string.segment-text';

        const performExtraction = () => {
            const segments = document.querySelectorAll(primarySelector);
            if (segments && segments.length > 0) {
                console.log(`Extractor found ${segments.length} transcript segments using selector: "${primarySelector}".`);
                return Array.from(segments).map(seg => seg.textContent || '').join(' ').trim();
            }
            const fallbackSelector = 'ytd-transcript-body-renderer .cue-group yt-formatted-string';
            const fallbackSegments = document.querySelectorAll(fallbackSelector);
             if (fallbackSegments && fallbackSegments.length > 0) {
                 console.log(`Extractor found ${fallbackSegments.length} transcript segments using fallback selector: "${fallbackSelector}".`);
                 return Array.from(fallbackSegments).map(seg => seg.textContent || '').join(' ').trim();
             }
            console.log(`Extractor found 0 segments with primary or fallback selectors.`);
            return null;
        };

        transcriptText = performExtraction();

        while (transcriptText === null && waitedMs < MAX_WAIT_MS) {
             console.log(`Transcript not found, waiting ${CHECK_INTERVAL_MS}ms...`);
             await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
             waitedMs += CHECK_INTERVAL_MS;
             transcriptText = performExtraction();
         }

        if (transcriptText === null || transcriptText === '') {
             transcriptText = "[Could not automatically extract YouTube transcript after attempting to open it. The transcript might be unavailable, require manual opening, or the page structure may have changed.]";
             console.warn("Transcript extraction failed after waiting.");
        }

    } catch (e) {
        console.error("Error during YouTube transcript extraction:", e);
        transcriptText = `[Error trying to extract YouTube transcript: ${e.message}]`;
    }

    if (transcriptText && !transcriptText.startsWith("[")) {
        transcriptText = transcriptText.replace(/\s\s+/g, ' ').trim();
        const MAX_CONTENT_LENGTH = 15000;
        if (transcriptText.length > MAX_CONTENT_LENGTH) {
             transcriptText = transcriptText.substring(0, MAX_CONTENT_LENGTH) + "... [Transcript Truncated]";
        }
    }

    return transcriptText || "[No transcript text found or extracted.]";
}


async function callOpenAI(apiKey, messages) {
    // (Keep the existing callOpenAI function as it was)
    if (!apiKey) throw new Error("API Key is missing.");
    if (!messages || messages.length === 0) throw new Error("No messages provided for OpenAI call.");

    console.log("Sending request to OpenAI with model:", DEFAULT_MODEL);
    try {
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: messages
                 // max_tokens: 1000
            })
        });

        const responseBody = await response.json().catch(() => ({ error: { message: "Invalid JSON response from API" } }));

        if (!response.ok) {
            console.error("OpenAI API Error Response:", response.status, responseBody);
            let errorMessage = `API Error: ${response.status} ${response.statusText}`;
            if (responseBody.error?.message) {
                errorMessage += ` - ${responseBody.error.message}`;
            }
            if (response.status === 401) errorMessage = "Invalid OpenAI API Key. Please check your key in Settings.";
            else if (response.status === 429) errorMessage = "OpenAI API rate limit reached or quota exceeded. Check usage/limits.";
            else if (response.status === 400 && responseBody.error?.code === 'context_length_exceeded') errorMessage = "Content + history too long for model. Try shorter content or new chat.";
            throw new Error(errorMessage);
        }
        if (!responseBody.choices?.[0]?.message?.content) {
             console.error("Invalid response structure from OpenAI:", responseBody);
             throw new Error("Received unexpected/empty response structure from OpenAI.");
        }
        return responseBody.choices[0].message.content.trim();
    } catch (error) {
        console.error("Error calling OpenAI or processing response:", error);
         if (error.message.startsWith("API Error:") || error.message.includes("Invalid OpenAI API Key") || error.message.includes("rate limit") || error.message.includes("too long for the model")) {
             throw error;
         } else {
             throw new Error(`Network or unexpected error during OpenAI call: ${error.message}`);
         }
    }
}

// --- Main Event Listener ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const sendAsyncResponse = (response) => {
        try {
            if (sender.tab || !chrome.runtime.lastError) {
                sendResponse(response);
            } else { console.log("Response port closed."); }
        } catch (e) { console.log("Error sending response:", e); }
    };

    (async () => {
        const apiKey = await getApiKey();
        if (!apiKey && request.type !== 'testApiKey') {
            sendAsyncResponse({ error: "OpenAI API Key not set in Settings." });
            return;
        }

        if (request.type === 'testApiKey') {
             // (Keep existing testApiKey logic)
            console.log("Received testApiKey request");
             try {
                 await callOpenAI(apiKey || "DUMMY_KEY_FOR_TEST_STRUCTURE", [{ role: "user", content: "Hello!" }]);
                 console.log("API Key test successful");
                 sendAsyncResponse({ success: true });
             } catch (error) {
                  const displayError = error.message.includes("DUMMY_KEY") ? "API Key is missing or invalid." : error.message;
                 console.error("API Key test failed:", error);
                 sendAsyncResponse({ success: false, error: displayError });
             }
             return;
         }

        let activeTab;
        try {
            [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!activeTab?.id) throw new Error("Could not get active tab information.");
            const url = activeTab.url || "";
            if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:') || url.includes('chrome.google.com/webstore')) {
                throw new Error("Cannot access content on this type of restricted page.");
            }
        } catch (error) {
            console.error("Error getting active tab:", error);
            sendAsyncResponse({ error: `Error accessing active tab: ${error.message}` });
            return;
        }

        let pageContent = '';
        let isYouTube = activeTab.url && activeTab.url.includes("youtube.com/watch");
        let requiresVideoExtraction = request.type === 'summarizeVideo';
        let useVideoExtractor = isYouTube && requiresVideoExtraction;

        try {
             // --- MODIFICATION START: Click button before extracting ---
             if (useVideoExtractor) {
                 console.log("Attempting to automatically open transcript...");
                 let clickSuccess = false;
                 try {
                     const clickResults = await chrome.scripting.executeScript({
                         target: { tabId: activeTab.id },
                         func: clickTranscriptButton,
                     });
                     // Check result from the injected script
                      if (clickResults && clickResults[0] && clickResults[0].result) {
                         const resultData = clickResults[0].result;
                         console.log("Transcript button click result:", resultData.message);
                         clickSuccess = resultData.success;
                         if (!clickSuccess) {
                             // Optionally notify user if button wasn't found, but proceed anyway
                              chrome.tabs.sendMessage(activeTab.id, {
                                 type: "add_chat_message",
                                 role: "system",
                                 text: `Note: ${resultData.message} Trying to extract anyway...`
                             }).catch(e => console.log("Failed to send button click status to popup:", e));
                         }
                      } else {
                         console.warn("Did not receive a valid result from clickTranscriptButton injection.");
                      }

                 } catch (clickError) {
                     console.error("Error injecting script to click transcript button:", clickError);
                      // Notify user about the failure
                       chrome.tabs.sendMessage(activeTab.id, {
                         type: "add_chat_message",
                         role: "system",
                         text: `Note: Failed to automatically open transcript (${clickError.message}). Please try opening it manually.`
                     }).catch(e => console.log("Failed to send button click error status to popup:", e));
                 }

                 // Wait a moment AFTER attempting the click, regardless of success,
                 // to allow potential DOM changes to settle before extraction.
                  console.log("Waiting briefly after transcript click attempt...");
                 await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay (adjust if needed)
             }
             // --- MODIFICATION END ---


            // Now proceed with content extraction
            const injectionFunction = useVideoExtractor ? extractYouTubeCaptionText : extractPageContent;
            const functionName = useVideoExtractor ? 'extractYouTubeCaptionText' : 'extractPageContent';

            console.log(`Injecting function: ${functionName} into tab ${activeTab.id}`);
            const results = await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: injectionFunction,
            });

            if (results && results[0] && typeof results[0].result === 'string') {
                 pageContent = results[0].result;
                 console.log(`Extracted content (${functionName}):`, pageContent.substring(0, 200) + "...");
             } else {
                 console.warn("Content script executed but returned no string result:", results);
                 pageContent = useVideoExtractor
                    ? "[Could not extract transcript. Ensure captions are available and try opening the panel manually if needed.]"
                    : "[Could not extract page content.]";
             }
        } catch (error) {
            console.error(`Error injecting script or extracting content on ${activeTab.url}:`, error);
            let errorMessage = `Failed to get page content: ${error.message}`;
            if (error.message.includes("Cannot access") || error.message.includes("cannot be scripted")) errorMessage = "Cannot access content on this page due to restrictions.";
            else if (error.message.includes("No tab with id")) errorMessage = "Active tab closed or invalid.";
            sendAsyncResponse({ error: errorMessage });
            return;
        }

        // Construct messages for OpenAI
        let messages = [...request.history];
        const baseSystemPrompt = `You are a helpful assistant in a Chrome Extension analyzing a webpage.`;
        const pageInfo = `The user is on: ${activeTab.url || 'Unknown URL'}.`;
        let contentContext = "";
         if (pageContent && !pageContent.startsWith("[")) {
             contentContext = useVideoExtractor
                 ? `\n\nHere is the extracted YouTube video transcript:\n"""\n${pageContent}\n"""`
                 : `\n\nHere is the extracted text content from the page:\n"""\n${pageContent}\n"""`;
         } else {
             contentContext = `\n\n[${pageContent}]`; // Include failure message
         }

        if (request.type === 'summarize') {
             // (Keep existing summarize logic)
            messages.push({
                role: "user",
                content: `${baseSystemPrompt} ${pageInfo}${contentContext}\n\nPlease provide a concise summary of the webpage content.`
            });
        } else if (request.type === 'summarizeVideo') {
            // (Keep existing summarizeVideo logic)
             messages.push({
                 role: "user",
                 content: `${baseSystemPrompt} ${pageInfo}${contentContext}\n\nPlease analyze the provided YouTube video transcript. Generate a detailed summary focusing on the key learnings, main insights, and actionable takeaways presented in the video.`
             });
        } else if (request.type === 'chat' && request.prompt) {
            // (Keep existing chat logic)
            const isFirstUserMessage = messages.filter(m => m.role === 'user').length <= 1;
            let systemMessageContent = `${baseSystemPrompt} ${pageInfo}`;
             if (isFirstUserMessage || messages.length === 0) {
                 systemMessageContent += contentContext;
             }
            if (messages.length === 0 || messages[0].role !== 'system') {
                messages.unshift({ role: "system", content: systemMessageContent });
             }
            messages.push({ role: "user", content: request.prompt });
        } else {
            sendAsyncResponse({ error: "Invalid request type or missing prompt." });
            return;
        }

        // Basic message cleanup
         messages = messages.reduce((acc, msg, i) => {
            if (i > 0 && msg.role === acc[acc.length - 1]?.role) acc[acc.length - 1] = msg;
            else if (!(i === 0 && msg.role === 'assistant')) acc.push(msg);
            return acc;
         }, []);

        // Call OpenAI API
        try {
            console.log("Sending final messages to OpenAI:", messages);
            const assistantResponse = await callOpenAI(apiKey, messages);
            sendAsyncResponse({ content: assistantResponse });
        } catch (error) {
            console.error("Error during OpenAI call:", error);
            sendAsyncResponse({ error: error.message });
        }

    })();

    return true; // Indicate asynchronous response
});

// Optional: Install/Update listener
chrome.runtime.onInstalled.addListener(details => {
    console.log(`Extension ${details.reason}: Version ${chrome.runtime.getManifest().version}`);
});

console.log("Background service worker started.");