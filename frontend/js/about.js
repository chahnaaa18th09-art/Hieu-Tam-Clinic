document.addEventListener('DOMContentLoaded', () => {
  const nav = document.getElementById('mainNav');
  const menuToggle = document.querySelector('.about-page .mobile-toggle');
  const lightbox = document.getElementById('aboutLightbox');
  const lightboxImage = lightbox?.querySelector('img');
  const lightboxCaption = lightbox?.querySelector('.about-lightbox-caption');
  const lightboxClose = lightbox?.querySelector('.about-lightbox-close');

  menuToggle?.addEventListener('click', () => {
    const isOpen = nav?.classList.toggle('show') || false;
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Đóng menu' : 'Mở menu');
  });

  nav?.addEventListener('click', event => {
    if (event.target.closest('a')) {
      nav.classList.remove('show');
      menuToggle?.setAttribute('aria-expanded', 'false');
      menuToggle?.setAttribute('aria-label', 'Mở menu');
    }
  });

  document.querySelectorAll('[data-lightbox]').forEach(button => {
    button.addEventListener('click', () => {
      if (!lightbox || !lightboxImage || typeof lightbox.showModal !== 'function') return;
      if (!button.dataset.lightbox) return;
      lightboxImage.src = button.dataset.lightbox;
      lightboxImage.alt = button.dataset.lightboxAlt || '';
      if (lightboxCaption) lightboxCaption.textContent = button.dataset.lightboxCaption || '';
      lightbox.showModal();
      lightboxClose?.focus();
    });
  });

  lightboxClose?.addEventListener('click', () => lightbox?.close());
  lightbox?.addEventListener('click', event => {
    if (event.target === lightbox) lightbox.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && lightbox?.open) {
      event.preventDefault();
      lightbox.close();
    }
  });
  lightbox?.addEventListener('close', () => {
    if (lightboxImage) {
      lightboxImage.removeAttribute('src');
      lightboxImage.alt = '';
    }
  });
});
