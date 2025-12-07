/**
 * Membership Application Form
 * Client-side form handling for membership applications
 */

/**
 * Get the API base URL from the meta tag
 */
function getApiBase() {
  const baseUrl = document.querySelector('meta[name="base-url"]')?.content || '';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Make an API request
 */
async function api(endpoint, options = {}) {
  const API_BASE = getApiBase();
  const response = await fetch(`${API_BASE}/api${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/**
 * Collect form data
 */
function collectFormData(form) {
  const formData = new FormData(form);
  return {
    firstName: formData.get('firstName')?.toString().trim() || '',
    lastName: formData.get('lastName')?.toString().trim() || '',
    email: formData.get('email')?.toString().trim() || '',
    studentId: formData.get('studentId')?.toString().trim() || '',
    enrollmentTrack: formData.get('enrollmentTrack')?.toString() || '',
    phone: formData.get('phone')?.toString().trim() || '',
    telegram: formData.get('telegram')?.toString().trim() || '',
    discord: formData.get('discord')?.toString().trim() || ''
  };
}

/**
 * Validate email format
 * Uses a simpler regex to avoid ReDoS vulnerability
 */
function isValidEmail(email) {
  // Simple check: contains @ with text before and after, and has a dot after @
  if (!email || email.length > 254) return false;
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex === email.length - 1) return false;
  const domain = email.slice(atIndex + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/**
 * Validate form data
 */
function validateForm(data) {
  const errors = [];

  if (!data.firstName) errors.push('Le prénom est requis');
  if (!data.lastName) errors.push('Le nom est requis');
  if (!data.email) errors.push("L'email est requis");
  else if (!isValidEmail(data.email)) errors.push("L'email est invalide");
  if (!data.enrollmentTrack) errors.push('Le cursus est requis');

  // At least one contact method required
  if (!data.phone && !data.telegram && !data.discord) {
    errors.push('Au moins un moyen de contact est requis (téléphone, Telegram ou Discord)');
  }

  return errors;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show form errors
 */
function showErrors(errors, errorsDiv) {
  const listItems = errors.map(e => `<li>${escapeHtml(e)}</li>`).join('');
  errorsDiv.innerHTML = `<ul>${listItems}</ul>`;
  errorsDiv.classList.remove('hidden');
  errorsDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Hide form errors
 */
function hideErrors(errorsDiv) {
  errorsDiv.classList.add('hidden');
}

/**
 * Set loading state for submit button
 */
function setLoading(submitBtn, loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Envoi en cours...' : 'Envoyer ma demande';
}

/**
 * Handle form submission
 */
async function handleSubmit(e, elements) {
  e.preventDefault();

  const data = collectFormData(elements.form);
  const errors = validateForm(data);

  if (errors.length > 0) {
    showErrors(errors, elements.errorsDiv);
    return;
  }

  hideErrors(elements.errorsDiv);
  setLoading(elements.submitBtn, true);

  try {
    const result = await api('/apply', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    elements.successMessage.textContent = result.message || 'Votre demande d\'adhésion a bien été enregistrée.';
    elements.successModal.classList.remove('hidden');

  } catch (error) {
    showErrors([error.message], elements.errorsDiv);
  } finally {
    setLoading(elements.submitBtn, false);
  }
}

/**
 * Initialize the membership form
 */
function initMembershipForm() {
  const elements = {
    form: document.getElementById('membership-form'),
    errorsDiv: document.getElementById('form-errors'),
    submitBtn: document.getElementById('submit-btn'),
    successModal: document.getElementById('success-modal'),
    successMessage: document.getElementById('success-message')
  };

  if (!elements.form) {
    console.error('Membership form not found');
    return;
  }

  // Form submit handler
  elements.form.addEventListener('submit', (e) => handleSubmit(e, elements));

  // Close modal on backdrop click or Escape
  elements.successModal.addEventListener('click', (e) => {
    if (e.target === elements.successModal) {
      location.reload();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.successModal.classList.contains('hidden')) {
      location.reload();
    }
  });
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMembershipForm);
} else {
  initMembershipForm();
}
