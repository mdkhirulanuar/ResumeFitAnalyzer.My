// ===================
// Utility functions
// ===================

const stopWords = new Set([
  'the','and','or','for','with','from','that','this','you','your','are','was','were',
  'dan','atau','yang','dengan','untuk','pada','serta','dll','etc','kepada','di',
  'of','in','to','a','an','is','as','by','be'
]);

function normalize(text) {
  return (text || '')
    .replace(/\r/g, '\n')
    .replace(/[\u2022•▪●]/g, '-') // bullet characters
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

function toSet(tokens) {
  return new Set(tokens);
}

// ===================
// OpenAI API configuration
// ===================
// To enable ChatGPT evaluation, set your OpenAI API key here. If left empty,
// the application will use its built-in scoring algorithm. For security,
// never commit your real API key to version control. Instead, assign this
// constant at runtime or use a proxy endpoint to hide your key.
const OPENAI_API_KEY = '';

// Evaluate resume and job description using OpenAI's Chat Completion API. This
// function constructs a prompt instructing the model to compare the resume
// against the job description and return a JSON object containing an overall
// alignment percentage, a classification label, a detailed itemised analysis,
// and lists of strengths and gaps. If the API request fails or the response
// cannot be parsed, the function throws an error and the app will fall back
// to the internal algorithm. You must supply a valid API key via the
// OPENAI_API_KEY constant for this to work.
async function evaluateWithChatGPT(resumeText, jdText) {
  // Build the prompt for ChatGPT. We ask for a strict JSON output so that it
  // can be parsed easily. The model should assess each requirement, but the
  // summarisation details are left to the model.
  const prompt = `Resume:\n${resumeText}\n\nJob Description:\n${jdText}\n\nPlease evaluate how well the resume matches the job description. Provide a JSON output with the following keys:\n- overall_score: a number between 0 and 100 indicating the percentage match\n- classification: a string indicating Strong Match, Moderate Match, or Weak Match\n- itemized: an array of objects where each object contains requirement (string), status (Yes/Partially/No), match_percent (0-100), and justification (string) quoting the resume or noting missing evidence\n- strengths: an array of requirement strings where the candidate scored 100%\n- gaps: an array of requirement strings where the candidate scored 20% or below\n- summary: a short narrative summarising the match\nReturn only the JSON string.`;
  const payload = {
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are an assistant that evaluates how well a resume matches a job description and returns a structured JSON report.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 1200,
    temperature: 0.3
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error('OpenAI API request failed with status ' + response.status);
  }
  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error('Unexpected API response format');
  }
  // Attempt to parse JSON from the response. The model should return a JSON object.
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('Failed to parse JSON from API response: ' + content);
  }
  const jsonString = content.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString);
}

// -------------------
// Synonyms and weighting
// -------------------
// A simple synonyms map to expand common terms used in quality and audit roles. Each key is
// a base form of a token and the value is an array of words that should be considered
// equivalent. This helps the matching algorithm recognize semantically similar
// expressions in the resume even if the exact wording differs.
const synonymsMap = {
  maintain: ['maintain', 'update', 'improve', 'keep'],
  documentation: ['documentation', 'documents', 'records', 'manual', 'procedure', 'procedures', 'instructions', 'docs'],
  audit: ['audit', 'auditing', 'audits', 'review', 'reviews', 'compliance', 'monitoring', 'monitor'],
  compliance: ['compliance', 'conformance', 'conformity', 'conform'],
  calibration: ['calibration', 'calibrated', 'calibrating', 'calibrate'],
  proficiency: ['proficiency', 'competence', 'competency'],
  quality: ['quality', 'qms', 'quality management'],
  management: ['management', 'manage', 'managing', 'managed'],
  training: ['training', 'train', 'trained', 'coaching', 'learning'],
  performance: ['performance', 'kpi', 'key performance', 'analysis', 'monitoring'],
  customer: ['customer', 'client', 'stakeholder'],
  nonconformity: ['nonconformity', 'non-conformity', 'nc', 'deviation', 'noncompliance'],
  feedback: ['feedback', 'survey', 'comments'],
  report: ['report', 'reporting'],
  investigation: ['investigation', 'investigate', 'analysis', 'analyzing'],
  competency: ['competency', 'competence', 'competences']
};

