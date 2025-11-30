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
const downloadCoverLetterBtn = document.getElementById('downloadCoverLetterBtn');
const resumeSummaryTextArea = document.getElementById('resumeSummaryText');
const downloadSummaryBtn = document.getElementById('downloadSummaryBtn');
const bulletPointsTextArea = document.getElementById('bulletPointsText');
const downloadBulletsBtn = document.getElementById('downloadBulletsBtn');
const resumeAuditTextArea = document.getElementById('resumeAuditText');
const downloadAuditBtn = document.getElementById('downloadAuditBtn');

// Job tracker elements
const jobTrackerSection = document.getElementById('jobTrackerSection');
const jobForm = document.getElementById('jobForm');
const jobCompanyInput = document.getElementById('jobCompany');
const jobPositionInput = document.getElementById('jobPosition');
const jobDateInput = document.getElementById('jobDate');
const jobStatusSelect = document.getElementById('jobStatus');
const jobNotesInput = document.getElementById('jobNotes');
const addJobBtn = document.getElementById('addJobBtn');
const jobTableBody = document.querySelector('#jobTable tbody');

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

  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
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
  } else {
    statusMessage.textContent =
      'This demo can only auto-read .txt. For PDF/DOCX, please copy & paste the resume text.';
    statusMessage.classList.add('error');
  }
});

// ===================
// Main analysis
// ===================

