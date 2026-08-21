// Contact page form (#contact-form) — POSTs to /api/v1/messages. Real
// success/error state from the actual response, unlike the optimistic-always
// -resolves pattern shared.js uses for rating feedback: here a silent failure
// would mean the visitor believes they reached support when nobody did.
(function () {
  'use strict';

  function init() {
    var form = document.getElementById('contact-form');
    if (!form) return;

    var titleEl = document.getElementById('contact-title');
    var bodyEl = document.getElementById('contact-body');
    var emailEl = document.getElementById('contact-email');
    var websiteEl = document.getElementById('contact-website'); // honeypot
    var submitBtn = document.getElementById('contact-submit');
    var statusEl = document.getElementById('contact-status');

    function setStatus(text, type) {
      statusEl.textContent = text;
      statusEl.className = 'contact-form__status' + (type ? ' contact-form__status--' + type : '');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var apiBase = (window.FILECAST && window.FILECAST.apiBase) || '';
      var payload = {
        title: titleEl.value.trim(),
        body: bodyEl.value.trim(),
        email: emailEl.value.trim() || null,
        website: websiteEl.value // honeypot — left blank by real visitors
      };

      submitBtn.disabled = true;
      setStatus('Sending…', null);

      fetch(apiBase.replace(/\/$/, '') + '/api/v1/messages', {
        method: 'POST',
        credentials: 'include', // send the session cookie so a signed-in sender gets user_id attached
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r
            .json()
            .catch(function () {
              return null;
            })
            .then(function (data) {
              throw new Error((data && data.detail) || 'Request failed (' + r.status + ')');
            });
        })
        .then(function () {
          submitBtn.disabled = false;
          form.reset();
          setStatus("Thanks — we'll get back to you if you left an email.", 'success');
        })
        .catch(function () {
          submitBtn.disabled = false;
          setStatus("Couldn't send your message — please try again in a moment.", 'error');
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