// A list of critical tokens that carry extra weight in the scoring. These words are
// considered particularly important for quality management roles, such as standards and
// certification references. Matches on these tokens contribute double weight to the
// overall score.
const criticalTokens = [
  'iso', '17025', '9001', 'audit', 'auditing', 'compliance', 'quality', 'calibration',
  'proficiency', 'testing', 'management', 'review', 'analysis'
];

// A very simple stemmer to reduce words to their base forms by removing common suffixes.
// This helps match different grammatical forms of the same word (e.g. "audits" vs
// "audit", "managing" vs "manage"). It is intentionally lightweight to avoid
// introducing heavy dependencies. If more accurate stemming is required, consider
// integrating a dedicated stemming library.
function stem(word) {
  return word.replace(/(?:ing|ed|es|s)$/i, '');
}

// ===================
// JD -> Requirements
// ===================

function extractRequirements(jdText) {
  const lines = normalize(jdText)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const requirements = [];

  for (let line of lines) {
    if (line.length < 15) continue;
    line = line.replace(/^[-*]+/, '').trim(); // remove bullet markers
    requirements.push(line);
  }

  // Fallback to sentence split if not enough lines
  if (requirements.length < 3) {
    const sentences = jdText
      .split(/[.;]/)
      .map(s => s.trim())
      .filter(s => s.length > 25);
    return sentences.slice(0, 40);
  }

  return requirements.slice(0, 60);
}

// ===================
// Resume sentence index
// ===================

