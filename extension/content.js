// Content script for Jaat's Assistant
// Scrapes quiz questions and options from the active web page

(function () {
  "use strict";

  // Prevent duplicate execution within a short window
  if (window.__jaatAssistantScraped) return;
  window.__jaatAssistantScraped = true;

  /**
   * Extract questions and options from the page DOM.
   * Handles common quiz platforms, LMS pages, and generic HTML structures.
   */
  function scrapeQuestions() {
    const results = [];

    // Strategy 1: Look for form-based quizzes (radio/checkbox groups)
    const formGroups = findFormBasedQuestions();
    if (formGroups.length > 0) {
      results.push(...formGroups);
    }

    // Strategy 2: Look for numbered/lettered question patterns in text
    if (results.length === 0) {
      const textQuestions = findTextBasedQuestions();
      results.push(...textQuestions);
    }

    // Strategy 3: Fallback — grab all visible text and try to parse
    if (results.length === 0) {
      const fallback = fallbackScrape();
      if (fallback) results.push(fallback);
    }

    return results;
  }

  /**
   * Strategy 1: Form-based questions (radio buttons, checkboxes, selects)
   */
  function findFormBasedQuestions() {
    const questions = [];

    // Find fieldsets, divs with role="group", or common quiz containers
    const containers = document.querySelectorAll(
      'fieldset, [role="group"], .question, .quiz-question, .question-container, ' +
      '.que, .formulation, .qtext, [class*="question"], [class*="quiz"], ' +
      '[data-question], .wpProQuiz_question'
    );

    containers.forEach((container) => {
      const questionObj = extractQuestionFromContainer(container);
      if (questionObj && questionObj.question.trim().length > 10) {
        questions.push(questionObj);
      }
    });

    // Also check for standalone radio/checkbox groups not in containers
    if (questions.length === 0) {
      const radioGroups = {};
      document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
        const name = input.name || input.id;
        if (!radioGroups[name]) radioGroups[name] = [];
        const label = findLabelForInput(input);
        if (label) radioGroups[name].push(label);
      });

      Object.values(radioGroups).forEach((options) => {
        if (options.length >= 2) {
          // Try to find a question text near these options
          const firstInput = document.querySelector(`input[name="${Object.keys(radioGroups)[0]}"]`);
          const questionText = findNearestQuestionText(firstInput);
          questions.push({
            question: questionText || "Question detected (text unclear)",
            options: options,
            type: "multiple-choice"
          });
        }
      });
    }

    return questions;
  }

  /**
   * Extract question text and options from a container element
   */
  function extractQuestionFromContainer(container) {
    // Find question text
    let questionText = "";
    const questionEl = container.querySelector(
      '.qtext, .question-text, .question-title, .question_text, legend, ' +
      'h2, h3, h4, p:first-of-type, [class*="question-stem"], [class*="prompt"]'
    );

    if (questionEl) {
      questionText = questionEl.innerText.trim();
    } else {
      // Grab first significant text node
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text.length > 15) {
          questionText = text;
          break;
        }
      }
    }

    // Find options
    const options = [];
    const optionEls = container.querySelectorAll(
      'input[type="radio"], input[type="checkbox"], .answer, .option, ' +
      '[class*="choice"], [class*="answer"], li, .ml-1'
    );

    optionEls.forEach((el) => {
      let optionText = "";
      if (el.tagName === "INPUT") {
        optionText = findLabelForInput(el);
      } else {
        optionText = el.innerText.trim();
      }
      if (optionText && optionText.length > 0 && !options.includes(optionText)) {
        options.push(optionText);
      }
    });

    if (!questionText) return null;

    return {
      question: questionText,
      options: options.length > 0 ? options : [],
      type: options.length > 0 ? "multiple-choice" : "open-ended"
    };
  }

  /**
   * Find the label text for an input element
   */
  function findLabelForInput(input) {
    // Check for associated <label>
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.innerText.trim();
    }

    // Check parent label
    const parentLabel = input.closest("label");
    if (parentLabel) return parentLabel.innerText.trim();

    // Check next sibling
    const next = input.nextElementSibling;
    if (next && (next.tagName === "LABEL" || next.tagName === "SPAN")) {
      return next.innerText.trim();
    }

    // Check adjacent text node
    const nextText = input.nextSibling;
    if (nextText && nextText.nodeType === Node.TEXT_NODE) {
      return nextText.textContent.trim();
    }

    return "";
  }

  /**
   * Find the nearest question-like text to an element
   */
  function findNearestQuestionText(el) {
    if (!el) return null;
    let current = el.parentElement;
    let depth = 0;
    while (current && depth < 5) {
      const prev = current.previousElementSibling;
      if (prev) {
        const text = prev.innerText?.trim();
        if (text && (text.includes("?") || text.length > 20)) {
          return text;
        }
      }
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  /**
   * Strategy 2: Text-based pattern matching for questions
   */
  function findTextBasedQuestions() {
    const questions = [];
    const body = document.body.innerText;

    // Pattern: "Q1." or "1." or "Question 1:" followed by text, then a/b/c/d or A/B/C/D options
    const questionPattern = /(?:(?:Q|Question)\s*\.?\s*)?(\d+)\s*[.):\-]\s*(.+?)(?=(?:(?:Q|Question)\s*\.?\s*)?\d+\s*[.):\-]|$)/gis;
    const optionPattern = /^\s*[A-Da-d][.)]\s*(.+)$/gm;

    // Split by common question delimiters
    const blocks = body.split(/(?=(?:Q|Question)\s*\d|^\s*\d+\s*[.)]\s)/m);

    blocks.forEach((block) => {
      const trimmed = block.trim();
      if (trimmed.length < 20) return;

      // Check if this block contains a question mark
      const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);

      let questionText = "";
      const options = [];

      lines.forEach((line) => {
        // Check if line is an option (starts with A), B), a., etc.)
        const optMatch = line.match(/^\s*[A-Da-d][.)]\s*(.+)/);
        if (optMatch) {
          options.push(line.trim());
        } else if (!questionText && (line.includes("?") || line.match(/^\s*(?:Q|Question)?\s*\d/i))) {
          questionText = line.replace(/^\s*(?:Q|Question)?\s*\d+\s*[.):\-]\s*/i, "").trim();
        }
      });

      if (questionText && questionText.length > 10) {
        questions.push({
          question: questionText,
          options: options,
          type: options.length > 0 ? "multiple-choice" : "open-ended"
        });
      }
    });

    return questions;
  }

  /**
   * Strategy 3: Fallback — send full page text
   */
  function fallbackScrape() {
    const bodyText = document.body.innerText.trim();
    if (bodyText.length < 20) return null;

    // Truncate to a reasonable length
    const truncated = bodyText.substring(0, 5000);

    return {
      question: truncated,
      options: [],
      type: "full-page"
    };
  }

  // Run the scraper
  const scrapedData = scrapeQuestions();

  // Send results to background script
  chrome.runtime.sendMessage({
    type: "SCRAPED_DATA",
    data: {
      url: window.location.href,
      title: document.title,
      questions: scrapedData,
      timestamp: Date.now()
    }
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Jaat's Assistant: Failed to send scraped data:", chrome.runtime.lastError.message);
    }
  });

  // Reset flag after the scrape completes so re-scraping is possible on demand.
  // Use a minimal delay to prevent rapid duplicate injections but allow
  // the user to trigger a fresh scrape shortly after.
  setTimeout(() => {
    window.__jaatAssistantScraped = false;
  }, 500);
})();
