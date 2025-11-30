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
  const tokens = tokenize(reqText);
  if (!tokens.length) return null;

  let overlap = 0;
  for (const t of tokens) {
    if (resumeTokenSet.has(t)) overlap++;
  }

  const ratio = tokens.length ? overlap / tokens.length : 0;
  let score = Math.round(ratio * 100);
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  // Framework: YES / PARTIALLY / NO
  let status;
  if (score >= 80) status = 'Yes';          // 80–100%
  else if (score >= 30) status = 'Partially'; // 30–70%
  else status = 'No';                       // 0–20%

  let evidence = 'Not mentioned in text.';
  const evSentence = findEvidence(tokens, sentenceIndex);
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
const startPremiumBtn = document.getElementById('startPremiumBtn');
const paymentSection = document.getElementById('paymentSection');
const receiptInput = document.getElementById('receiptInput');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
const paymentMessage = document.getElementById('paymentMessage');
const premiumTools = document.getElementById('premiumTools');
const coverLetterTextArea = document.getElementById('coverLetterText');

// Payment method buttons
const payCardBtn = document.getElementById('payCardBtn');
const payPaypalBtn = document.getElementById('payPaypalBtn');

// Enhanced resume and multi-format download elements
const enhancedResumeTextArea = document.getElementById('enhancedResumeText');
const downloadResumeDocBtn = document.getElementById('downloadResumeDocBtn');
const downloadResumePdfBtn = document.getElementById('downloadResumePdfBtn');
const downloadCoverLetterDocBtn = document.getElementById('downloadCoverLetterDocBtn');
const downloadCoverLetterPdfBtn = document.getElementById('downloadCoverLetterPdfBtn');

// Flag to track payment status for premium features
let premiumPaid = false;

// Store the most recent enhanced resume content for export
let enhancedResumeContent = '';

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
    runAnalysis(resumeText, jdText);
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze Alignment';
  }, 50);
});

function runAnalysis(resumeText, jdText) {
  const requirements = extractRequirements(jdText);
  const resumeTokens = tokenize(resumeText);
  const resumeTokenSet = toSet(resumeTokens);
  const sentenceIndex = buildSentenceIndex(resumeText);

  const evaluations = [];

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
  const overallScore = Math.round(avgScore);
  lastOverallScore = overallScore;

  // Overall classification
  let classification;
  let explanation;

  if (overallScore > 80) {
    classification = 'Strong Match (>80%)';
    explanation =
      'Candidate explicitly demonstrates most critical technical and soft-skill requirements. High interview potential if salary/location fit.';
  } else if (overallScore >= 50) {
    classification = 'Moderate Match (50–79%)';
    explanation =
      'Candidate has core transferable skills but lacks some specific tools or domain experience required by the JD.';
  } else {
    classification = 'Weak Match (<50%)';
    explanation =
      'Candidate is missing several critical hands-on requirements or key qualifications. Interview chance may be low unless the role is flexible.';
  }

  overallScoreEl.textContent = overallScore + '%';
  overallClassificationEl.textContent = classification;
  overallExplanationEl.textContent = explanation;

  // Build table
  gapTableBody.innerHTML = '';
  evaluations.forEach(ev => {
    const tr = document.createElement('tr');

    const tdReq = document.createElement('td');
    tdReq.textContent = ev.requirement;

    const tdStatus = document.createElement('td');
    tdStatus.textContent = ev.status;

    const tdScore = document.createElement('td');
    tdScore.textContent = ev.score + '%';

    const tdEvidence = document.createElement('td');
    tdEvidence.textContent = ev.evidence;

    tr.appendChild(tdReq);
    tr.appendChild(tdStatus);
    tr.appendChild(tdScore);
    tr.appendChild(tdEvidence);

    gapTableBody.appendChild(tr);
  });

  // Strengths & gaps lists
  strengthsList.innerHTML = '';
  gapsList.innerHTML = '';

  evaluations
    .filter(ev => ev.score === 100)
    .forEach(ev => {
      const li = document.createElement('li');
      li.textContent = ev.requirement;
      strengthsList.appendChild(li);
    });

  evaluations
    .filter(ev => ev.score <= 20)
    .forEach(ev => {
      const li = document.createElement('li');
      li.textContent = ev.requirement;
      gapsList.appendChild(li);
    });

  resultsSection.classList.remove('hidden');
  // Show premium section when analysis is done
  premiumSection.classList.remove('hidden');

  // Store evaluations and classification for premium tools
  lastEvaluations = evaluations;
  lastClassification = classification;
}

// ===================
// ===================
// Premium tools: generation and payment gating
// ===================

// When user clicks to generate premium content
startPremiumBtn.addEventListener('click', () => {
  // Generate the enhanced resume and cover letter
  generateEnhancedResume();
  generateCoverLetter();
  // Show results area
  premiumTools.classList.remove('hidden');
  // Hide payment section initially until user attempts to copy/download
  paymentSection.classList.add('hidden');
  paymentMessage.textContent = '';
  paymentMessage.classList.remove('error');
});

// Handle payment confirmation
confirmPaymentBtn.addEventListener('click', () => {
  const receipt = receiptInput.value.trim();
  paymentMessage.textContent = '';
  paymentMessage.classList.remove('error');
  if (!receipt) {
    paymentMessage.textContent = 'Please enter a receipt / payment reference.';
    paymentMessage.classList.add('error');
    return;
  }
  // Unlock premium features
  premiumPaid = true;
  paymentMessage.textContent = 'Payment confirmed (simulation only). You may now copy and download.';
  paymentMessage.classList.remove('error');
});

