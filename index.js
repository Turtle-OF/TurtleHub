document.addEventListener('DOMContentLoaded', () => {
    const yearNode = document.querySelector('[data-current-year]');
    if (yearNode) {
        yearNode.textContent = new Date().getFullYear();
    }

    const translateLink = document.querySelector('[data-translate-link]');
    if (translateLink && window.location.protocol !== 'file:') {
        translateLink.href = `https://translate.google.com/translate?sl=ru&tl=en&u=${encodeURIComponent(window.location.href)}`;
    }
});