function buildSentenceIndex(resumeText) {
  const chunks = resumeText
    .split(/[\n.!?]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return chunks.map(text => ({
    text,
    tokens: toSet(tokenize(text))
  }));
}

function findEvidence(requirementTokens, sentenceIndex) {
  let bestSentence = null;
  let bestOverlap = 0;

  for (const s of sentenceIndex) {
    let overlap = 0;
    for (const t of requirementTokens) {
      if (s.tokens.has(t)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSentence = s.text;
    }
  }

  if (bestOverlap >= 1) return bestSentence;
  return null;
}

// ===================
// Requirement evaluation
// ===================

function evaluateRequirement(reqText, resumeTokenSet, sentenceIndex) {
  // Tokenize and stem the requirement text to get base forms
  const rawTokens = tokenize(reqText);
  if (!rawTokens.length) return null;
  const stemTokens = rawTokens.map(t => stem(t));

  // Calculate total weight of the requirement by summing weights for each token. Critical
  // tokens contribute double weight.
  let totalWeight = 0;
  stemTokens.forEach(t => {
    totalWeight += criticalTokens.includes(t) ? 2 : 1;
  });
  if (totalWeight === 0) totalWeight = stemTokens.length;

  // Calculate matched weight by checking if any synonym of a token exists in the resume.
  let matchedWeight = 0;
  stemTokens.forEach(t => {
    // Build list of words to consider for this token: synonyms plus the token itself
    const synList = synonymsMap[t] || [t];
    for (const syn of synList) {
      const baseSyn = stem(syn.toLowerCase());
      if (resumeTokenSet.has(baseSyn)) {
        matchedWeight += criticalTokens.includes(t) ? 2 : 1;
        break;
      }
    }
  });
  const ratio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  let score = Math.round(ratio * 100);
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  // Adjust classification thresholds to be less strict: >=60% Yes, 30–59% Partially, <30% No
  let status;
  if (score >= 60) status = 'Yes';
  else if (score >= 30) status = 'Partially';
  else status = 'No';

  // Use original requirement tokens for evidence lookup to maintain readable sentences
  let evidence = 'Not mentioned in text.';
  const evSentence = findEvidence(rawTokens, sentenceIndex);
  if (evSentence) evidence = evSentence;

  return {
    requirement: reqText,
    status,
    score,
    evidence
  };
}

// ===================
// DOM references
// ===================

const resumeFileInput = document.getElementById('resumeFile');
const resumeTextArea = document.getElementById('resumeText');
const jdTextArea = document.getElementById('jobDescription');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusMessage = document.getElementById('statusMessage');

const resultsSection = document.getElementById('resultsSection');
const overallScoreEl = document.getElementById('overallScore');
const overallClassificationEl = document.getElementById('overallClassification');
const overallExplanationEl = document.getElementById('overallExplanation');
const gapTableBody = document.getElementById('gapTableBody');
const strengthsList = document.getElementById('strengthsList');
const gapsList = document.getElementById('gapsList');

// Premium section elements
const premiumSection = document.getElementById('premiumSection');
const premiumPitch = document.getElementById('premiumPitch');
const interestBtn = document.getElementById('interestBtn');
const paymentSection = document.getElementById('paymentSection');
const receiptInput = document.getElementById('receiptInput');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
const paymentMessage = document.getElementById('paymentMessage');
const premiumTools = document.getElementById('premiumTools');
const coverLetterTextArea = document.getElementById('coverLetterText');
const enhancedResumeTextArea = document.getElementById('enhancedResumeText');
const downloadResumeDocBtn = document.getElementById('downloadResumeDocBtn');
const downloadResumePdfBtn = document.getElementById('downloadResumePdfBtn');
const downloadCoverLetterDocBtn = document.getElementById('downloadCoverLetterDocBtn');
const downloadCoverLetterPdfBtn = document.getElementById('downloadCoverLetterPdfBtn');

// Flag to track payment status for premium features
let premiumPaid = false;

let uploadedResumeText = '';
let lastOverallScore = 0;
let lastEvaluations = [];
let lastClassification = '';

// ===================
// Resume file upload
// ===================

resumeFileInput.addEventListener('change', () => {
  const file = resumeFileInput.files[0];
  uploadedResumeText = '';
  if (!file) return;

  const ext = file.name.toLowerCase().split('.').pop();
  // Handle plain text
  if (file.type === 'text/plain' || ext === 'txt') {
    const reader = new FileReader();
    reader.onload = e => {
      uploadedResumeText = e.target.result || '';
      statusMessage.textContent = 'Resume text loaded from .txt file.';
      statusMessage.classList.remove('error');
    };
    reader.onerror = () => {
      statusMessage.textContent = 'Failed to read resume file.';
      statusMessage.classList.add('error');
    };
    reader.readAsText(file);
    return;
  }
  // Handle PDF using pdf.js
  if (ext === 'pdf' && typeof pdfjsLib !== 'undefined') {
    const reader = new FileReader();
    reader.onload = e => {
      const arrayBuffer = e.target.result;
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      loadingTask.promise.then(async pdf => {
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items.map(item => item.str);
          fullText += strings.join(' ') + ' ';
        }
        uploadedResumeText = fullText;
        statusMessage.textContent = 'Resume text loaded from PDF file.';
        statusMessage.classList.remove('error');
      }).catch(err => {
        console.error(err);
        statusMessage.textContent = 'Failed to parse PDF file.';
        statusMessage.classList.add('error');
      });
    };
    reader.onerror = () => {
      statusMessage.textContent = 'Failed to read PDF file.';
      statusMessage.classList.add('error');
    };
    reader.readAsArrayBuffer(file);
    return;
  }
  // Handle DOC/DOCX using mammoth.js
  if ((ext === 'doc' || ext === 'docx') && typeof mammoth !== 'undefined') {
    const reader = new FileReader();
    reader.onload = e => {
      const arrayBuffer = e.target.result;
      mammoth.extractRawText({ arrayBuffer: arrayBuffer })
        .then(result => {
          uploadedResumeText = result.value || '';
          statusMessage.textContent = 'Resume text loaded from Word document.';
          statusMessage.classList.remove('error');
        })
        .catch(err => {
          console.error(err);
          statusMessage.textContent = 'Failed to parse Word document.';
          statusMessage.classList.add('error');
        });
    };
    reader.onerror = () => {
      statusMessage.textContent = 'Failed to read Word document.';
      statusMessage.classList.add('error');
    };
    reader.readAsArrayBuffer(file);
    return;
  }
  // Unsupported file types
  statusMessage.textContent = 'Unsupported file type. Please upload a PDF, DOC, DOCX or TXT file.';
  statusMessage.classList.add('error');
});

// ===================
// Main analysis
// ===================

analyzeBtn.addEventListener('click', () => {
  const resumeText = (uploadedResumeText || '') + '\n' + (resumeTextArea ? (resumeTextArea.value || '') : '');
  const jdText = jdTextArea.value || '';

  statusMessage.textContent = '';
  statusMessage.classList.remove('error');

  if (resumeText.trim().length < 50) {
    statusMessage.textContent = 'Please provide enough resume text (at least a few lines).';
    statusMessage.classList.add('error');
    return;
  }
  if (jdText.trim().length < 50) {
    statusMessage.textContent = 'Please paste a complete job description.';
    statusMessage.classList.add('error');
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyzing...';

  setTimeout(() => {
    // Run analysis asynchronously to allow for ChatGPT API calls. Ensure the
    // button state is restored after the promise resolves.
    runAnalysis(resumeText, jdText)
      .catch(err => {
        console.error('Error during analysis:', err);
        statusMessage.textContent = 'An error occurred during analysis. Please try again.';
        statusMessage.classList.add('error');
      })
      .finally(() => {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze Alignment';
      });
  }, 50);
});

async function runAnalysis(resumeText, jdText) {
  // Prepare containers for evaluation results
  let evaluations = [];
  let overallScore = 0;
  let classification = '';
  let explanation = '';
  let strengths = [];
  let gaps = [];

  // If an OpenAI API key is provided, attempt to use ChatGPT for evaluation.
  if (OPENAI_API_KEY) {
    try {
      const chatData = await evaluateWithChatGPT(resumeText, jdText);
      if (chatData && typeof chatData === 'object') {
        overallScore = Math.round(chatData.overall_score || 0);
        classification = chatData.classification || '';
        explanation = chatData.summary || '';
        // Build evaluations from itemized results if provided
        if (Array.isArray(chatData.itemized)) {
          evaluations = chatData.itemized.map(item => ({
            requirement: item.requirement || '',
            status: item.status || '',
            score: typeof item.match_percent === 'number' ? Math.round(item.match_percent) : 0,
            evidence: item.justification || item.evidence || 'Not mentioned in text.'
          }));
        }
        if (Array.isArray(chatData.strengths)) strengths = chatData.strengths;
        if (Array.isArray(chatData.gaps)) gaps = chatData.gaps;
      }
    } catch (error) {
      console.error('ChatGPT evaluation error:', error);
    }
  }

  // If ChatGPT evaluation didn't provide itemized results, fall back to local algorithm
  if (!evaluations.length) {
    const requirements = extractRequirements(jdText);
    // Preprocess resume tokens by stemming them. Using stems allows for matching
    // different grammatical forms of the same word and improves synonym lookup.
    const resumeTokens = tokenize(resumeText).map(t => stem(t));
    const resumeTokenSet = toSet(resumeTokens);
    const sentenceIndex = buildSentenceIndex(resumeText);
    for (const req of requirements) {
      const ev = evaluateRequirement(req, resumeTokenSet, sentenceIndex);
      if (ev) evaluations.push(ev);
    }
    if (!evaluations.length) {
      statusMessage.textContent =
        'Could not extract clear requirements from the job description. Please ensure it includes bullet points or sentences.';
      statusMessage.classList.add('error');
      return;
    }
    const avgScore =
      evaluations.reduce((sum, ev) => sum + ev.score, 0) / evaluations.length;
    overallScore = Math.round(avgScore);
    // Classification thresholds for the local algorithm
    if (overallScore > 70) {
      classification = 'Strong Match (>70%)';
      explanation =
        'Candidate demonstrates most critical technical and soft-skill requirements. High interview potential if salary/location fit.';
    } else if (overallScore >= 40) {
      classification = 'Moderate Match (40–70%)';
      explanation =
        'Candidate has core transferable skills but may lack some specific tools or domain experience required by the job description.';
    } else {
      classification = 'Weak Match (<40%)';
      explanation =
        'Candidate is missing several critical requirements or key qualifications. Interview chances may be low unless the role is flexible.';
    }
    // Compute strengths and gaps lists from evaluations
    strengths = evaluations
      .filter(ev => ev.score === 100)
      .map(ev => ev.requirement);
    gaps = evaluations
      .filter(ev => ev.score <= 20)
      .map(ev => ev.requirement);
  }

  // Store results in global variables for use by premium tools
  lastOverallScore = overallScore;
  lastEvaluations = evaluations;
  lastClassification = classification;

  // Update DOM with the results
  overallScoreEl.textContent = overallScore + '%';
  overallClassificationEl.textContent = classification;
  overallExplanationEl.textContent = explanation;

  // Build gap analysis table
  gapTableBody.innerHTML = '';
  evaluations.forEach(ev => {
    const tr = document.createElement('tr');
    const tdReq = document.createElement('td');
    tdReq.textContent = ev.requirement;
    const tdStatus = document.createElement('td');
    tdStatus.textContent = ev.status;
    const tdScore = document.createElement('td');
    tdScore.textContent = (typeof ev.score === 'number' ? ev.score : 0) + '%';
    const tdEvidence = document.createElement('td');
    tdEvidence.textContent = ev.evidence;
    tr.appendChild(tdReq);
    tr.appendChild(tdStatus);
    tr.appendChild(tdScore);
    tr.appendChild(tdEvidence);
    gapTableBody.appendChild(tr);
  });

  // Populate strengths and gaps lists
  strengthsList.innerHTML = '';
  gapsList.innerHTML = '';
  strengths.forEach(req => {
    const li = document.createElement('li');
    li.textContent = req;
    strengthsList.appendChild(li);
  });
  gaps.forEach(req => {
    const li = document.createElement('li');
    li.textContent = req;
    gapsList.appendChild(li);
  });

  resultsSection.classList.remove('hidden');
  premiumSection.classList.remove('hidden');
  // Reset premium subsections: show pitch and hide payment & tools
  if (premiumPitch) premiumPitch.classList.remove('hidden');
  if (paymentSection) paymentSection.classList.add('hidden');
  if (premiumTools) premiumTools.classList.add('hidden');
}

// ===================
// ===================
// Premium tools: generation and payment gating
// ===================

// When user expresses interest in premium tools, show payment section
interestBtn.addEventListener('click', () => {
  premiumPitch.classList.add('hidden');
  paymentSection.classList.remove('hidden');
  paymentMessage.textContent = '';
  paymentMessage.classList.remove('error');
});

// Handle payment confirmation
confirmPaymentBtn.addEventListener('click', () => {
  const receipt = receiptInput.value.trim();
  paymentMessage.textContent = '';
  paymentMessage.classList.remove('error');
  if (!receipt) {
    paymentMessage.textContent = 'Please enter a receipt or payment reference.';
    paymentMessage.classList.add('error');
    return;
  }
  // Simulate successful payment and unlock premium tools
  premiumPaid = true;
  // Generate enhanced resume and cover letter now that payment is confirmed
  generateEnhancedResume();
  generateCoverLetter();
  // Hide payment section and show premium tools
  paymentSection.classList.add('hidden');
  premiumTools.classList.remove('hidden');
  paymentMessage.textContent = 'Payment confirmed (simulation only). Premium tools unlocked.';
  paymentMessage.classList.remove('error');
});

// Generate cover letter based on score and JD
function generateCoverLetter() {
  const jdText = jdTextArea.value || '';
  // Only generate if strong match (>70%)
  if (lastOverallScore <= 70) {
    coverLetterTextArea.value = 'Match score is below 70%. A cover letter will not be generated. Please improve your resume for a better chance.';
    return;
  }
  const truncatedJD = jdText.split('\n').slice(0, 4).join(' ');
  const letter = `\nDear Hiring Manager,\n\nI am writing to express my interest in the position described in your job posting. Based on a structured, evidence-based comparison between my resume and the job description, my overall alignment score is approximately ${lastOverallScore}%.\n\nThis score reflects clear matches on several responsibilities and requirements, as well as a number of gaps which I am confident I can close quickly. In particular, my background demonstrates strong capability in areas such as:\n\n• Delivering on responsibilities that closely mirror your requirements.\n• Applying practical, hands-on skills in real working environments.\n• Collaborating effectively with cross-functional teams and stakeholders.\n\nYour role, which focuses on ${truncatedJD || 'the responsibilities outlined in your advertisement'}, strongly appeals to me because it aligns with my strengths and my long-term career direction. I believe my track record of learning quickly, taking ownership, and improving processes will allow me to contribute meaningful results in this position.\n\nThank you for considering my application. I would welcome the opportunity to further discuss how I can add value to your organisation.\n\nSincerely,\n[Your Name Here]\n`.trim();
  coverLetterTextArea.value = letter;
}

// Generate an enhanced ATS-friendly resume based on unmatched requirements
function generateEnhancedResume() {
  let enhanced = 'ATS-Friendly Resume\n\n';
  let summary = '';
  if (lastOverallScore > 80) {
    summary = 'A highly qualified candidate who meets nearly all job requirements and brings strong technical and soft skills.';
  } else if (lastOverallScore >= 50) {
    summary = 'A candidate with solid core skills and experience, with some gaps that can be quickly closed through training and growth.';
  } else {
    summary = 'A motivated candidate eager to learn and develop, bringing foundational skills and a passion for growth.';
  }
  enhanced += 'Professional Summary:\n' + summary + '\n\n';
  const original = uploadedResumeText.trim();
  if (original) {
    enhanced += 'Original Resume Content:\n' + original + '\n\n';
  }
  const additions = [];
  lastEvaluations.forEach(ev => {
    if (ev.status !== 'Yes') {
      additions.push(`• ${ev.requirement}`);
    }
  });
  if (additions.length > 0) {
    enhanced += 'Additional Skills & Qualifications (to close gaps):\n' + additions.join('\n') + '\n';
  } else {
    enhanced += 'Additional Skills & Qualifications:\n• Your resume already covers all critical job requirements. Continue to highlight your achievements using concise bullet points.\n';
  }
  enhancedResumeTextArea.value = enhanced.trim();
}

// Gating: intercept copy or cut events on premium textareas
[enhancedResumeTextArea, coverLetterTextArea].forEach(textarea => {
  textarea.addEventListener('copy', evt => {
    if (!premiumPaid) {
      evt.preventDefault();
      paymentSection.classList.remove('hidden');
      paymentMessage.textContent = 'Please complete payment to copy or download the generated content.';
      paymentMessage.classList.add('error');
    }
  });
  textarea.addEventListener('cut', evt => {
    if (!premiumPaid) {
      evt.preventDefault();
      paymentSection.classList.remove('hidden');
      paymentMessage.textContent = 'Please complete payment to copy or download the generated content.';
      paymentMessage.classList.add('error');
    }
  });
});

// Helper functions to save text as DOCX and PDF using external libs
async function saveAsDocx(text, filename) {
  const { Document, Packer, Paragraph } = docx;
  const paragraphs = text.split('\n').map(line => new Paragraph(line));
  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function saveAsPdf(text, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const lines = doc.splitTextToSize(text, 180);
  doc.text(lines, 15, 20);
  doc.save(filename);
}

// Download handlers for enhanced resume and cover letter (DOCX & PDF) with payment gating
downloadResumeDocBtn.addEventListener('click', () => {
  if (!premiumPaid) {
    paymentSection.classList.remove('hidden');
    paymentMessage.textContent = 'Please complete payment to download the generated content.';
    paymentMessage.classList.add('error');
    return;
  }
  const text = enhancedResumeTextArea.value || '';
  saveAsDocx(text, 'enhanced-resume.docx');
});

downloadResumePdfBtn.addEventListener('click', () => {
  if (!premiumPaid) {
    paymentSection.classList.remove('hidden');
    paymentMessage.textContent = 'Please complete payment to download the generated content.';
    paymentMessage.classList.add('error');
    return;
  }
  const text = enhancedResumeTextArea.value || '';
  saveAsPdf(text, 'enhanced-resume.pdf');
});

downloadCoverLetterDocBtn.addEventListener('click', () => {
  if (!premiumPaid) {
    paymentSection.classList.remove('hidden');
    paymentMessage.textContent = 'Please complete payment to download the generated content.';
    paymentMessage.classList.add('error');
    return;
  }
  const text = coverLetterTextArea.value || '';
  saveAsDocx(text, 'cover-letter.docx');
});

downloadCoverLetterPdfBtn.addEventListener('click', () => {
  if (!premiumPaid) {
    paymentSection.classList.remove('hidden');
    paymentMessage.textContent = 'Please complete payment to download the generated content.';
    paymentMessage.classList.add('error');
    return;
  }
  const text = coverLetterTextArea.value || '';
  saveAsPdf(text, 'cover-letter.pdf');
});