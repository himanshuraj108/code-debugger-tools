// Initialize watch history from local storage
let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];

// Track state variables
let selectedHistoryIndex = null;
let visualizerEnabled = false;
let questionsEnabled = false;
let codeIsRunning = false;
let lastRunStatus = null; // Track if the last run was successful
let lastRunResult = null; // Store the last successful run result

// Add syntax highlighting style
const syntaxHighlightingStyles = document.createElement('style');
syntaxHighlightingStyles.innerHTML = `
    .code-editor {
        position: relative;
        font-family: 'Consolas', 'Monaco', monospace;
        line-height: 1.5;
    }
    
    .code-editor .keywords { color: #569CD6; }
    .code-editor .strings { color: #CE9178; }
    .code-editor .numbers { color: #B5CEA8; }
    .code-editor .comments { color: #6A9955; font-style: italic; }
    .code-editor .functions { color: #DCDCAA; }
    .code-editor .operators { color: #D4D4D4; }
    .code-editor .variables { color: #9CDCFE; }
    .code-editor .brackets { color: #D4D4D4; }
`;
document.head.appendChild(syntaxHighlightingStyles);

// Auto-resize textarea as content changes
function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
}

// Function to apply syntax highlighting
function applySyntaxHighlighting(code, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Process code to escape HTML entities first
    let processedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Apply JavaScript syntax highlighting with careful ordering to prevent nested spans
    let highlightedCode = processedCode;
    
    // Comments - process these first
    highlightedCode = highlightedCode
        .replace(/\/\/.*$/gm, match => `<span class="comments">${match}</span>`)
        .replace(/\/\*[\s\S]*?\*\//gm, match => `<span class="comments">${match}</span>`);
    
    // Don't process content inside comment spans
    const commentSpans = [];
    let commentMatch;
    const commentRegex = /<span class="comments">([\s\S]*?)<\/span>/g;
    
    while ((commentMatch = commentRegex.exec(highlightedCode)) !== null) {
        commentSpans.push({
            index: commentMatch.index,
            length: commentMatch[0].length,
            content: commentMatch[0]
        });
    }
    
    // Helper function to check if position is inside a comment span
    function isInCommentSpan(position) {
        return commentSpans.some(span => 
            position >= span.index && position < span.index + span.length);
    }
    
    // Apply other highlighting with regex that skips comment spans
    const patterns = [
        // Strings
        { regex: /(["'`])([\s\S]*?)\1/g, className: "strings" },
        // Numbers
        { regex: /\b(\d+(\.\d+)?)\b/g, className: "numbers" },
        // Keywords
        { regex: /\b(function|return|if|else|for|while|let|const|var|new|try|catch|finally|switch|case|break|continue|class|import|export|this|async|await)\b/g, 
          className: "keywords" },
        // Functions
        { regex: /\b(\w+)(?=\s*\()/g, className: "functions" },
        // Operators
        { regex: /([=+\-*/%<>&|^!~?:.])/g, className: "operators" },
        // Brackets
        { regex: /([{}[\]()])/g, className: "brackets" }
    ];
    
    // Apply patterns one at a time to avoid nesting
    for (const pattern of patterns) {
        let tempCode = '';
        let lastIndex = 0;
        let match;
        
        // Reset regex lastIndex
        pattern.regex.lastIndex = 0;
        
        while ((match = pattern.regex.exec(highlightedCode)) !== null) {
            // Skip if this match is inside a comment span
            if (isInCommentSpan(match.index)) {
                // Move lastIndex to continue searching
                pattern.regex.lastIndex = match.index + 1;
                continue;
            }
            
            // Add text before match
            tempCode += highlightedCode.substring(lastIndex, match.index);
            // Add highlighted match
            tempCode += `<span class="${pattern.className}">${match[0]}</span>`;
            lastIndex = match.index + match[0].length;
        }
        
        // Add remaining text
        tempCode += highlightedCode.substring(lastIndex);
        highlightedCode = tempCode;
    }
    
    // Create a div for the highlighted code
    const highlightedDiv = document.createElement('div');
    highlightedDiv.className = 'code-editor';
    highlightedDiv.innerHTML = `<pre>${highlightedCode}</pre>`;
    
    // Replace or append to the container
    if (container.firstChild) {
        container.replaceChild(highlightedDiv, container.firstChild);
    } else {
        container.appendChild(highlightedDiv);
    }
}

// Function to update toggle states based on code execution status
function updateFeatureToggles() {
    const visualizerToggle = document.getElementById('visualizer-toggle');
    const questionsToggle = document.getElementById('questions-toggle');
    
    if (lastRunStatus === "success") {
        // Enable toggles if last run was successful
        visualizerToggle.classList.remove('disabled');
        questionsToggle.classList.remove('disabled');
        visualizerToggle.disabled = false;
        questionsToggle.disabled = false;
    } else {
        // Disable toggles and reset their state if code has errors
        visualizerToggle.classList.add('disabled');
        questionsToggle.classList.add('disabled');
        visualizerToggle.classList.remove('active');
        questionsToggle.classList.remove('active');
        visualizerToggle.disabled = true;
        questionsToggle.disabled = true;
        visualizerEnabled = false;
        questionsEnabled = false;
    }
}

// Function to display the feature based on toggle status
function displayFeature(featureType) {
    if (lastRunStatus !== "success" || !lastRunResult) {
        return;
    }
    
    if (featureType === "visualizer" && visualizerEnabled) {
        // Display visualization if enabled and we have execution steps
        if (lastRunResult.execution_steps) {
            animateExecution(lastRunResult.execution_steps, document.getElementById("code").value);
        } else {
            const visualizationDiv = document.getElementById("visualization-output");
            visualizationDiv.innerHTML = "<div class='visualization-placeholder'>No visualization data available for this code.</div>";
        }
    } else if (featureType === "questions" && questionsEnabled) {
        // Display questions if enabled
        const questionsDiv = document.getElementById("questions-list");
        if (lastRunResult.questions) {
            questionsDiv.innerHTML = lastRunResult.questions
                .map((q) => `<li>${q}</li>`)
                .join("");
        } else {
            questionsDiv.innerHTML = "<li>No learning questions available for this code.</li>";
        }
    }
}

// Initialize event listeners when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    // Set up history confirmation buttons
    document.getElementById("history-confirm-yes").addEventListener("click", () => {
        if (selectedHistoryIndex === null || !watchHistory[selectedHistoryIndex]) {
            console.error("No history item selected");
            return;
        }
        
        const code = watchHistory[selectedHistoryIndex].code;
        const codeTextArea = document.getElementById("code");
        codeTextArea.value = code;
        autoResize(codeTextArea);
        
        // Apply syntax highlighting to the loaded code
        applySyntaxHighlighting(code, "code-display-container");
        
        document.getElementById("history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
        toggleWatchHistory();
    });

    document.getElementById("history-confirm-no").addEventListener("click", () => {
        document.getElementById("history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
        selectedHistoryIndex = null;
    });

    // Set up clear history confirmation buttons
    document.getElementById("clear-history-yes").addEventListener("click", () => {
        watchHistory = [];
        localStorage.removeItem("watchHistory");
        updateHistoryDisplay();
        document.getElementById("clear-history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
        
        // Make popup invisible when history is cleared
        document.getElementById("watch-history").style.display = "none";
    });

    document.getElementById("clear-history-no").addEventListener("click", () => {
        document.getElementById("clear-history-confirmation").style.display = "none";
        document.getElementById("main-container").classList.remove("blur-background");
    });

    // Set up visualizer toggle - now with improved functionality
    const visualizerToggle = document.getElementById('visualizer-toggle');
    if (visualizerToggle) {
        visualizerToggle.addEventListener('click', () => {
            if (lastRunStatus !== "success") {
                // Show error message if code hasn't been run successfully
                const outputDiv = document.getElementById("output");
                outputDiv.innerHTML = `<pre class="error-output">Please run your code successfully before enabling visualization.</pre>`;
                return;
            }
            
            visualizerEnabled = !visualizerEnabled;
            visualizerToggle.classList.toggle('active', visualizerEnabled);
            
            // Immediately display or hide visualization based on toggle state
            const visualizationDiv = document.getElementById("visualization-output");
            if (visualizerEnabled) {
                displayFeature("visualizer");
            } else {
                visualizationDiv.innerHTML = "<div class='visualization-placeholder'>Enable visualization to see code execution</div>";
            }
        });
    }

    // Set up questions toggle - now with improved functionality
    const questionsToggle = document.getElementById('questions-toggle');
    if (questionsToggle) {
        questionsToggle.addEventListener('click', () => {
            if (lastRunStatus !== "success") {
                // Show error message if code hasn't been run successfully
                const outputDiv = document.getElementById("output");
                outputDiv.innerHTML = `<pre class="error-output">Please run your code successfully before enabling questions.</pre>`;
                return;
            }
            
            questionsEnabled = !questionsEnabled;
            questionsToggle.classList.toggle('active', questionsEnabled);
            
            // Immediately display or hide questions based on toggle state
            const questionsDiv = document.getElementById("questions-list");
            if (questionsEnabled) {
                displayFeature("questions");
            } else {
                questionsDiv.innerHTML = "<li>Enable questions to see learning prompts here</li>";
            }
        });
    }

    // Disable toggles initially
    updateFeatureToggles();

    // Set up features popup
    document.getElementById('showFeaturesLink').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('features-popup').style.display = 'flex';
        document.getElementById('main-container').classList.add('blur-background');
    });

    document.getElementById('closePopupBtn').addEventListener('click', () => {
        document.getElementById('features-popup').style.display = 'none';
        document.getElementById('main-container').classList.remove('blur-background');
    });

    document.getElementById('closeFeatureBtn').addEventListener('click', () => {
        document.getElementById('features-popup').style.display = 'none';
        document.getElementById('main-container').classList.remove('blur-background');
    });

    // Add input event listener to code textarea for syntax highlighting
    const codeTextArea = document.getElementById("code");
    if (codeTextArea) {
        codeTextArea.addEventListener('input', () => {
            const code = codeTextArea.value;
            applySyntaxHighlighting(code, 'code-display-container');
            autoResize(codeTextArea);
            
            // Reset run status when code changes
            if (lastRunStatus === "success") {
                lastRunStatus = null;
                lastRunResult = null;
                updateFeatureToggles();
                
                // Reset feature displays
                const visualizationDiv = document.getElementById("visualization-output");
                visualizationDiv.innerHTML = "<div class='visualization-placeholder'>Run code to enable visualization</div>";
                
                const questionsDiv = document.getElementById("questions-list");
                questionsDiv.innerHTML = "<li>Run code to enable questions</li>";
            }
        });
        
        // Initial highlight if there's code already
        if (codeTextArea.value) {
            applySyntaxHighlighting(codeTextArea.value, 'code-display-container');
        }
    }

    // Initialize history display
    updateHistoryDisplay();
});

// Debug code function - sends code to backend for execution
async function debugCode() {
    if (codeIsRunning) return; // Prevent multiple simultaneous runs
    
    codeIsRunning = true;
    const code = document.getElementById("code").value;
    const language = document.getElementById("language").value;
    const userInput = document.getElementById("user-input").value;
    const outputDiv = document.getElementById("output");
    const questionsDiv = document.getElementById("questions-list");
    const spinner = document.getElementById("spinner");
    const button = document.getElementById("runCodeBtn");
    const buttonText = document.getElementById("buttonText");
    const autoCorrectBtn = document.getElementById("autoCorrectBtn");
    const visualizationDiv = document.getElementById("visualization-output");
    const correctedCodeDiv = document.getElementById("corrected-code");
    const copyCorrectedCodeBtn = document.getElementById("copyCorrectedCodeBtn");

    // Reset all output areas
    outputDiv.innerHTML = "Your output will be displayed here";
    questionsDiv.innerHTML = "";
    visualizationDiv.innerHTML = "";
    correctedCodeDiv.innerHTML = "";
    copyCorrectedCodeBtn.style.display = "none";
    
    // Show spinner
    spinner.style.display = "block";
    
    // Update button text to indicate processing
    buttonText.innerHTML = "Running";
    button.disabled = true;
    autoCorrectBtn.style.display = "none";

    try {
        const response = await fetch("http://127.0.0.1:5000/debug", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code, language, user_input: userInput }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.output) {
            // Success case - show output and store result for future feature use
            outputDiv.innerHTML = `<pre class="success-output">${result.output}</pre>`;
            lastRunStatus = "success";
            lastRunResult = result; // Store the result for later use
            
            // Show placeholder messages for disabled features
            visualizationDiv.innerHTML = "<div class='visualization-placeholder'>Enable visualization to see code execution</div>";
            questionsDiv.innerHTML = "<li>Enable questions to see learning prompts here</li>";
            
            // Update toggle states to enable them
            updateFeatureToggles();
        } else if (result.error) {
            // Error case - show error and prompt for correction
            outputDiv.innerHTML = `<pre class="error-output">${result.error}</pre>`;
            document.getElementById("main-container").classList.add("blur-background");
            document.getElementById("confirmation").style.display = "flex";
            lastRunStatus = "error";
            lastRunResult = null;
            
            // Update toggle states to disable them
            updateFeatureToggles();
        }

        // Save to history
        const historyItem = {
            code: code,
            timestamp: new Date().toISOString(),
            status: result.output ? "success" : "error",
            language: language,
            source: "run",
        };
        watchHistory.unshift(historyItem); // Add to beginning
        if (watchHistory.length > 50) watchHistory.pop(); // Limit history length
        updateHistoryDisplay();

    } catch (error) {
        console.error("Error during fetch operation:", error);
        outputDiv.innerHTML = `<pre class="error-output">Failed to run code. Please try again. Server might be offline.</pre>`;
        lastRunStatus = "error";
        lastRunResult = null;
        updateFeatureToggles();
    } finally {
        // Reset UI state
        spinner.style.display = "none";
        buttonText.innerHTML = "Run Code";
        button.disabled = false;
        codeIsRunning = false;
    }
}

// Animate code execution with step-by-step highlighting
function animateExecution(steps, fullCode) {
    if (!visualizerEnabled || !steps || steps.length === 0) return;

    let stepIndex = 0;
    const codeLines = fullCode.split("\n");
    const visualizationDiv = document.getElementById("visualization-output");
    
    visualizationDiv.innerHTML = '<div class="visualization-controls">' +
        '<button id="step-back" disabled><i class="fas fa-step-backward"></i></button>' +
        '<button id="play-pause"><i class="fas fa-play"></i></button>' +
        '<button id="step-forward"><i class="fas fa-step-forward"></i></button>' +
        '</div>' +
        '<div id="code-display"></div>' +
        '<div id="step-description"></div>';
    
    const codeDisplay = document.getElementById("code-display");
    const stepDescription = document.getElementById("step-description");
    const stepBackBtn = document.getElementById("step-back");
    const stepForwardBtn = document.getElementById("step-forward");
    const playPauseBtn = document.getElementById("play-pause");
    
    let isPlaying = false;
    let animationInterval = null;
    
    // Function to update display for current step
    function updateDisplay() {
        let highlightedCode = codeLines.map((line, index) => {
            if (index === steps[stepIndex].lineNumber) {
                return `<span class="highlight">${line}</span>`;
            }
            return line;
        }).join("<br>");
        
        codeDisplay.innerHTML = `<pre>${highlightedCode}</pre>`;
        stepDescription.textContent = steps[stepIndex].stepDescription;
        
        // Update control button states
        stepBackBtn.disabled = stepIndex === 0;
        stepForwardBtn.disabled = stepIndex === steps.length - 1;
    }
    
    // Initial display
    updateDisplay();
    
    // Set up controls
    playPauseBtn.addEventListener("click", () => {
        isPlaying = !isPlaying;
        playPauseBtn.innerHTML = isPlaying ? 
            '<i class="fas fa-pause"></i>' : 
            '<i class="fas fa-play"></i>';
            
        if (isPlaying) {
            animationInterval = setInterval(() => {
                if (stepIndex < steps.length - 1) {
                    stepIndex++;
                    updateDisplay();
                } else {
                    isPlaying = false;
                    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
                    clearInterval(animationInterval);
                }
            }, 1000);
        } else {
            clearInterval(animationInterval);
        }
    });
    
    stepBackBtn.addEventListener("click", () => {
        if (stepIndex > 0) {
            stepIndex--;
            updateDisplay();
        }
    });
    
    stepForwardBtn.addEventListener("click", () => {
        if (stepIndex < steps.length - 1) {
            stepIndex++;
            updateDisplay();
        }
    });
}

// Paste text from clipboard to a given element
function pasteText(elementId) {
    const element = document.getElementById(elementId);
    navigator.clipboard.readText().then(text => {
        element.value = text;
        autoResize(element);
        
        // Apply syntax highlighting to pasted code
        applySyntaxHighlighting(text, 'code-display-container');

        // Save to history when pasting code
        const historyItem = {
            code: text,
            timestamp: new Date().toISOString(),
            status: "pasted",
            source: "paste",
        };
        watchHistory.unshift(historyItem);
        if (watchHistory.length > 50) watchHistory.pop();
        updateHistoryDisplay();
        
        // Reset run status when new code is pasted
        lastRunStatus = null;
        lastRunResult = null;
        updateFeatureToggles();
    }).catch(err => {
        console.error('Failed to read clipboard contents: ', err);
    });
}

// Handle request for code correction
function getCorrectCode() {
    document.getElementById("autoCorrectBtn").style.display = "block";
    document.getElementById("confirmation").style.display = "none";
    document.getElementById("main-container").classList.remove("blur-background");
}

// Dismiss error confirmation popup
function dismissConfirmation() {
    document.getElementById("main-container").classList.remove("blur-background");
    document.getElementById("confirmation").style.display = "none";
}

// Toggle the watch history panel
function toggleWatchHistory() {
    const historyDiv = document.getElementById("watch-history");
    historyDiv.style.display = historyDiv.style.display === "none" ? "block" : "none";
}

// Update the history display in the UI
function updateHistoryDisplay() {
    const historyList = document.getElementById("watch-history-list");
    
    if (watchHistory.length === 0) {
        historyList.innerHTML = '<li class="history-empty">No history yet</li>';
        
        // Auto-hide the popup when history is cleared
        const historyDiv = document.getElementById("watch-history");
        if (historyDiv.style.display === "block") {
            historyDiv.style.display = "none";
        }
    } else {
        historyList.innerHTML = watchHistory
            .map((item, index) => {
                // Create a preview of the code (first 30 chars)
                const codePreview = item.code.length > 30 ? 
                    item.code.substring(0, 30) + "..." : 
                    item.code;
                
                // Format timestamp if available
                const timeDisplay = item.timestamp ? 
                    new Date(item.timestamp).toLocaleTimeString() : 
                    '';
                
                return `<li class="history-item ${item.status}" onclick="loadCodeFromHistory(${index})">
                    <div class="history-code">${codePreview}</div>
                    <div class="history-meta">
                        <span class="history-status">${item.status}</span>
                        <span class="history-time">${timeDisplay}</span>
                    </div>
                </li>`;
            })
            .join("");
    }
    
    // Save to localStorage
    localStorage.setItem("watchHistory", JSON.stringify(watchHistory));
}

// Load code from history with confirmation
function loadCodeFromHistory(index) {
    if (index < 0 || index >= watchHistory.length) {
        console.error("Invalid history index");
        return;
    }
    
    selectedHistoryIndex = index;
    document.getElementById("history-confirmation").style.display = "flex";
    document.getElementById("main-container").classList.add("blur-background");
}

// Display clear history confirmation
function clearHistory() {
    document.getElementById("clear-history-confirmation").style.display = "flex";
    document.getElementById("main-container").classList.add("blur-background");
}

// Auto-correct code function - sends code to backend for correction
async function autoCorrectCode() {
    if (codeIsRunning) return; // Prevent multiple simultaneous runs
    
    codeIsRunning = true;
    const code = document.getElementById("code").value;
    const correctedCodeDiv = document.getElementById("corrected-code");
    const autoCorrectBtn = document.getElementById("autoCorrectBtn");
    const autoCorrectText = document.getElementById("autoCorrectText");
    const copyCorrectedCodeBtn = document.getElementById("copyCorrectedCodeBtn");
    
    // Update UI to show processing
    autoCorrectText.innerHTML = "Correcting";
    autoCorrectBtn.disabled = true;

    try {
        const response = await fetch("http://127.0.0.1:5000/autocorrect", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: code }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.corrected_code) {
            // Apply syntax highlighting to corrected code
            correctedCodeDiv.innerHTML = "";
            applySyntaxHighlighting(result.corrected_code, "corrected-code");
            
            copyCorrectedCodeBtn.style.display = "block";
            
            // Save corrected code to history
            const historyItem = {
                code: result.corrected_code,
                timestamp: new Date().toISOString(),
                status: "corrected",
                source: "auto-correct",
            };
            watchHistory.unshift(historyItem);
            if (watchHistory.length > 50) watchHistory.pop();
            updateHistoryDisplay();
        } else {
            correctedCodeDiv.innerHTML = "No correction available.";
        }
    } catch (error) {
        console.error("Error during fetch operation:", error);
        correctedCodeDiv.innerHTML = "Failed to auto-correct code. Please try again.";
    } finally {
        // Reset UI state
        autoCorrectText.innerHTML = "Fix Code";
        autoCorrectBtn.disabled = false;
        codeIsRunning = false;
    }
}

// Copy text from an element to clipboard
function copyText(elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
        const copyBtn = document.getElementById('copyCorrectedCodeBtn');
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
        }, 2000);
        
        // Add to history when copying corrected code
        const historyItem = {
            code: text,
            timestamp: new Date().toISOString(),
            status: "copied",
            source: "copy-corrected",
        };
        watchHistory.unshift(historyItem);
        if (watchHistory.length > 50) watchHistory.pop();
        updateHistoryDisplay();
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}