// ========= Document export helpers =========
// Create and download a DOCX file from plain text
async function saveAsDocx(content, filename) {
  // Ensure docx library is available
  if (typeof docx === 'undefined') {
    console.error('docx library not loaded');
    return;
  }
  const doc = new docx.Document();
  const paragraphs = content.split('\n').map(line => new docx.Paragraph(line));
  doc.addSection({ children: paragraphs });
  const blob = await docx.Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Create and download a PDF file from plain text
function saveAsPdf(content, filename) {
  if (typeof window.jspdf === 'undefined') {
    console.error('jsPDF library not loaded');
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdfDoc = new jsPDF();
  // Split long text into lines that fit within page width (approx 180 units)
  const lines = pdfDoc.splitTextToSize(content, 180);
  let y = 10;
  lines.forEach(line => {
    // If near bottom of page, add a new page
    if (y > 280) {
      pdfDoc.addPage();
      y = 10;
    }
    pdfDoc.text(line, 10, y);
    y += 8;
  });
  pdfDoc.save(filename);
}

// ========= Download buttons =========
// Resume DOC download
if (downloadResumeDocBtn) {
  downloadResumeDocBtn.addEventListener('click', async () => {
    if (!premiumPaid) {
      paymentSection.classList.remove('hidden');
      paymentMessage.textContent = 'Please complete payment to download the generated content.';
      paymentMessage.classList.add('error');
      return;
    }
    const content = enhancedResumeTextArea.value || '';
    await saveAsDocx(content, 'enhanced-resume.docx');
  });
}

// Resume PDF download
if (downloadResumePdfBtn) {
  downloadResumePdfBtn.addEventListener('click', () => {
    if (!premiumPaid) {
      paymentSection.classList.remove('hidden');
      paymentMessage.textContent = 'Please complete payment to download the generated content.';
      paymentMessage.classList.add('error');
      return;
    }
    const content = enhancedResumeTextArea.value || '';
    saveAsPdf(content, 'enhanced-resume.pdf');
  });
}

// Cover letter DOC download
if (downloadCoverLetterDocBtn) {
  downloadCoverLetterDocBtn.addEventListener('click', async () => {
    if (!premiumPaid) {
      paymentSection.classList.remove('hidden');
      paymentMessage.textContent = 'Please complete payment to download the generated content.';
      paymentMessage.classList.add('error');
      return;
    }
    const content = coverLetterTextArea.value || '';
    await saveAsDocx(content, 'cover-letter.docx');
  });
}

// Cover letter PDF download
if (downloadCoverLetterPdfBtn) {
  downloadCoverLetterPdfBtn.addEventListener('click', () => {
    if (!premiumPaid) {
      paymentSection.classList.remove('hidden');
      paymentMessage.textContent = 'Please complete payment to download the generated content.';
      paymentMessage.classList.add('error');
      return;
    }
    const content = coverLetterTextArea.value || '';
    saveAsPdf(content, 'cover-letter.pdf');
  });
}

// Open payment pages when user clicks payment method buttons
if (payCardBtn) {
  payCardBtn.addEventListener('click', () => {
    // In production, redirect to card/debit payment gateway (e.g., Stripe). Here we open a placeholder site.
    window.open('https://www.paypal.com', '_blank');
  });
}

if (payPaypalBtn) {
  payPaypalBtn.addEventListener('click', () => {
    // Redirect to PayPal or other third-party payment provider. Using PayPal as placeholder.
    window.open('https://www.paypal.com', '_blank');
  });
}

// Generate cover letter based on score and JD
function generateCoverLetter() {
  const jdText = jdTextArea.value || '';
  // Only generate if strong match (>80%)
  if (lastOverallScore <= 80) {
    coverLetterTextArea.value = 'Skor padanan kurang 80%. Surat iringan tidak dijana. Kemaskini resume anda untuk peluang yang lebih baik.';
    return;
  }
  const truncatedJD = jdText.split('\n').slice(0, 4).join(' ');
  const letter = `\nDear Hiring Manager,\n\nI am writing to express my interest in the position described in your job posting. Based on a structured, evidence-based comparison between my resume and the job description, my overall alignment score is approximately ${lastOverallScore}%.\n\nThis score reflects clear matches on several responsibilities and requirements, as well as a number of gaps which I am confident I can close quickly. In particular, my background demonstrates strong capability in areas such as:\n\n• Delivering on responsibilities that closely mirror your requirements.\n• Applying practical, hands-on skills in real working environments.\n• Collaborating effectively with cross-functional teams and stakeholders.\n\nYour role, which focuses on ${truncatedJD || 'the responsibilities outlined in your advertisement'}, strongly appeals to me because it aligns with my strengths and my long-term career direction. I believe my track record of learning quickly, taking ownership, and improving processes will allow me to contribute meaningful results in this position.\n\nThank you for considering my application. I would welcome the opportunity to further discuss how I can add value to your organisation.\n\nSincerely,\n[Your Name Here]\n`.trim();
  coverLetterTextArea.value = letter;
}

// Generate resume enhancement suggestions based on unmatched requirements

// Generate an enhanced resume by appending missing skills/qualifications to the original resume
function generateEnhancedResume() {
  const resumeText = (uploadedResumeText || '') + '\n' + (resumeTextArea ? (resumeTextArea.value || '') : '');
  const missing = [];
  lastEvaluations.forEach(ev => {
    if (ev.status !== 'Yes') {
      missing.push(`Experienced in ${ev.requirement}.`);
    }
  });
  let additional = '';
  if (missing.length > 0) {
    additional = '\n\nAdditional Skills & Qualifications:\n' + missing.map(item => '- ' + item).join('\n');
  }
  enhancedResumeContent = resumeText + additional;
  enhancedResumeTextArea.value = enhancedResumeContent;
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

// Download handlers for enhancer and cover letter with payment gating
