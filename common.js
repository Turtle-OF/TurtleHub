export function initializeCommon() {
  const yearNode = document.querySelector('[data-current-year]');
  if (yearNode) {
    yearNode.textContent = new Date().getFullYear();
  }

  const translateLink = document.querySelector('[data-translate-link]');
  if (translateLink && window.location.protocol !== 'file:') {
    translateLink.href = `https://translate.google.com/translate?sl=ru&tl=en&u=${encodeURIComponent(window.location.href)}`;
  }

  const menuToggle = document.querySelector('[data-menu-toggle]');
  const navMenu = document.querySelector('[data-nav-menu]');
  if (menuToggle && navMenu) {
    function closeMenu() {
      delete navMenu.dataset.open;
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Открыть меню');
    }

    menuToggle.addEventListener('click', () => {
      const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        closeMenu();
      } else {
        navMenu.dataset.open = 'true';
        menuToggle.setAttribute('aria-expanded', 'true');
        menuToggle.setAttribute('aria-label', 'Закрыть меню');
      }
    });

    navMenu.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (!navMenu.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) closeMenu();
    });
  }

  const authButtons = document.querySelector('[data-auth-buttons]');
  const authLogout = document.querySelector('[data-auth-logout]');

  function setCurrentUser(username) {
    if (authButtons) authButtons.hidden = Boolean(username);
    if (authLogout) authLogout.hidden = !username;
    if (authLogout) authLogout.textContent = username ? `Выйти (@${username})` : 'Выйти';
  }

  authLogout?.addEventListener('click', async () => {
    authLogout.disabled = true;
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Не удалось выйти из аккаунта.');
      setCurrentUser(null);
    } catch (error) {
      window.alert(error.message);
    } finally {
      authLogout.disabled = false;
    }
  });

  if (authButtons || authLogout) {
    fetch('/api/me')
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error('Не удалось проверить сессию.');
        return response.json();
      })
      .then((result) => {
        if (result && result.authenticated) setCurrentUser(result.username);
      })
      .catch((error) => console.error(error));
  }

  return { setCurrentUser };
}
