document.addEventListener('DOMContentLoaded', () => {
    const yearNode = document.querySelector('[data-current-year]');
    if (yearNode) {
        yearNode.textContent = new Date().getFullYear();
    }

    const translateLink = document.querySelector('[data-translate-link]');
    if (translateLink && window.location.protocol !== 'file:') {
        translateLink.href = `https://translate.google.com/translate?sl=ru&tl=en&u=${encodeURIComponent(window.location.href)}`;
    }

    const registrationDialog = document.querySelector('[data-registration-dialog]');
    const registrationForm = document.querySelector('[data-registration-form]');
    const registrationMessage = document.querySelector('[data-registration-message]');
    const registrationSubmit = registrationForm && registrationForm.querySelector('[type="submit"]');

    document.querySelector('[data-open-registration]')?.addEventListener('click', () => {
        registrationDialog.showModal();
        registrationForm.elements.username.focus();
    });

    document.querySelector('[data-close-registration]')?.addEventListener('click', () => {
        registrationDialog.close();
    });

    registrationDialog?.addEventListener('click', (event) => {
        if (event.target === registrationDialog) {
            registrationDialog.close();
        }
    });

    registrationForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        registrationMessage.textContent = '';
        registrationMessage.removeAttribute('data-state');
        registrationSubmit.disabled = true;

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: registrationForm.elements.username.value,
                    password: registrationForm.elements.password.value
                })
            });
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Не удалось создать аккаунт.');
            }

            registrationForm.reset();
            registrationMessage.textContent = 'Аккаунт создан. Добро пожаловать!';
        } catch (error) {
            registrationMessage.dataset.state = 'error';
            registrationMessage.textContent = error.message === 'Failed to fetch'
                ? 'Не удалось связаться с сервером. Запустите сайт через node server.js.'
                : error.message;
        } finally {
            registrationSubmit.disabled = false;
        }
    });
});
