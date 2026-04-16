// Content script for Jaat's Assistant
// Scrapes quiz questions and options from the active web page.
// Handles SPAs (dynamic content), iframes, ARIA roles, and custom components.

(function () {
  "use strict";

  // Prevent duplicate/overlapping scrape runs in this frame.
  if (window.__jaatAssistantRunning) return;
  window.__jaatAssistantRunning = true;

  // Hard reset after 6 seconds so re-scraping is always possible.
  setTimeout(function () { window.__jaatAssistantRunning = false; }, 6000);

  var MAX_ATTEMPTS = 3;
  var RETRY_DELAY = 1000; // ms between retries

  // ──────────── Entry Point ────────────

  function run(attempt) {
    attempt = attempt || 1;

    var questions = scrapeAllQuestions(document);

    // Also try same-origin iframes reachable from this document
    if (questions.length === 0) {
      questions = scrapeIframes();
    }

    // Retry for dynamically rendered SPA content
    if (questions.length === 0 && attempt < MAX_ATTEMPTS) {
      setTimeout(function () { run(attempt + 1); }, RETRY_DELAY);
      return;
    }

    sendResults(questions);
  }

  // ──────────── Iframe Traversal ────────────

  function scrapeIframes() {
    var results = [];
    var iframes = document.querySelectorAll("iframe");
    for (var i = 0; i < iframes.length; i++) {
      try {
        var doc = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
        if (doc && doc.body) {
          results = results.concat(scrapeAllQuestions(doc));
        }
      } catch (_) {
        // Cross-origin — skip; handled by allFrames injection instead
      }
    }
    return results;
  }

  // ──────────── Core Scraper ────────────

  function scrapeAllQuestions(doc) {
    var results;

    // Strategy 1: Container-based (known quiz/question class or role selectors)
    results = findContainerBasedQuestions(doc);
    if (results.length > 0) return dedupeQuestions(results);

    // Strategy 2: Groups of radio/checkbox inputs or ARIA radio roles
    results = findRadioGroupQuestions(doc);
    if (results.length > 0) return dedupeQuestions(results);

    // Strategy 3: Text-pattern matching (numbered / lettered questions)
    results = findTextBasedQuestions(doc);
    if (results.length > 0) return dedupeQuestions(results);

    // Strategy 4: Fallback — send page text for server-side parsing
    var fb = fallbackScrape(doc);
    if (fb) return [fb];

    return [];
  }

  // ──────────── Strategy 1: Container-Based ────────────

  function findContainerBasedQuestions(doc) {
    var questions = [];

    var selector = [
      "fieldset",
      '[role="group"]',
      '[role="radiogroup"]',
      ".question",
      ".quiz-question",
      ".question-container",
      ".question-content",
      ".assessment-question",
      // Moodle
      ".que",
      ".formulation",
      ".qtext",
      // WordPress
      ".wpProQuiz_question",
      // Broad class-name patterns (covers NetAcad, Canvas, Blackboard, etc.)
      '[class*="question"]',
      '[class*="quiz-body"]',
      '[class*="assessment"]',
      '[class*="multiplechoice"]',
      '[class*="multiple-choice"]',
      '[class*="check-understanding"]',
      '[data-question]',
      '[data-assessment]'
    ].join(", ");

    var containers = doc.querySelectorAll(selector);
    var processed = [];

    containers.forEach(function (container) {
      if (isDescendantOfAny(container, processed)) return;

      var q = extractFromContainer(container);
      if (q && q.question.trim().length > 10) {
        processed.push(container);
        questions.push(q);
      }
    });

    return questions;
  }

  function isDescendantOfAny(el, list) {
    var parent = el.parentElement;
    while (parent) {
      if (list.indexOf(parent) !== -1) return true;
      parent = parent.parentElement;
    }
    return false;
  }

  function extractFromContainer(container) {
    var questionText = findQuestionText(container);
    var options = findOptions(container);

    if (!questionText && options.length === 0) return null;
    if (!questionText) questionText = "Question detected (text not found)";

    return {
      question: questionText,
      options: options,
      type: options.length > 0 ? "multiple-choice" : "open-ended"
    };
  }

  /**
   * Locate the question/prompt text inside a container.
   */
  function findQuestionText(container) {
    // Try specific class selectors first
    var selectors = [
      ".qtext", ".question-text", ".question-title", ".question_text",
      ".question-stem", '[class*="question-stem"]', '[class*="prompt"]',
      '[class*="question-body"]', '[class*="question-header"]',
      "legend"
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = container.querySelector(selectors[i]);
      if (el) {
        var text = cleanText(el);
        if (text.length > 10) return text;
      }
    }

    // Try headings and paragraphs
    var tags = ["h1", "h2", "h3", "h4", "h5", "p"];
    for (var t = 0; t < tags.length; t++) {
      var els = container.querySelectorAll(tags[t]);
      for (var j = 0; j < els.length; j++) {
        var txt = cleanText(els[j]);
        if (txt.length > 10 && !/^question\s*\d+\s*$/i.test(txt)) {
          return txt;
        }
      }
    }

    // Walk text nodes for the first significant text
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var nodeText = node.textContent.trim();
      if (nodeText.length > 15 && !/^question\s*\d+\s*$/i.test(nodeText)) {
        return nodeText;
      }
    }

    return "";
  }

  /**
   * Locate answer options inside a container.
   * Handles native HTML inputs, ARIA roles, Angular Material, and generic class patterns.
   */
  function findOptions(container) {
    var options = [];
    var seen = {};

    var addOption = function (text) {
      var t = (text || "").trim();
      if (t && t.length > 0 && t.length < 500 && !seen[t]) {
        seen[t] = true;
        options.push(t);
      }
    };

    // 1. Native radio / checkbox inputs
    container.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function (input) {
      addOption(findLabelForInput(input));
    });
    if (options.length >= 2) return options;

    // 2. ARIA roles (custom components used by modern frameworks)
    container.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]').forEach(function (el) {
      addOption(cleanText(el) || el.getAttribute("aria-label") || "");
    });
    if (options.length >= 2) return options;

    // 3. Framework-specific components (Angular Material, MUI, etc.)
    container.querySelectorAll(
      'mat-radio-button, mat-checkbox, .mat-radio-button, .mat-checkbox, ' +
      '[class*="radio-button"], [class*="radio-option"], ' +
      '[class*="answer-option"], [class*="choice-item"], [class*="option-item"]'
    ).forEach(function (el) {
      addOption(cleanText(el) || el.getAttribute("aria-label") || "");
    });
    if (options.length >= 2) return options;

    // 4. Generic option / choice / answer classes
    container.querySelectorAll(
      '.option, .answer, .choice, [class*="option"], [class*="choice"], [class*="answer"]'
    ).forEach(function (el) {
      var text = cleanText(el);
      if (text.length < 300) addOption(text);
    });
    if (options.length >= 2) return options;

    // 5. List items
    container.querySelectorAll("li").forEach(function (li) {
      var text = cleanText(li);
      if (text.length < 300) addOption(text);
    });

    return options;
  }

  // ──────────── Strategy 2: Radio Group Detection ────────────

  function findRadioGroupQuestions(doc) {
    var questions = [];

    // Group native inputs by name
    var groups = {};
    doc.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function (input) {
      var name = input.name || ("unnamed_" + input.id);
      if (!groups[name]) groups[name] = [];
      groups[name].push(input);
    });

    var groupNames = Object.keys(groups);
    for (var i = 0; i < groupNames.length; i++) {
      var inputs = groups[groupNames[i]];
      var opts = inputs.map(function (inp) { return findLabelForInput(inp); }).filter(Boolean);
      if (opts.length >= 2) {
        var qText = findNearestQuestionText(inputs[0]);
        questions.push({
          question: qText || "Question detected (text unclear)",
          options: opts,
          type: "multiple-choice"
        });
      }
    }

    // Also look for ARIA radiogroups
    if (questions.length === 0) {
      doc.querySelectorAll('[role="radiogroup"]').forEach(function (group) {
        var opts = [];
        group.querySelectorAll('[role="radio"]').forEach(function (r) {
          var t = cleanText(r) || r.getAttribute("aria-label") || "";
          if (t) opts.push(t);
        });
        if (opts.length >= 2) {
          var qText = findNearestQuestionText(group);
          if (!qText) {
            var lblId = group.getAttribute("aria-labelledby");
            if (lblId) {
              var lblEl = doc.getElementById(lblId);
              if (lblEl) qText = cleanText(lblEl);
            }
          }
          if (!qText) qText = group.getAttribute("aria-label") || "";
          questions.push({
            question: qText || "Question detected (text unclear)",
            options: opts,
            type: "multiple-choice"
          });
        }
      });
    }

    return questions;
  }

  // ──────────── Strategy 3: Text Pattern Matching ────────────

  function findTextBasedQuestions(doc) {
    var questions = [];
    var body = (doc.body && doc.body.innerText) || "";
    if (body.length < 30) return questions;

    var blocks = body.split(/(?=(?:Q|Question)\s*\d|^\s*\d+\s*[.)]\s)/m);

    blocks.forEach(function (block) {
      var trimmed = block.trim();
      if (trimmed.length < 20) return;

      var lines = trimmed.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      var questionText = "";
      var options = [];

      lines.forEach(function (line) {
        var optMatch = line.match(/^\s*[A-Da-d][.)]\s*(.+)/);
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

  // ──────────── Strategy 4: Fallback ────────────

  function fallbackScrape(doc) {
    var text = (doc.body && doc.body.innerText || "").trim();
    if (text.length < 50) return null;

    return {
      question: text.substring(0, 5000),
      options: [],
      type: "full-page"
    };
  }

  // ──────────── Helpers ────────────

  function findLabelForInput(input) {
    // Associated <label for="id">
    if (input.id) {
      try {
        var label = input.ownerDocument.querySelector('label[for="' + CSS.escape(input.id) + '"]');
        if (label) return cleanText(label);
      } catch (_) { /* CSS.escape not available — skip */ }
    }

    // Parent <label>
    var parentLabel = input.closest("label");
    if (parentLabel) return cleanText(parentLabel);

    // Next sibling element
    var next = input.nextElementSibling;
    if (next && (next.tagName === "LABEL" || next.tagName === "SPAN" || next.tagName === "DIV")) {
      return cleanText(next);
    }

    // Adjacent text node
    var nextText = input.nextSibling;
    if (nextText && nextText.nodeType === Node.TEXT_NODE) {
      return nextText.textContent.trim();
    }

    // Parent element text (for <div><input> Option text</div>)
    var parentEl = input.parentElement;
    if (parentEl) {
      var clone = parentEl.cloneNode(true);
      clone.querySelectorAll("input").forEach(function (inp) { inp.remove(); });
      var t = (clone.innerText || "").trim();
      if (t.length > 0 && t.length < 200) return t;
    }

    return "";
  }

  function findNearestQuestionText(el) {
    if (!el) return null;
    var current = el.parentElement;
    var depth = 0;
    while (current && depth < 10) {
      // Check preceding siblings
      var prev = current.previousElementSibling;
      while (prev) {
        var text = cleanText(prev);
        if (text && text.length > 10 && !/^question\s*\d+\s*$/i.test(text)) {
          return text;
        }
        // Also check inside the sibling
        var inner = prev.querySelector("p, h1, h2, h3, h4, h5, span, div");
        if (inner) {
          var innerText = cleanText(inner);
          if (innerText && innerText.length > 10) return innerText;
        }
        prev = prev.previousElementSibling;
      }
      // Check current element for headings/paragraphs
      var tags = ["h1", "h2", "h3", "h4", "h5", "p"];
      for (var i = 0; i < tags.length; i++) {
        var heading = current.querySelector(tags[i]);
        if (heading) {
          var hText = cleanText(heading);
          if (hText && hText.length > 10 && !/^question\s*\d+\s*$/i.test(hText)) return hText;
        }
      }
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function cleanText(el) {
    return (el.innerText || el.textContent || "").trim();
  }

  function dedupeQuestions(questions) {
    var seen = {};
    return questions.filter(function (q) {
      var key = q.question.substring(0, 100).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function sendResults(questions) {
    chrome.runtime.sendMessage(
      {
        type: "SCRAPED_DATA",
        data: {
          url: window.location.href,
          title: document.title,
          questions: questions,
          timestamp: Date.now()
        }
      },
      function () {
        if (chrome.runtime.lastError) {
          console.warn("Jaat's Assistant: Failed to send scraped data:", chrome.runtime.lastError.message);
        }
        // Allow re-scraping
        window.__jaatAssistantRunning = false;
      }
    );
  }

  // ──────────── Start ────────────
  run(1);
})();