analyzeBtn.addEventListener('click', () => {
  const resumeText = (uploadedResumeText || '') + '\n' + (resumeTextArea.value || '');
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
  // Show premium and job tracker sections when analysis is done
  premiumSection.classList.remove('hidden');
  jobTrackerSection.classList.remove('hidden');

  // Store evaluations and classification for premium tools
  lastEvaluations = evaluations;
  lastClassification = classification;
}

// ===================
// Premium tools: payment and generation (cover letter, summary, bullets)
// ===================

startPremiumBtn.addEventListener('click', () => {
  paymentSection.classList.remove('hidden');
  paymentMessage.textContent = '';
  paymentMessage.classList.remove('error');
});

confirmPaymentBtn.addEventListener('click', () => {
  const receipt = receiptInput.value.trim();
  paymentMessage.textContent = '';
  paymentMessage.classList.remove('error');

  if (!receipt) {
    paymentMessage.textContent = 'Please enter a receipt / payment reference.';
    paymentMessage.classList.add('error');
    return;
  }

  // Generate all premium artifacts
  generateCoverLetter();
  generateResumeSummary();
  generateBulletPoints();
  generateResumeAudit();
  paymentMessage.textContent =
    'Payment confirmed (simulation only). Premium tools generated.';
  premiumTools.classList.remove('hidden');
});

function generateCoverLetter() {
  const jdText = jdTextArea.value || '';
  const truncatedJD = jdText.split('\n').slice(0, 4).join(' ');

  const letter = `\nDear Hiring Manager,\n\nI am writing to express my interest in the position described in your job posting. Based on a structured, evidence-based comparison between my resume and the job description, my overall alignment score is approximately ${lastOverallScore}%.\n\nThis score reflects clear matches on several responsibilities and requirements, as well as a number of gaps which I am confident I can close quickly. In particular, my background demonstrates strong capability in areas such as:\n\n• Delivering on responsibilities that closely mirror your requirements.\n• Applying practical, hands-on skills in real working environments.\n• Collaborating effectively with cross-functional teams and stakeholders.\n\nYour role, which focuses on ${truncatedJD || 'the responsibilities outlined in your advertisement'}, strongly appeals to me because it aligns with my strengths and my long-term career direction. I believe my track record of learning quickly, taking ownership, and improving processes will allow me to contribute meaningful results in this position.\n\nThank you for considering my application. I would welcome the opportunity to further discuss how I can add value to your organisation.\n\nSincerely,\n[Your Name Here]\n`.trim();

  coverLetterTextArea.value = letter;
}

function generateResumeSummary() {
  // Create a simple summary highlighting classification and strengths
  const strengths = lastEvaluations.filter(ev => ev.score === 100).map(ev => ev.requirement);
  const topStrengths = strengths.slice(0, 3).join('; ');
  const summary = `Overall, this resume is classified as ${lastClassification}. Key strengths include: ${topStrengths || '—'}. With an alignment score of ${lastOverallScore}%, the resume demonstrates a solid fit for the role while indicating areas for growth.`;
  resumeSummaryTextArea.value = summary;
}

function generateBulletPoints() {
  // Generate bullet points based on top matched requirements and partially matched ones
  const bullets = [];
  const matched = lastEvaluations.filter(ev => ev.status === 'Yes');
  const partial = lastEvaluations.filter(ev => ev.status === 'Partially');
  matched.slice(0, 3).forEach(ev => {
    bullets.push(`• Experienced in ${ev.requirement}.`);
  });
  partial.slice(0, 2).forEach(ev => {
    bullets.push(`• Developing skills in ${ev.requirement}.`);
  });
  if (bullets.length === 0) {
    bullets.push('• Highlight your relevant achievements and align them with the job requirements.');
  }
  bulletPointsTextArea.value = bullets.join('\n');
}

// Generate resume audit and improvement suggestions
function generateResumeAudit() {
  const resumeText = (uploadedResumeText || '') + '\n' + (resumeTextArea.value || '');
  const lines = resumeText.split(/\n/).map(l => l.trim()).filter(Boolean);
  const suggestions = [];
  const strongVerbs = new Set([
    'managed','led','developed','created','implemented','improved','designed','analyzed','delivered','collaborated','organized','supervised','increased','achieved','generated','reduced','built','optimized','streamlined','executed'
  ]);

  lines.forEach(line => {
    const lower = line.toLowerCase();
    // Check for first-person pronouns in bullet or sentences
    if (/\b(i|me|my|mine)\b/.test(lower)) {
      suggestions.push('Avoid first-person pronouns (e.g. "I", "me", "my"). Focus on your achievements and responsibilities.');
    }
    // Check for gendered pronouns for inclusivity
    if (/\b(he|she|his|her)\b/.test(lower)) {
      suggestions.push('Use gender-neutral language (e.g. "they") when referring to people or teams.');
    }
    // Bullet checks
    if (/^[\-•]/.test(line)) {
      // extract first significant word after bullet
      const words = line.replace(/^[\-•]\s*/, '').split(/\s+/);
      const firstWord = words[0] ? words[0].replace(/[^a-zA-Z]/g, '').toLowerCase() : '';
      if (firstWord && !strongVerbs.has(firstWord)) {
        suggestions.push(`Start bullet "${line.slice(0, 40)}..." with a strong action verb to make it more impactful.`);
      }
      // quantification check: digits
      if (!/\d/.test(line)) {
        suggestions.push(`Add quantifiable results to bullet "${line.slice(0, 40)}..." (e.g., numbers, percentages).`);
      }
    }
  });
  if (suggestions.length === 0) {
    suggestions.push('No major language or formatting issues detected. Resume appears clear and professional.');
  }
  // Remove duplicate suggestions
  const uniqueSuggestions = Array.from(new Set(suggestions));
  resumeAuditTextArea.value = uniqueSuggestions.map(s => `• ${s}`).join('\n');
}

// Download handlers for premium texts
downloadCoverLetterBtn.addEventListener('click', () => {
  const text = coverLetterTextArea.value || '';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cover-letter.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

downloadSummaryBtn.addEventListener('click', () => {
  const text = resumeSummaryTextArea.value || '';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resume-summary.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

downloadBulletsBtn.addEventListener('click', () => {
  const text = bulletPointsTextArea.value || '';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'optimized-bullets.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Download audit report
downloadAuditBtn.addEventListener('click', () => {
  const text = resumeAuditTextArea.value || '';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'resume-audit.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ===================
// Job Tracker logic
// ===================

let jobs = [];

function loadJobs() {
  try {
    const data = localStorage.getItem('jobsData');
    jobs = data ? JSON.parse(data) : [];
  } catch (err) {
    jobs = [];
  }
  renderJobs();
}

function saveJobs() {
  localStorage.setItem('jobsData', JSON.stringify(jobs));
}

function renderJobs() {
  jobTableBody.innerHTML = '';
  jobs.forEach((job, index) => {
    const tr = document.createElement('tr');
    // Company
    const tdCompany = document.createElement('td');
    tdCompany.textContent = job.company;
    // Position
    const tdPosition = document.createElement('td');
    tdPosition.textContent = job.position;
    // Date
    const tdDate = document.createElement('td');
    tdDate.textContent = job.date;
    // Status with select
    const tdStatus = document.createElement('td');
    const select = document.createElement('select');
    ['Applied','Interviewing','Offer','Rejected'].forEach(optVal => {
      const opt = document.createElement('option');
      opt.value = optVal;
      opt.textContent = optVal;
      if (job.status === optVal) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      jobs[index].status = select.value;
      saveJobs();
    });
    tdStatus.appendChild(select);
    // Notes
    const tdNotes = document.createElement('td');
    tdNotes.textContent = job.notes || '';
    // Actions
    const tdActions = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'btn secondary';
    delBtn.addEventListener('click', () => {
      jobs.splice(index, 1);
      saveJobs();
      renderJobs();
    });
    tdActions.appendChild(delBtn);

    tr.appendChild(tdCompany);
    tr.appendChild(tdPosition);
    tr.appendChild(tdDate);
    tr.appendChild(tdStatus);
    tr.appendChild(tdNotes);
    tr.appendChild(tdActions);
    jobTableBody.appendChild(tr);
  });
}

addJobBtn.addEventListener('click', () => {
  const company = jobCompanyInput.value.trim();
  const position = jobPositionInput.value.trim();
  const date = jobDateInput.value;
  const status = jobStatusSelect.value;
  const notes = jobNotesInput.value.trim();
  if (!company || !position) {
    alert('Please enter company and position');
    return;
  }
  jobs.push({ company, position, date, status, notes });
  saveJobs();
  renderJobs();
  // Clear form
  jobCompanyInput.value = '';
  jobPositionInput.value = '';
  jobDateInput.value = '';
  jobStatusSelect.value = 'Applied';
  jobNotesInput.value = '';
});

// Load jobs on initial page load
window.addEventListener('DOMContentLoaded', () => {
  loadJobs();
});