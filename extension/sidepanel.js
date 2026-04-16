// Side Panel logic for Jaat's Assistant
// Manages scraping, question display, and backend communication

(function () {
  "use strict";

  const API_BASE = "http://localhost:8000";

  // DOM Elements
  const scrapeBtn = document.getElementById("scrapeBtn");
  const questionsSection = document.getElementById("questionsSection");
  const questionsList = document.getElementById("questionsList");
  const questionCount = document.getElementById("questionCount");
  const answerSection = document.getElementById("answerSection");
  const answerContent = document.getElementById("answerContent");
  const loadingSection = document.getElementById("loadingSection");
  const errorSection = document.getElementById("errorSection");
  const errorText = document.getElementById("errorText");
  const retryBtn = document.getElementById("retryBtn");
  const statusIndicator = document.getElementById("statusIndicator");

  let currentQuestions = [];
  let selectedQuestionIndex = -1;

  // ===== Status Management =====
  function setStatus(status, text) {
    const dot = statusIndicator.querySelector(".status-dot");
    const label = statusIndicator.querySelector(".status-text");
    label.textContent = text;

    statusIndicator.className = "status-indicator";
    dot.style.background = "";

    if (status === "ready") {
      statusIndicator.style.background = "var(--success-bg)";
      statusIndicator.style.borderColor = "rgba(52, 211, 153, 0.2)";
      dot.style.background = "var(--success)";
      label.style.color = "var(--success)";
    } else if (status === "working") {
      statusIndicator.style.background = "var(--warning-bg)";
      statusIndicator.style.borderColor = "rgba(251, 191, 36, 0.2)";
      dot.style.background = "var(--warning)";
      label.style.color = "var(--warning)";
    } else if (status === "error") {
      statusIndicator.style.background = "var(--error-bg)";
      statusIndicator.style.borderColor = "rgba(248, 113, 113, 0.2)";
      dot.style.background = "var(--error)";
      label.style.color = "var(--error)";
    }
  }

  // ===== Section Visibility =====
  function showSection(section) {
    [questionsSection, answerSection, loadingSection, errorSection].forEach((s) => {
      s.classList.add("hidden");
    });
    if (section) section.classList.remove("hidden");
  }

  function showQuestionsAndAnswer() {
    questionsSection.classList.remove("hidden");
    answerSection.classList.remove("hidden");
    loadingSection.classList.add("hidden");
    errorSection.classList.add("hidden");
  }

  // ===== Scrape Button =====
  scrapeBtn.addEventListener("click", async () => {
    scrapeBtn.disabled = true;
    scrapeBtn.querySelector("span").textContent = "Scanning...";
    setStatus("working", "Scanning");

    try {
      let settleId;
      let hardTimeoutId;

      const cleanup = () => {
        chrome.storage.session.onChanged.removeListener(onDataReady);
        clearTimeout(settleId);
        clearTimeout(hardTimeoutId);
      };

      // Finalize: read the accumulated storage and display results.
      const finalize = () => {
        cleanup();
        chrome.storage.session.get("scrapedData", (result) => {
          if (result.scrapedData && result.scrapedData.questions && result.scrapedData.questions.length > 0) {
            displayQuestions(result.scrapedData.questions);
            setStatus("ready", "Ready");
          } else {
            handleError("No questions detected on this page.");
          }
          resetScrapeBtn();
        });
      };

      // Debounced listener: each time storage updates, wait 1.5 s for more
      // frames to report before finalizing.
      const onDataReady = (changes) => {
        if (changes.scrapedData && changes.scrapedData.newValue) {
          clearTimeout(settleId);
          settleId = setTimeout(finalize, 1500);
        }
      };

      chrome.storage.session.onChanged.addListener(onDataReady);

      // Hard timeout — finalize after 8 seconds regardless (accounts for
      // content-script retries + multi-frame collection).
      hardTimeoutId = setTimeout(finalize, 8000);

      // Trigger content script via background
      chrome.runtime.sendMessage({ type: "TRIGGER_SCRAPE" }, (response) => {
        if (chrome.runtime.lastError) {
          cleanup();
          handleError("Could not connect to the page. Try refreshing.");
          resetScrapeBtn();
          return;
        }
      });
    } catch (err) {
      handleError("Failed to scan page: " + err.message);
      resetScrapeBtn();
    }
  });

  function resetScrapeBtn() {
    scrapeBtn.disabled = false;
    scrapeBtn.querySelector("span").textContent = "Scan Page";
  }

  // ===== Display Questions =====
  function displayQuestions(questions) {
    currentQuestions = questions;
    questionsList.innerHTML = "";

    if (questions.length === 0) {
      handleError("No questions detected on this page.");
      return;
    }

    questionCount.textContent = questions.length;
    questionsSection.classList.remove("hidden");
    answerSection.classList.add("hidden");

    questions.forEach((q, index) => {
      const item = document.createElement("div");
      item.className = "question-item";
      item.setAttribute("data-index", index);

      // Truncate question text for display
      const displayText = q.question.length > 200
        ? q.question.substring(0, 200) + "..."
        : q.question;

      let optionsHTML = "";
      if (q.options && q.options.length > 0) {
        optionsHTML = `
          <div class="question-options">
            ${q.options.map((opt) => `<div class="option-item">${escapeHTML(opt)}</div>`).join("")}
          </div>
        `;
      }

      item.innerHTML = `
        <div class="question-number">Question ${index + 1} · ${q.type || "detected"}</div>
        <div class="question-text">${escapeHTML(displayText)}</div>
        ${optionsHTML}
        <div class="question-actions">
          <button class="btn btn-solve solve-single-btn" data-index="${index}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
            Solve
          </button>
        </div>
      `;

      // Select on click
      item.addEventListener("click", (e) => {
        if (e.target.closest(".solve-single-btn")) return;
        document.querySelectorAll(".question-item").forEach((qi) => qi.classList.remove("selected"));
        item.classList.add("selected");
        selectedQuestionIndex = index;
      });

      questionsList.appendChild(item);
    });

    // Solve buttons
    document.querySelectorAll(".solve-single-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.currentTarget.dataset.index, 10);
        solveQuestion(idx);
      });
    });
  }

  // ===== Solve Question =====
  async function solveQuestion(index) {
    const question = currentQuestions[index];
    if (!question) return;

    // Show loading
    showSection(loadingSection);
    questionsSection.classList.remove("hidden");
    setStatus("working", "Solving");

    try {
      const response = await fetch(`${API_BASE}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.question,
          options: question.options || []
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();
      displayAnswer(data);
      setStatus("ready", "Solved");
    } catch (err) {
      if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
        handleError("Cannot connect to backend. Make sure the server is running on localhost:8000");
      } else {
        handleError(err.message);
      }
    }
  }

  // ===== Display Answer =====
  function displayAnswer(data) {
    answerContent.innerHTML = "";

    // Answer label
    const label = document.createElement("div");
    label.className = "answer-label";
    label.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      AI Answer
    `;
    answerContent.appendChild(label);

    // Answer text
    const answerBox = document.createElement("div");
    answerBox.className = "answer-text";
    answerBox.textContent = data.answer || "No answer provided";
    answerContent.appendChild(answerBox);

    // Explanation
    if (data.explanation) {
      const expLabel = document.createElement("div");
      expLabel.className = "explanation-label";
      expLabel.textContent = "Explanation";

      const expBox = document.createElement("div");
      expBox.className = "explanation-text";
      expBox.textContent = data.explanation;

      answerContent.appendChild(expLabel);
      answerContent.appendChild(expBox);
    }

    showQuestionsAndAnswer();
  }

  // ===== Error Handling =====
  function handleError(message) {
    errorText.textContent = message;
    showSection(errorSection);
    questionsSection.classList.remove("hidden");
    setStatus("error", "Error");
  }

  retryBtn.addEventListener("click", () => {
    showSection(null);
    questionsSection.classList.add("hidden");
    setStatus("ready", "Ready");
  });

  // ===== Utility =====
  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Listen for storage changes (real-time scrape updates) =====
  chrome.storage.session?.onChanged?.addListener((changes) => {
    if (changes.scrapedData?.newValue) {
      displayQuestions(changes.scrapedData.newValue.questions);
    }
  });

  // ===== Health check on load =====
  (async function checkBackend() {
    try {
      const res = await fetch(`${API_BASE}/health`, { method: "GET" });
      if (res.ok) {
        setStatus("ready", "Connected");
      } else {
        setStatus("error", "Server Error");
      }
    } catch {
      setStatus("error", "Offline");
    }
  })();
})();
