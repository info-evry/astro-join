/**
 * Membership Application Form
 * Client-side form handling for membership applications
 *
 * Requests go through astro-design's `createPublicClient`: every failure is an
 * `ApiError` with the server's French message and `code`, even when a proxy
 * answers with an HTML error page.
 */
import { createPublicClient } from '@info-evry/astro-design/scripts/public-client';
import { escapeHtml } from '@info-evry/astro-design/scripts/dom';
import { isValidEmail } from 'astro-core/validation';
import { fillTrackList } from './datalist.js';

const MSG_CLOSED = "Les adhésions sont actuellement fermées. Revenez plus tard ou contactez l'association.";
const SUBMIT_LABEL = 'Envoyer ma demande';

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
 * Set loading state for submit button (a closed form keeps it disabled)
 */
function setLoading(submitBtn, loading) {
  submitBtn.disabled = loading || submitBtn.dataset.locked === 'true';
  submitBtn.textContent = loading ? 'Envoi en cours...' : SUBMIT_LABEL;
}

/**
 * Disable the whole form and explain why (membership closed by an admin).
 */
function closeForm(elements, message = MSG_CLOSED) {
  elements.submitBtn.dataset.locked = 'true';
  for (const control of elements.form.elements) control.disabled = true;
  hideErrors(elements.errorsDiv);
  if (elements.closedNotice) {
    elements.closedNotice.textContent = message;
    elements.closedNotice.classList.remove('hidden');
  }
}

/**
 * Apply the public configuration: the configured tracks, and a closed form
 * when membership is closed. A failure here leaves the form usable: the
 * server enforces the same rules when the form is submitted.
 */
async function applyConfig(client, elements) {
  try {
    const { config } = await client.get('/config');
    fillTrackList(document.getElementById('cursus-list'), config?.enrollmentTracks);
    if (config?.membershipOpen === false) closeForm(elements);
  } catch (error) {
    console.error('Could not load the membership configuration:', error);
  }
}

/**
 * Handle form submission
 */
async function handleSubmit(e, elements, client) {
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
    const result = await client.post('/apply', data);

    elements.successMessage.textContent = result?.message || 'Votre demande d\'adhésion a bien été enregistrée.';
    elements.successModal.classList.remove('hidden');

  } catch (error) {
    if (error.code === 'membership_closed') {
      closeForm(elements, error.message);
    } else {
      showErrors([error.message], elements.errorsDiv);
    }
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
    closedNotice: document.getElementById('membership-closed'),
    submitBtn: document.getElementById('submit-btn'),
    successModal: document.getElementById('success-modal'),
    successMessage: document.getElementById('success-message')
  };

  if (!elements.form) {
    console.error('Membership form not found');
    return;
  }

  const client = createPublicClient();

  // Form submit handler
  elements.form.addEventListener('submit', (e) => handleSubmit(e, elements, client));

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

  return applyConfig(client, elements);
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMembershipForm);
} else {
  initMembershipForm();
}
