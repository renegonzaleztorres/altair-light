
/*
 * Forms extension: browser script, served at /forms/client.js
 *
 * Progressive enhancement for forms posted to the forms extension. Load it on
 * pages that have a form:
 *
 *   <script src="/forms/client.js" defer></script>
 *
 * It applies to every <form data-altair-form>; other forms are left alone.
 * Without this script the form still works: the browser posts it and the
 * extension redirects back with ?status=… (and &fields=… for invalid fields).
 * It comes from Altair-Light, so take updates from upstream rather than
 * editing it; change the wording on the page by copying it into your own
 * scripts instead.
 *
 * Markup it uses, all optional:
 *   [data-form-status]   message area; gets data-state="success" or "error"
 *   [data-error-for=x]   the error line for field x
 *   [data-turnstile]     where the Turnstile widget renders, if the form uses it
 */

(() => {

  const STATUS_TEXT = {
    sent: 'Thank you. Your message was sent.',
    invalid: 'Please correct the fields marked below.',
    challenge: 'The spam check did not pass. Please try again.',
    delivery: 'Your message could not be sent. Please try again later.',
    forbidden: 'This form can only be sent from this site. Please reload the page and try again.',
    too_large: 'Your message is too long.',
    network: 'The server could not be reached. Please check your connection and try again.',
    error: 'Something went wrong. Please try again.'
  };
  const FIELD_TEXT = {
    required: 'This field is required.',
    too_short: 'This is too short.',
    too_long: 'This is too long.',
    invalid: 'Please check this value.'
  };

  const forms = document.querySelectorAll('form[data-altair-form]');
  if (forms.length === 0) return;

  // showStatus : the form's message area; reference is shown so a visitor can quote it
  const showStatus = (form, status, reference) => {
    const box = form.querySelector('[data-form-status]');
    if (!box) return;
    const text = STATUS_TEXT[status] || STATUS_TEXT.error;
    box.textContent = reference ? text + ' (Reference: ' + reference + ')' : text;
    box.dataset.state = status === 'sent' ? 'success' : 'error';
    box.classList.remove('hidden');
  };

  const clearErrors = (form) => {
    form.querySelectorAll('[data-error-for]').forEach((line) => { line.textContent = ''; line.classList.add('hidden'); });
    form.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
    const box = form.querySelector('[data-form-status]');
    if (box) box.classList.add('hidden');
  };

  // showErrors : fields is { name: code } from JSON, or [name, …] from a redirect
  const showErrors = (form, fields) => {
    const entries = Array.isArray(fields) ? fields.map((name) => [name, 'invalid']) : Object.entries(fields || {});
    entries.forEach(([name, code], index) => {
      const input = form.elements.namedItem(name);
      const line = form.querySelector('[data-error-for="' + CSS.escape(name) + '"]');
      if (input && input.setAttribute) input.setAttribute('aria-invalid', 'true');
      if (line) { line.textContent = FIELD_TEXT[code] || FIELD_TEXT.invalid; line.classList.remove('hidden'); }
      if (index === 0 && input && input.focus) input.focus();
    });
  };

  // loadTurnstile : the Turnstile script, once per page, in explicit-render mode
  let turnstileReady;
  const loadTurnstile = (src) => {
    turnstileReady = turnstileReady || new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src + '?render=explicit';
      script.async = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return turnstileReady;
  };

  // A redirect back from a plain post: ?status=invalid&fields=email,message
  const params = new URLSearchParams(window.location.search);
  if (params.has('status') && forms.length === 1) {
    showStatus(forms[0], params.get('status'), params.get('reference'));
    if (params.get('fields')) showErrors(forms[0], params.get('fields').split(','));
  }

  forms.forEach((form) => {

    let widget;
    const container = form.querySelector('[data-turnstile]');

    // The extension describes the form at its action URL (GET); it says whether Turnstile is on
    fetch(form.action, { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((description) => {
        if (!description || !description.turnstile || !container) return;
        return loadTurnstile(description.turnstile.script).then((turnstile) => {
          widget = turnstile.render(container, { sitekey: description.turnstile.siteKey, action: description.turnstile.action });
        });
      })
      .catch(() => {});

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors(form);
      const button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      try {
        const response = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
        let result;
        try {
          result = await response.json();
        } catch {
          result = { ok: false, error: response.status === 403 ? 'forbidden' : response.status === 413 ? 'too_large' : 'error' };
        }
        if (result.ok) {
          form.reset();
          showStatus(form, 'sent');
        } else {
          showStatus(form, result.error, result.reference);
          showErrors(form, result.fields);
        }
      } catch {
        showStatus(form, 'network');
      } finally {
        if (button) button.disabled = false;
        if (widget !== undefined && window.turnstile) window.turnstile.reset(widget); // tokens are single use
      }
    });

  });

})();
