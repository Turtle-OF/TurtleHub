import { initializeCommon } from './common.js';

const { setCurrentUser } = initializeCommon();
const registrationDialog = document.querySelector('[data-registration-dialog]');
const registrationForm = document.querySelector('[data-registration-form]');
const registrationMessage = document.querySelector('[data-registration-message]');

if (registrationDialog && registrationForm && registrationMessage) {
  const registrationSubmit = registrationForm.querySelector('[type="submit"]');
  const authTitle = document.querySelector('[data-auth-title]');
  const authToggle = document.querySelector('[data-auth-toggle]');
  const passwordInput = registrationForm.elements.password;
  const passwordHint = document.querySelector('[data-password-hint]');
  let authMode = 'register';

  function showMessage(message, isError = false) {
    registrationMessage.textContent = message;
    if (isError) {
      registrationMessage.dataset.state = 'error';
    } else {
      registrationMessage.removeAttribute('data-state');
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === 'register';
    authTitle.textContent = registering ? 'Создать аккаунт' : 'Войти в аккаунт';
    registrationSubmit.textContent = registering ? 'Зарегистрироваться' : 'Войти';
    authToggle.textContent = registering ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    passwordHint.hidden = !registering;
    showMessage('');
  }

  document.querySelectorAll('[data-open-login], [data-open-registration]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      setAuthMode(trigger.hasAttribute('data-open-registration') ? 'register' : 'login');
      registrationDialog.showModal();
      registrationForm.elements.username.focus();
    });
  });

  document.querySelector('[data-close-registration]')?.addEventListener('click', () => {
    registrationDialog.close();
  });

  registrationDialog.addEventListener('click', (event) => {
    if (event.target === registrationDialog) registrationDialog.close();
  });

  authToggle?.addEventListener('click', () => {
    setAuthMode(authMode === 'register' ? 'login' : 'register');
    registrationForm.elements.username.focus();
  });

  registrationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    registrationSubmit.disabled = true;

    try {
      const response = await fetch(`/api/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: registrationForm.elements.username.value,
          password: passwordInput.value
        })
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос.');

      setCurrentUser(result.username);
      registrationForm.reset();
      showMessage(authMode === 'register' ? 'Аккаунт создан. Вы вошли!' : 'Вход выполнен!');
    } catch (error) {
      showMessage(error.message === 'Failed to fetch'
        ? 'Не удалось связаться с сервером. Запустите сайт через node server.js.'
        : error.message, true);
    } finally {
      registrationSubmit.disabled = false;
    }
  });

  const requestedAuthMode = new URLSearchParams(window.location.search).get('auth');
  if (requestedAuthMode === 'login' || requestedAuthMode === 'register') {
    setAuthMode(requestedAuthMode);
    registrationDialog.showModal();
    registrationForm.elements.username.focus();
  }
}
